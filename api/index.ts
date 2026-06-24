import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Version for verification
const API_VERSION = "1.1.4-ORDER-FIX";

// Start listening only in local dev (not on Vercel serverless)
if (!process.env.VERCEL) {
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (Version: ${API_VERSION})`);
  });
}

// Root route for immediate health check
app.get("/api/ping", (req, res) => {
  res.json({ status: "pong", version: API_VERSION, timestamp: new Date().toISOString() });
});

// Global Error Handler to ensure JSON responses
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global Error Handler:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
    version: API_VERSION,
    path: req.path
  });
});

let pool: any = null;
let openai: any = null;
let initStatus = {
  started_at: null as string | null,
  db: "pending",
  ai: "pending",
  vite: "pending",
  errors: [] as string[]
};

async function initializeAll() {
  initStatus.started_at = new Date().toISOString();
  console.log("Starting background initialization...");

  // Initialize AI
  const initAI = async () => {
    try {
      const { default: OpenAI } = await import("openai");
      if (!process.env.DEEPSEEK_API_KEY) {
        initStatus.ai = "missing_key";
        return;
      }
      openai = new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: "https://api.deepseek.com",
      });
      initStatus.ai = "ready";
      console.log("AI client initialized");
    } catch (e: any) {
      initStatus.ai = "error";
      initStatus.errors.push(`AI Init Error: ${e.message}`);
      console.error("AI Init Error:", e);
    }
  };

  // Initialize DB
  const initDB = async () => {
    if (!process.env.DATABASE_URL) {
      initStatus.db = "missing_url";
      return;
    }
    try {
      const { default: pg } = await import("pg");
      pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });

      const client = await pool.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          participant_id TEXT,
          group_id TEXT,
          role TEXT,
          content TEXT,
          timestamp BIGINT,
          is_interruption_success INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS summaries (
          id SERIAL PRIMARY KEY,
          participant_id TEXT,
          group_id TEXT,
          data TEXT,
          timestamp BIGINT
        );
      `);
      client.release();
      initStatus.db = "ready";
      console.log("Database initialized");
    } catch (e: any) {
      initStatus.db = "error";
      initStatus.errors.push(`DB Init Error: ${e.message}`);
      console.error("DB Init Error:", e);
    }
  };

  const initVite = async () => {
    if (process.env.NODE_ENV !== "production") {
      try {
        const { createServer: createViteServer } = await import("vite");
        const vite = await createViteServer({
          server: { middlewareMode: true },
          appType: "spa",
        });
        app.use(vite.middlewares);
        initStatus.vite = "ready";
        console.log("Vite middleware attached");
      } catch (e: any) {
        initStatus.vite = "error";
        initStatus.errors.push(`Vite Init Error: ${e.message}`);
        console.error("Vite Init Error:", e);
      }
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      initStatus.vite = "production_static";
    }
  };

  // Run all initializations
  await Promise.allSettled([initAI(), initDB(), initVite()]);
  console.log("All background initializations completed/settled");
}

// Start background initialization at the very end
initializeAll().catch(err => console.error("Initialization failed:", err));

// API Routes (Guarded by initialization check)
app.get("/api/health", async (req, res) => {
  res.json({
    status: "ok",
    version: API_VERSION,
    init: initStatus,
    env: {
      has_db_url: !!process.env.DATABASE_URL,
      has_ai_key: !!process.env.DEEPSEEK_API_KEY
    },
    timestamp: new Date().toISOString()
  });
});

// --- Streaming Chat Endpoint ---
// Supports both streaming (SSE) and non-streaming modes.
// When stream=true, the response is sent as Server-Sent Events:
//   data: {"text":"chunk"}\n\n   — for each content delta
//   data: {"done":true,"id":"...","timestamp":...}\n\n  — when complete
//   data: {"error":"..."}\n\n   — on error
app.post("/api/chat", async (req, res) => {
  if (!openai) return res.status(503).json({ error: "AI service is still initializing" });
  const { messages, participantId, groupId, isInterruptionSuccess, stream } = req.body;

  const systemPrompt = "You are a helpful travel assistant. When users ask for travel suggestions, try to provide detailed responses that: 1. Introduce at least 2 different destinations. 2. Compare the characteristics of these destinations. 3. Provide a simple day-by-day itinerary or suggestion. 4. Mention estimated accommodation budgets or price ranges.";

  const apiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m: any) => ({ role: m.role === "model" ? "assistant" : m.role, content: m.content }))
  ];

  // --- Streaming mode (SSE) ---
  if (stream) {
    // Save user message immediately
    const lastMessage = messages[messages.length - 1];
    if (pool) {
      await pool.query(
        "INSERT INTO messages (id, participant_id, group_id, role, content, timestamp, is_interruption_success) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
        [lastMessage.id, participantId || "anonymous", groupId || "unknown", lastMessage.role, lastMessage.content, lastMessage.timestamp, isInterruptionSuccess ? 1 : 0]
      ).catch((e: any) => console.error("DB User Msg Error:", e));
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      const streamResponse = await openai.chat.completions.create({
        model: "deepseek-chat",
        messages: apiMessages,
        stream: true,
      });

      let fullContent = "";

      for await (const chunk of streamResponse) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullContent += content;
          res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
        }
      }

      const assistantId = Date.now().toString();
      const assistantTimestamp = Date.now();

      // Save assistant message to DB after streaming completes
      if (pool) {
        await pool.query(
          "INSERT INTO messages (id, participant_id, group_id, role, content, timestamp, is_interruption_success) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
          [assistantId, participantId || "anonymous", groupId || "unknown", "model", fullContent, assistantTimestamp, isInterruptionSuccess ? 1 : 0]
        ).catch((e: any) => console.error("DB Assistant Msg Error:", e));
      }

      res.write(`data: ${JSON.stringify({ done: true, id: assistantId, timestamp: assistantTimestamp })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Streaming Error:", error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
    return;
  }

  // --- Non-streaming mode (original, fallback) ---
  const lastMessage = messages[messages.length - 1];
  if (pool) {
    await pool.query(
      "INSERT INTO messages (id, participant_id, group_id, role, content, timestamp, is_interruption_success) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
      [lastMessage.id, participantId || "anonymous", groupId || "unknown", lastMessage.role, lastMessage.content, lastMessage.timestamp, isInterruptionSuccess ? 1 : 0]
    ).catch((e: any) => console.error("DB User Msg Error:", e));
  }

  try {
    const response = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: apiMessages,
    });

    const assistantContent = response.choices[0].message.content || "";
    const assistantId = Date.now().toString();
    const assistantTimestamp = Date.now();

    if (pool) {
      await pool.query(
        "INSERT INTO messages (id, participant_id, group_id, role, content, timestamp, is_interruption_success) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
        [assistantId, participantId || "anonymous", groupId || "unknown", "model", assistantContent, assistantTimestamp, isInterruptionSuccess ? 1 : 0]
      ).catch((e: any) => console.error("DB Assistant Msg Error:", e));
    }

    res.json({ text: assistantContent, id: assistantId, timestamp: assistantTimestamp });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/summary", async (req, res) => {
  if (!openai) return res.status(503).json({ error: "AI service is still initializing" });
  const { messages, participantId, groupId } = req.body;
  try {
    const prompt = `Based on the following conversation history, generate a structured "Intent Summary" to help the user recover after an interruption.

    Conversation History:
    ${messages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

    Please return the summary in JSON format with the following structure:
    {
      "progress": ["Completed point 1", "Completed point 2"],
      "preferences": "Summary of user preferences and concerns",
      "pendingIssues": "Core conflicts or unresolved issues",
      "suggestedNextSteps": ["Suggested step 1", "Suggested step 2"]
    }`;

    const response = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      // response_format omitted — DeepSeek does not support structured output
    });

    const content = response.choices[0].message.content || "{}";

    if (pool) {
      await pool.query(
        "INSERT INTO summaries (participant_id, group_id, data, timestamp) VALUES ($1, $2, $3, $4)",
        [participantId || "anonymous", groupId || "unknown", content, Date.now()]
      ).catch((e: any) => console.error("DB Summary Error:", e));
    }

    res.json(JSON.parse(content));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/check-interruption", async (req, res) => {
  if (!openai) return res.status(503).json({ error: "AI service is still initializing" });
  const { messages } = req.body;
  try {
    const prompt = `Analyze the following conversation and determine if the AI has provided a sufficiently detailed travel proposal to justify an interruption for a research study.

    The proposal is considered "complete" if it has covered:
    1. Multiple destinations (at least 2).
    2. Comparison of their features.
    3. A rough itinerary or day-by-day plan.
    4. Budget or price estimates for accommodation.

    Conversation History:
    ${messages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

    Return ONLY a JSON object: {"shouldInterruption": true/false}.`;

    const response = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      // response_format omitted — DeepSeek does not support structured output
    });

    res.json(JSON.parse(response.choices[0].message.content || "{}"));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/messages", async (req, res) => {
  if (!pool) return res.json([]);
  const { participantId } = req.query;
  try {
    let query = "SELECT * FROM messages";
    let params: any[] = [];
    if (participantId) {
      query += " WHERE participant_id = $1";
      params.push(participantId);
    }
    query += " ORDER BY timestamp DESC LIMIT 100";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: "Query failed" });
  }
});

app.post("/api/log-event", async (req, res) => {
  if (!pool) return res.json({ success: true });
  const { participantId, groupId, eventName, isInterruptionSuccess, timestamp } = req.body;
  try {
    await pool.query(
      "INSERT INTO messages (id, participant_id, group_id, role, content, timestamp, is_interruption_success) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
      [Date.now().toString(), participantId || "anonymous", groupId || "unknown", "event", eventName, timestamp || Date.now(), isInterruptionSuccess ? 1 : 0]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Log failed" });
  }
});

export default app;
