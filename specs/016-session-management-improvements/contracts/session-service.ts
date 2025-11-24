/**
 * Session service API contract for project-based session management
 * Implements new directory structure, JSONL format, and UUIDv6 identifiers
 */

import {
  SessionMessage,
  SessionFile,
  SessionMetadata,
  SessionCreationOptions,
  SessionListFilter,
  SessionLoadOptions,
  MessageAppendOptions,
  SessionCleanupOptions,
} from './session-interfaces.js';

/**
 * Main session service interface
 * Implements project-based session organization with JSONL format and UUIDv6 identifiers
 */
export interface ISessionService {
  // Core session operations
  
  /**
   * Create a new session
   * @param options Session creation parameters
   * @returns Created session file information
   * @throws Error if directory creation fails
   */
  createSession(options: SessionCreationOptions): Promise<SessionFile>;
  
  /**
   * Load an existing session
   * @param options Session loading parameters
   * @returns Array of messages or null if session doesn't exist
   * @throws Error if session exists but cannot be read
   */
  loadSession(options: SessionLoadOptions): Promise<SessionMessage[] | null>;
  
  /**
   * Append messages to existing session
   * @param options Message append parameters
   * @throws Error if session doesn't exist or write fails
   */
  appendMessages(options: MessageAppendOptions): Promise<void>;
  
  /**
   * List sessions with optional filtering
   * @param filter Session filtering criteria
   * @returns Array of session metadata
   * @throws Error if directory cannot be accessed
   */
  listSessions(filter: SessionListFilter): Promise<SessionMetadata[]>;
  
  /**
   * Get the most recent session for a working directory
   * @param workdir Working directory to search
   * @param sessionDir Optional custom session directory
   * @returns Latest session metadata or null if no sessions exist
   * @throws Error if directory cannot be accessed
   */
  getLatestSession(workdir: string, sessionDir?: string): Promise<SessionMetadata | null>;
  
  /**
   * Delete a session
   * @param sessionId UUIDv6 session identifier
   * @param sessionDir Optional custom session directory
   * @returns true if session was deleted, false if it didn't exist
   * @throws Error if session exists but cannot be deleted
   */
  deleteSession(sessionId: string, sessionDir?: string): Promise<boolean>;
  
  /**
   * Check if a session exists
   * @param sessionId UUIDv6 session identifier
   * @param sessionDir Optional custom session directory
   * @returns true if session exists and is accessible
   */
  sessionExists(sessionId: string, sessionDir?: string): Promise<boolean>;
  
  /**
   * Clean up expired sessions
   * @param options Cleanup parameters
   * @returns Number of sessions deleted
   * @throws Error if cleanup fails
   */
  cleanupExpiredSessions(options: SessionCleanupOptions): Promise<number>;
  
  // Directory management operations
  
  /**
   * Ensure session directory structure exists
   * @param workdir Working directory to create structure for
   * @param sessionDir Optional custom session directory base
   * @throws Error if directories cannot be created
   */
  ensureSessionDirectory(workdir: string, sessionDir?: string): Promise<void>;
  
  /**
   * Get session file path for a given session ID and working directory
   * @param sessionId UUIDv6 session identifier
   * @param workdir Working directory
   * @param sessionDir Optional custom session directory base
   * @returns Full path to session file
   */
  getSessionFilePath(sessionId: string, workdir: string, sessionDir?: string): string;
}

/**
 * Session service factory interface
 * Enables dependency injection and testing
 */
export interface ISessionServiceFactory {
  /**
   * Create session service instance
   * @param config Service configuration
   * @returns Configured session service
   */
  create(config: SessionServiceConfig): ISessionService;
}

/**
 * Session service configuration
 */
export interface SessionServiceConfig {
  // Directory configuration
  defaultSessionDir?: string; // Default: ~/.wave/projects
  pathEncoder?: IPathEncoder;
  jsonlHandler?: IJsonlHandler;
  
  // Performance configuration
  cacheWorkdirMappings?: boolean; // Default: true
  bufferWrites?: boolean; // Default: false
  maxBufferSize?: number; // Default: 100 messages
  
  // Validation configuration
  validateUUIDs?: boolean; // Default: true
  strictTypeChecking?: boolean; // Default: true
  
  // Error handling configuration
  retryFailedWrites?: boolean; // Default: true
  maxRetries?: number; // Default: 3
  
  // Logging
  logger?: ILogger;
}

/**
 * Logger interface for session operations
 */
export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Path encoder interface (defined in separate contract)
 */
export interface IPathEncoder {
  encode(path: string): Promise<string>;
  decode(encodedName: string): string | null;
  // ... see path-encoder.ts for full interface
}

/**
 * JSONL handler interface (defined in separate contract)
 */
export interface IJsonlHandler {
  append(filePath: string, data: SessionMessage[]): Promise<void>;
  read(filePath: string, options?: JsonlReadOptions): Promise<SessionMessage[]>;
  // ... see jsonl-handler.ts for full interface
}

export interface JsonlReadOptions {
  limit?: number;
  offset?: number;
  streaming?: boolean;
}