/**
 * Updated Agent interfaces with sessionDir removed
 * 
 * These interfaces define the breaking changes to the Agent SDK API
 * when the custom session directory feature is removed.
 */

/**
 * Configuration options for Agent instances (UPDATED - sessionDir removed)
 * 
 * Breaking change: sessionDir parameter no longer available
 */
export interface AgentOptions {
  // Optional configuration with environment fallbacks
  apiKey?: string;
  baseURL?: string;
  agentModel?: string;
  fastModel?: string;  
  tokenLimit?: number;

  // Agent behavior options
  callbacks?: AgentCallbacks;
  logger?: Logger;
  workdir?: string;
  systemPrompt?: string;
  
  // Session management options  
  restoreSessionId?: string;
  continueLastSession?: boolean;
  
  // NOTE: sessionDir parameter REMOVED - breaking change
  // All sessions now use default directory: ~/.wave/projects
}

/**
 * Agent callback interface (unchanged)
 */
export interface AgentCallbacks {
  onMessage?: (message: Message) => void;
  onError?: (error: Error) => void;
  onSessionStart?: (sessionId: string) => void;
  onSessionEnd?: (sessionId: string) => void;
}

/**
 * Logger interface (unchanged)  
 */
export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

/**
 * Message interface (unchanged)
 */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

/**
 * Agent class API contract (UPDATED)
 * 
 * Breaking change: sessionDir no longer accepted in options
 */
export class Agent {
  /**
   * Create an Agent instance with async initialization
   * 
   * @param options Configuration options (sessionDir removed)
   * @throws TypeError if sessionDir is passed (compilation error)
   */
  static async create(options: AgentOptions): Promise<Agent>;
  
  /**
   * Private constructor (sessionDir parameter removed)
   */
  private constructor(options: AgentOptions);
  
  // ... other Agent methods unchanged
}