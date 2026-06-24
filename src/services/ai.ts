import { Message, IntentSummaryData } from "../types";

export async function logEvent(participantId: string, groupId: string, eventName: string, isInterruptionSuccess: boolean): Promise<void> {
  try {
    await fetch("/api/log-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, groupId, eventName, isInterruptionSuccess, timestamp: Date.now() }),
    });
  } catch (e) {
    console.error("Log Event Error:", e);
  }
}

/** Non-streaming chat (fallback) */
export async function generateChatResponse(messages: Message[], participantId: string, groupId: string, isInterruptionSuccess: boolean): Promise<{ text: string, id: string, timestamp: number }> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, participantId, groupId, isInterruptionSuccess }),
  });

  if (!response.ok) {
    const text = await response.text();
    let errorMessage = "Failed to fetch chat response";
    try {
      const errorData = JSON.parse(text);
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch (e) {
      errorMessage = text || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}

/** Streaming chat — reads SSE chunks and calls onChunk(fullText) for each delta */
export async function generateChatResponseStream(
  messages: Message[],
  participantId: string,
  groupId: string,
  isInterruptionSuccess: boolean,
  onChunk: (fullText: string) => void,
): Promise<{ text: string; id: string; timestamp: number }> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, participantId, groupId, isInterruptionSuccess, stream: true }),
  });

  if (!response.ok) {
    const text = await response.text();
    let errorMessage = "Failed to fetch chat response";
    try {
      const errorData = JSON.parse(text);
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch (e) {
      errorMessage = text || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";
  let resultId = Date.now().toString();
  let resultTimestamp = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last (possibly incomplete) line in the buffer
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;

      const data = trimmed.slice(6);
      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.done) {
          resultId = parsed.id || resultId;
          resultTimestamp = parsed.timestamp || resultTimestamp;
          return { text: fullText, id: resultId, timestamp: resultTimestamp };
        }
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        if (parsed.text) {
          fullText += parsed.text;
          onChunk(fullText);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue; // skip malformed JSON
        throw e;
      }
    }
  }

  return { text: fullText, id: resultId, timestamp: resultTimestamp };
}

export async function generateIntentSummary(messages: Message[], participantId: string, groupId: string): Promise<IntentSummaryData> {
  const response = await fetch("/api/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, participantId, groupId }),
  });

  if (!response.ok) {
    const text = await response.text();
    let errorMessage = "Failed to fetch intent summary";
    try {
      const errorData = JSON.parse(text);
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch (e) {
      errorMessage = text || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return await response.json() as IntentSummaryData;
}

export async function checkInterruption(messages: Message[]): Promise<boolean> {
  const response = await fetch("/api/check-interruption", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    return false;
  }

  try {
    const data = await response.json();
    return !!data.shouldInterruption;
  } catch (e) {
    return false;
  }
}
