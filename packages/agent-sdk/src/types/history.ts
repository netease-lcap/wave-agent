export interface PromptEntry {
  prompt: string;
  timestamp: number;
  sessionId?: string;
  longTextMap?: Record<string, string>;
}
