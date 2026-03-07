export interface PromptEntry {
  prompt: string;
  timestamp: number;
  sessionId?: string;
  workdir?: string;
  longTextMap?: Record<string, string>;
}
