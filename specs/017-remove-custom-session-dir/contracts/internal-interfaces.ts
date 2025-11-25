/**
 * Updated internal interfaces with sessionDir removed
 * 
 * These interfaces define the internal API changes when the custom 
 * session directory feature is removed.
 */

import type { Logger } from './agent-interfaces.js';

/**
 * MessageManager constructor options (UPDATED - sessionDir removed)
 * 
 * Internal interface - no external impact
 */
export interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;
  logger?: Logger;
  
  // Flag to indicate this is a subagent session
  isSubagent?: boolean;
  
  // NOTE: sessionDir parameter REMOVED - breaking change for internal usage
  // All sessions now use default directory: ~/.wave/projects
}

/**
 * MessageManager callback interface (unchanged)
 */
export interface MessageManagerCallbacks {
  onMessage?: (message: Message) => void;
  onError?: (error: Error) => void;
  onSessionSave?: (sessionId: string, filePath: string) => void;
}

/**
 * MessageManager class API contract (UPDATED)
 * 
 * Internal class - sessionDir handling removed
 */
export class MessageManager {
  /**
   * Constructor (sessionDir parameter removed from options)
   */
  constructor(options: MessageManagerOptions);
  
  /**
   * Get session directory (UPDATED - returns constant)
   * 
   * @returns Always returns default session directory path
   * 
   * Breaking change: No longer returns custom sessionDir, always returns default
   */
  public getSessionDir(): string;
  
  /**
   * Compute transcript path (UPDATED - simplified)
   * 
   * Internal method now uses hardcoded default directory
   */
  private computeTranscriptPath(): string;
  
  // ... other MessageManager methods unchanged
}

/**
 * SubagentManager options (potentially affected)
 * 
 * May need updates if SubagentManager currently uses sessionDir
 */
export interface SubagentManagerOptions {
  // Interface may need updates based on current sessionDir usage
  // This will be determined during implementation
}

/**
 * Path encoder options (potentially affected)
 * 
 * PathEncoder may need updates if it currently accepts sessionDir
 */
export interface PathEncoderOptions {
  // Interface may need updates based on current sessionDir usage
  // This will be determined during implementation  
}

/**
 * Internal constants (unchanged)
 */
export const SESSION_DIR: string;
export const MAX_SESSION_AGE_DAYS: number;