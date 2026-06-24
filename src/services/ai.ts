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
