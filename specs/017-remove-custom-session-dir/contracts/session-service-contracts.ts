/**
 * Updated session service function contracts with sessionDir parameters removed
 * 
 * These function signatures define the breaking changes to session service APIs
 * when the custom session directory feature is removed.
 */

import type { Message } from './agent-interfaces.js';

/**
 * Session data structure (unchanged)
 */
export interface SessionData {
  sessionId: string;
  messages: SessionMessage[];
  startTime: string;
  workdir: string;
}

/**
 * Session message with timestamp (unchanged)
 */
export interface SessionMessage extends Message {
  timestamp: string;
}

/**
 * Append messages to session using JSONL format (UPDATED - sessionDir removed)
 * 
 * @param sessionId UUIDv6 session identifier
 * @param newMessages Array of messages to append
 * @param workdir Working directory for the session
 * @param isSubagent Whether this is a subagent session
 * 
 * Breaking change: sessionDir parameter removed
 * All sessions now use default directory: ~/.wave/projects
 */
export async function appendMessages(
  sessionId: string,
  newMessages: Message[],
  workdir: string,
  isSubagent?: boolean,
): Promise<void>;

/**
 * Load session data from JSONL file (UPDATED - sessionDir removed)
 * 
 * @param sessionId UUIDv6 session identifier  
 * @param workdir Working directory for the session
 * @param isSubagent Whether this is a subagent session
 * @returns Promise that resolves to session data or null if session doesn't exist
 * 
 * Breaking change: sessionDir parameter removed
 */
export async function loadSessionFromJsonl(
  sessionId: string,
  workdir: string, 
  isSubagent?: boolean,
): Promise<SessionData | null>;

/**
 * Generate session file path using project-based directory structure (UPDATED - sessionDir removed)
 * 
 * @param sessionId UUIDv6 session identifier
 * @param workdir Working directory for the session
 * @param isSubagent Whether this is a subagent session  
 * @returns Promise resolving to full file path for the session JSONL file
 * 
 * Breaking change: sessionDir parameter removed
 */
export async function getSessionFilePath(
  sessionId: string,
  workdir: string,
  isSubagent?: boolean,
): Promise<string>;

/**
 * Get latest session for a workdir (UPDATED - sessionDir removed)
 * 
 * @param workdir Working directory to search
 * @param isSubagent Whether to search subagent sessions
 * @returns Promise resolving to latest session data or null
 * 
 * Breaking change: sessionDir parameter removed  
 */
export async function getLatestSessionFromJsonl(
  workdir: string,
  isSubagent?: boolean,
): Promise<SessionData | null>;

/**
 * List all sessions for a workdir (UPDATED - sessionDir removed)
 * 
 * @param workdir Working directory to search
 * @param isSubagent Whether to search subagent sessions
 * @returns Promise resolving to array of session data
 * 
 * Breaking change: sessionDir parameter removed
 */
export async function listSessionsFromJsonl(
  workdir: string,
  isSubagent?: boolean,  
): Promise<SessionData[]>;

/**
 * Delete session by ID (UPDATED - sessionDir removed)
 * 
 * @param sessionId Session ID to delete
 * @param workdir Working directory
 * @param isSubagent Whether this is a subagent session
 * @returns Promise resolving to true if deleted, false if not found
 * 
 * Breaking change: sessionDir parameter removed
 */
export async function deleteSessionFromJsonl(
  sessionId: string,
  workdir: string,
  isSubagent?: boolean,
): Promise<boolean>;

/**
 * Check if session exists (UPDATED - sessionDir removed)
 * 
 * @param sessionId Session ID to check
 * @param workdir Working directory  
 * @param isSubagent Whether this is a subagent session
 * @returns Promise resolving to true if session exists
 * 
 * Breaking change: sessionDir parameter removed
 */
export async function sessionExistsInJsonl(
  sessionId: string,
  workdir: string,
  isSubagent?: boolean,
): Promise<boolean>;

/**
 * Clean up expired sessions (UPDATED - sessionDir removed)
 * 
 * @param workdir Working directory to clean up
 * @returns Promise resolving when cleanup is complete
 * 
 * Breaking change: sessionDir parameter removed
 */
export async function cleanupExpiredSessionsFromJsonl(
  workdir: string,
): Promise<void>;

/**
 * Ensure session directory exists (UPDATED - simplified)
 * 
 * @returns Promise resolving when directory is ensured to exist
 * 
 * Breaking change: sessionDir parameter removed
 * Always ensures default directory: ~/.wave/projects
 */
export async function ensureSessionDir(): Promise<void>;

/**
 * REMOVED FUNCTION: resolveSessionDir
 * 
 * This function is eliminated entirely. All usage replaced with 
 * SESSION_DIR constant directly.
 * 
 * Before:
 * export function resolveSessionDir(sessionDir?: string): string;
 * 
 * After: 
 * Use SESSION_DIR constant directly instead
 */

/**
 * Session directory constant (unchanged)
 * 
 * This remains the single source of truth for session storage location
 */
export const SESSION_DIR: string;