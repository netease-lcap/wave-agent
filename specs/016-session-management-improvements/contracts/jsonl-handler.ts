/**
 * JSONL file operations interface
 * Handles reading and writing JSONL (JSON Lines) session files
 */

import { SessionMessage } from './session-interfaces.js';

/**
 * JSONL handler interface for message persistence operations
 */
export interface IJsonlHandler {
  /**
   * Append messages to JSONL file
   * @param filePath Path to JSONL file
   * @param messages Array of messages to append
   * @param options Write options
   * @throws Error if write operation fails
   */
  append(filePath: string, messages: SessionMessage[], options?: JsonlWriteOptions): Promise<void>;
  
  /**
   * Read messages from JSONL file
   * @param filePath Path to JSONL file
   * @param options Read options
   * @returns Array of parsed messages
   * @throws Error if file cannot be read or parsed
   */
  read(filePath: string, options?: JsonlReadOptions): Promise<SessionMessage[]>;
  
  /**
   * Stream messages from JSONL file (for large sessions)
   * @param filePath Path to JSONL file
   * @param options Stream options
   * @returns Async iterator of messages
   * @throws Error if file cannot be streamed
   */
  stream(filePath: string, options?: JsonlStreamOptions): AsyncIterable<SessionMessage>;
  
  /**
   * Count messages in JSONL file without loading content
   * @param filePath Path to JSONL file
   * @returns Number of messages (lines) in file
   * @throws Error if file cannot be accessed
   */
  count(filePath: string): Promise<number>;
  
  /**
   * Validate JSONL file format and content
   * @param filePath Path to JSONL file
   * @returns Validation result with errors and statistics
   */
  validate(filePath: string): Promise<JsonlValidationResult>;
  
  /**
   * Create empty JSONL session file
   * @param filePath Path where file should be created
   * @param initialMessages Optional initial messages to write
   * @throws Error if file cannot be created
   */
  createFile(filePath: string, initialMessages?: SessionMessage[]): Promise<void>;
  
  /**
   * Get file statistics
   * @param filePath Path to JSONL file
   * @returns File statistics including size and message count
   */
  getStats(filePath: string): Promise<JsonlFileStats>;
  
  /**
   * Repair corrupted JSONL file by skipping invalid lines
   * @param filePath Path to corrupted JSONL file
   * @param options Repair options
   * @returns Repair result with statistics
   * @throws Error if file cannot be repaired
   */
  repair(filePath: string, options?: JsonlRepairOptions): Promise<JsonlRepairResult>;
}

/**
 * JSONL write options
 */
export interface JsonlWriteOptions {
  // Buffering options
  buffer?: boolean; // Default: false (immediate write)
  bufferSize?: number; // Default: 100 messages
  flushTimeout?: number; // Default: 1000ms
  
  // Formatting options
  pretty?: boolean; // Default: false (compact JSON)
  addNewlines?: boolean; // Default: true
  
  // Safety options
  backup?: boolean; // Default: false
  atomic?: boolean; // Default: true (write to temp file first)
  
  // Validation options
  validateMessages?: boolean; // Default: true
  strictMode?: boolean; // Default: false
}

/**
 * JSONL read options
 */
export interface JsonlReadOptions {
  // Range options
  limit?: number; // Maximum messages to read
  offset?: number; // Skip first N messages
  startFromEnd?: boolean; // Default: false (read from beginning)
  
  // Filtering options
  roleFilter?: ('user' | 'assistant')[];
  timestampAfter?: Date;
  timestampBefore?: Date;
  
  // Error handling
  skipCorrupted?: boolean; // Default: false
  maxErrors?: number; // Default: 0 (fail on first error)
  
  // Performance options
  streaming?: boolean; // Default: false
  chunkSize?: number; // Default: 1000 messages for streaming
}

/**
 * JSONL stream options
 */
export interface JsonlStreamOptions extends Omit<JsonlReadOptions, 'streaming'> {
  // Stream-specific options
  highWaterMark?: number; // Default: 16KB
  encoding?: BufferEncoding; // Default: 'utf8'
  
  // Backpressure handling
  pauseOnError?: boolean; // Default: false
  resumeOnRepair?: boolean; // Default: false
}

/**
 * JSONL validation result
 */
export interface JsonlValidationResult {
  readonly isValid: boolean;
  readonly totalLines: number;
  readonly validMessages: number;
  readonly errors: JsonlValidationError[];
  readonly warnings: string[];
  readonly fileSize: number;
  readonly lastValidated: Date;
}

/**
 * JSONL validation error
 */
export interface JsonlValidationError {
  readonly lineNumber: number;
  readonly type: 'INVALID_JSON' | 'MISSING_FIELD' | 'INVALID_TYPE' | 'INVALID_TIMESTAMP';
  readonly message: string;
  readonly line?: string;
  readonly field?: string;
}

/**
 * JSONL file statistics
 */
export interface JsonlFileStats {
  readonly filePath: string;
  readonly fileSize: number;
  readonly messageCount: number;
  readonly created: Date;
  readonly lastModified: Date;
  readonly lastAccessed?: Date;
  readonly averageMessageSize: number;
  readonly roles: Record<'user' | 'assistant', number>;
}

/**
 * JSONL repair options
 */
export interface JsonlRepairOptions {
  // Repair strategy
  strategy: 'skip-invalid' | 'fix-json' | 'recover-partial';
  
  // Output options
  createBackup?: boolean; // Default: true
  outputPath?: string; // Default: original file + .repaired
  
  // Recovery options
  maxInvalidLines?: number; // Default: unlimited
  attemptJsonRepair?: boolean; // Default: true
  
  // Logging
  verbose?: boolean; // Default: false
}

/**
 * JSONL repair result
 */
export interface JsonlRepairResult {
  readonly success: boolean;
  readonly originalMessageCount: number;
  readonly repairedMessageCount: number;
  readonly skippedLines: number[];
  readonly repairedLines: number[];
  readonly outputPath: string;
  readonly backupPath?: string;
  readonly errors: string[];
}

/**
 * JSONL handler factory interface
 */
export interface IJsonlHandlerFactory {
  /**
   * Create JSONL handler instance
   * @param config Handler configuration
   * @returns Configured JSONL handler
   */
  create(config?: JsonlHandlerConfig): IJsonlHandler;
}

/**
 * JSONL handler configuration
 */
export interface JsonlHandlerConfig {
  // Performance settings
  enableBuffering?: boolean; // Default: false
  defaultBufferSize?: number; // Default: 100
  streamChunkSize?: number; // Default: 1000
  
  // Safety settings
  enableBackups?: boolean; // Default: false
  enableValidation?: boolean; // Default: true
  enableRepair?: boolean; // Default: true
  
  // Error handling
  maxRetries?: number; // Default: 3
  retryDelay?: number; // Default: 100ms
  
  // Logging
  logger?: IJsonlLogger;
}

/**
 * Logger interface for JSONL operations
 */
export interface IJsonlLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Message validator interface
 */
export interface IMessageValidator {
  /**
   * Validate a single message
   * @param message Message to validate
   * @returns Validation result
   */
  validate(message: SessionMessage): MessageValidationResult;
  
  /**
   * Validate array of messages
   * @param messages Messages to validate
   * @returns Array of validation results
   */
  validateBatch(messages: SessionMessage[]): MessageValidationResult[];
}

/**
 * Message validation result
 */
export interface MessageValidationResult {
  readonly isValid: boolean;
  readonly errors: MessageValidationError[];
  readonly warnings: string[];
}

/**
 * Message validation error
 */
export interface MessageValidationError {
  readonly field: string;
  readonly type: 'MISSING' | 'INVALID_TYPE' | 'INVALID_VALUE' | 'INVALID_FORMAT';
  readonly message: string;
  readonly actualValue?: unknown;
  readonly expectedValue?: unknown;
}