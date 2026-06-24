export type Role = 'user' | 'model';

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
}

export interface IntentSummaryData {
  progress: string[];
  preferences: string;
  pendingIssues: string;
  suggestedNextSteps: string[];
}

export interface ChatSession {
  id: string;
  messages: Message[];
  summary?: IntentSummaryData;
  isInterrupted: boolean;
}
