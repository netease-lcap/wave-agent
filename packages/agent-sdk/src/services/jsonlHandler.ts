/**
 * JSONL file operations service
 * Handles reading and writing JSONL (JSON Lines) session files for improved performance
 */

import { appendFile, readFile, writeFile, stat, mkdir } from "fs/promises";
import { createReadStream } from "fs";
import { dirname } from "path";
import { createInterface } from "readline";
import type { Message } from "../types/index.js";

/**
 * Enhanced message interface for JSONL storage (extends existing Message)
 */
export interface SessionMessage extends Message {
  timestamp: string; // ISO 8601 - added for JSONL format
  // Inherits: role: "user" | "assistant", blocks: MessageBlock[], usage?, metadata?
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
  roleFilter?: ("user" | "assistant")[];
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
export interface JsonlStreamOptions
  extends Omit<JsonlReadOptions, "streaming"> {
  // Stream-specific options
  highWaterMark?: number; // Default: 16KB
  encoding?: BufferEncoding; // Default: 'utf8'

  // Backpressure handling
  pauseOnError?: boolean; // Default: false
  resumeOnRepair?: boolean; // Default: false
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
  readonly roles: Record<"user" | "assistant", number>;
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
  readonly type:
    | "INVALID_JSON"
    | "MISSING_FIELD"
    | "INVALID_TYPE"
    | "INVALID_TIMESTAMP";
  readonly message: string;
  readonly line?: string;
  readonly field?: string;
}

/**
 * JSONL handler class for message persistence operations
 */
export class JsonlHandler {
  private readonly defaultWriteOptions: Required<JsonlWriteOptions>;
  private readonly defaultReadOptions: Required<JsonlReadOptions>;

  constructor() {
    this.defaultWriteOptions = {
      buffer: false,
      bufferSize: 100,
      flushTimeout: 1000,
      pretty: false,
      addNewlines: true,
      backup: false,
      atomic: true,
      validateMessages: true,
      strictMode: false,
    };

    this.defaultReadOptions = {
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
      startFromEnd: false,
      roleFilter: ["user", "assistant"],
      timestampAfter: new Date(0),
      timestampBefore: new Date(),
      skipCorrupted: false,
      maxErrors: 0,
      streaming: false,
      chunkSize: 1000,
    };
  }

  /**
   * Append messages to JSONL file
   */
  async append(
    filePath: string,
    messages: SessionMessage[],
    options?: JsonlWriteOptions,
  ): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const opts = { ...this.defaultWriteOptions, ...options };

    // Validate messages if requested
    if (opts.validateMessages) {
      this.validateMessages(messages);
    }

    // Ensure directory exists
    await this.ensureDirectory(dirname(filePath));

    // Convert messages to JSONL lines
    const lines = messages.map((message) => {
      const messageWithTimestamp = {
        ...message,
        timestamp: message.timestamp || new Date().toISOString(),
      };

      return opts.pretty
        ? JSON.stringify(messageWithTimestamp, null, 2)
        : JSON.stringify(messageWithTimestamp);
    });

    const content = lines.join("\n") + (opts.addNewlines ? "\n" : "");

    if (opts.atomic) {
      // Write to temp file first, then rename
      const tempPath = `${filePath}.tmp`;
      await writeFile(tempPath, content, "utf8");

      // Atomic rename
      const { rename } = await import("fs/promises");
      await rename(tempPath, filePath);
    } else {
      // Direct append
      await appendFile(filePath, content, "utf8");
    }
  }

  /**
   * Read messages from JSONL file
   */
  async read(
    filePath: string,
    options?: JsonlReadOptions,
  ): Promise<SessionMessage[]> {
    const opts = { ...this.defaultReadOptions, ...options };

    try {
      const content = await readFile(filePath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());

      const messages: SessionMessage[] = [];
      let errorCount = 0;
      let processedCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Apply offset
        if (processedCount < opts.offset) {
          processedCount++;
          continue;
        }

        // Apply limit
        if (messages.length >= opts.limit) {
          break;
        }

        try {
          const message = JSON.parse(line) as SessionMessage;

          // Apply filters
          if (!this.matchesFilters(message, opts)) {
            continue;
          }

          messages.push(message);
          processedCount++;
        } catch (error) {
          errorCount++;

          if (
            !opts.skipCorrupted ||
            (opts.maxErrors > 0 && errorCount > opts.maxErrors)
          ) {
            throw new Error(`Invalid JSON at line ${i + 1}: ${error}`);
          }
        }
      }

      // If startFromEnd is true, reverse the final result to show latest messages first
      return opts.startFromEnd ? messages.reverse() : messages;
    } catch (error) {
      throw new Error(`Failed to read JSONL file "${filePath}": ${error}`);
    }
  }

  /**
   * Stream messages from JSONL file (for large sessions)
   */
  async *stream(
    filePath: string,
    options?: JsonlStreamOptions,
  ): AsyncIterable<SessionMessage> {
    const opts = { ...this.defaultReadOptions, ...options };

    const fileStream = createReadStream(filePath, {
      encoding: opts.encoding || "utf8",
      highWaterMark: opts.highWaterMark || 16 * 1024,
    });

    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineNumber = 0;
    let processedCount = 0;
    let errorCount = 0;

    for await (const line of rl) {
      lineNumber++;

      if (!line.trim()) {
        continue;
      }

      // Apply offset
      if (processedCount < opts.offset) {
        processedCount++;
        continue;
      }

      // Apply limit
      if (opts.limit && processedCount >= opts.limit) {
        break;
      }

      try {
        const message = JSON.parse(line) as SessionMessage;

        // Apply filters
        if (!this.matchesFilters(message, opts)) {
          continue;
        }

        yield message;
        processedCount++;
      } catch (error) {
        errorCount++;

        if (
          !opts.skipCorrupted ||
          (opts.maxErrors > 0 && errorCount > opts.maxErrors)
        ) {
          if (opts.pauseOnError) {
            continue;
          }
          throw new Error(`Invalid JSON at line ${lineNumber}: ${error}`);
        }
      }
    }
  }

  /**
   * Count messages in JSONL file without loading content
   */
  async count(filePath: string): Promise<number> {
    try {
      const content = await readFile(filePath, "utf8");
      return content.split("\n").filter((line) => line.trim()).length;
    } catch (error) {
      throw new Error(`Failed to count messages in "${filePath}": ${error}`);
    }
  }

  /**
   * Validate JSONL file format and content
   */
  async validate(filePath: string): Promise<JsonlValidationResult> {
    const stats = await stat(filePath);
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim());

    const errors: JsonlValidationError[] = [];
    const warnings: string[] = [];
    let validMessages = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      try {
        const message = JSON.parse(line) as SessionMessage;

        // Validate required fields
        if (!message.role) {
          errors.push({
            lineNumber,
            type: "MISSING_FIELD",
            message: "Missing required field: role",
            line,
            field: "role",
          });
        }

        if (!message.blocks) {
          errors.push({
            lineNumber,
            type: "MISSING_FIELD",
            message: "Missing required field: blocks",
            line,
            field: "blocks",
          });
        }

        if (!message.timestamp) {
          warnings.push(`Line ${lineNumber}: Missing timestamp field`);
        } else {
          // Validate timestamp format
          try {
            new Date(message.timestamp);
          } catch {
            errors.push({
              lineNumber,
              type: "INVALID_TIMESTAMP",
              message: "Invalid timestamp format",
              line,
              field: "timestamp",
            });
          }
        }

        validMessages++;
      } catch (error) {
        errors.push({
          lineNumber,
          type: "INVALID_JSON",
          message: `Invalid JSON: ${error}`,
          line,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      totalLines: lines.length,
      validMessages,
      errors,
      warnings,
      fileSize: stats.size,
      lastValidated: new Date(),
    };
  }

  /**
   * Create empty JSONL session file
   */
  async createFile(
    filePath: string,
    initialMessages?: SessionMessage[],
  ): Promise<void> {
    // Ensure directory exists
    await this.ensureDirectory(dirname(filePath));

    if (initialMessages && initialMessages.length > 0) {
      await this.append(filePath, initialMessages);
    } else {
      // Create empty file
      await writeFile(filePath, "", "utf8");
    }
  }

  /**
   * Get file statistics
   */
  async getStats(filePath: string): Promise<JsonlFileStats> {
    const stats = await stat(filePath);
    const messages = await this.read(filePath);

    const roles = { user: 0, assistant: 0 };
    for (const message of messages) {
      if (message.role === "user" || message.role === "assistant") {
        roles[message.role]++;
      }
    }

    return {
      filePath,
      fileSize: stats.size,
      messageCount: messages.length,
      created: stats.birthtime,
      lastModified: stats.mtime,
      lastAccessed: stats.atime,
      averageMessageSize:
        messages.length > 0 ? stats.size / messages.length : 0,
      roles,
    };
  }

  /**
   * Validate messages before writing
   */
  private validateMessages(messages: SessionMessage[]): void {
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (
        !message.role ||
        (message.role !== "user" && message.role !== "assistant")
      ) {
        throw new Error(`Invalid role at message ${i}: ${message.role}`);
      }

      if (!message.blocks || !Array.isArray(message.blocks)) {
        throw new Error(`Invalid blocks at message ${i}: must be an array`);
      }

      if (message.timestamp) {
        try {
          new Date(message.timestamp);
        } catch {
          throw new Error(
            `Invalid timestamp at message ${i}: ${message.timestamp}`,
          );
        }
      }
    }
  }

  /**
   * Check if message matches filters
   */
  private matchesFilters(
    message: SessionMessage,
    options: Required<JsonlReadOptions>,
  ): boolean {
    // Role filter
    if (
      options.roleFilter.length > 0 &&
      !options.roleFilter.includes(message.role)
    ) {
      return false;
    }

    // Timestamp filters
    if (message.timestamp) {
      const messageTime = new Date(message.timestamp);

      if (
        messageTime < options.timestampAfter ||
        messageTime > options.timestampBefore
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await mkdir(dirPath, { recursive: true });
    } catch {
      // Ignore errors if directory already exists
    }
  }
}

/**
 * Default JsonlHandler instance
 */
export const jsonlHandler = new JsonlHandler();
