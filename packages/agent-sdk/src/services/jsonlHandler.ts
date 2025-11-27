/**
 * JSONL file operations service
 * Handles reading and writing JSONL (JSON Lines) session files for improved performance
 */

import { appendFile, readFile, writeFile, stat, mkdir } from "fs/promises";
import { dirname } from "path";
import { getLastLine, readFirstLine } from "../utils/fileUtils.js";

import type { Message } from "../types/index.js";
import type { SessionMessage, SessionMetadataLine } from "../types/session.js";

/**
 * JSONL write options
 */
export interface JsonlWriteOptions {
  // Safety options
  atomic?: boolean; // Default: true (write to temp file first)
}

/**
 * JSONL handler class for message persistence operations
 */
export class JsonlHandler {
  private readonly defaultWriteOptions: Required<JsonlWriteOptions>;

  constructor() {
    this.defaultWriteOptions = {
      atomic: true,
    };
  }

  /**
   * Create a new session file with metadata header
   */
  async createSession(
    filePath: string,
    sessionId: string,
    workdir: string,
    sessionType: "main" | "subagent" = "main",
    parentSessionId?: string,
    subagentType?: string,
  ): Promise<void> {
    const metadataLine: SessionMetadataLine = {
      __meta__: true,
      sessionId,
      sessionType,
      ...(parentSessionId && { parentSessionId }),
      ...(subagentType && { subagentType }),
      workdir,
      startedAt: new Date().toISOString(),
    };

    // Ensure directory exists
    await this.ensureDirectory(dirname(filePath));

    // Write metadata line as first line
    await writeFile(filePath, JSON.stringify(metadataLine) + "\n", "utf8");
  }

  /**
   * Append a single message to JSONL file
   */
  async appendMessage(filePath: string, message: Message): Promise<void> {
    return this.appendMessages(filePath, [message]);
  }

  /**
   * Append multiple messages to JSONL file
   */
  async appendMessages(filePath: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    // Convert to SessionMessage format with timestamps
    const sessionMessages: SessionMessage[] = messages.map((message) => ({
      ...message,
      timestamp: new Date().toISOString(),
    }));

    return this.append(filePath, sessionMessages);
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

    // Validate messages (always enabled for data integrity)
    this.validateMessages(messages);

    // Ensure directory exists
    await this.ensureDirectory(dirname(filePath));

    // Convert messages to JSONL lines (always compact JSON)
    const lines = messages.map((message) => {
      const { timestamp: existingTimestamp, ...messageWithoutTimestamp } =
        message;
      const messageWithTimestamp = {
        timestamp: existingTimestamp || new Date().toISOString(),
        ...messageWithoutTimestamp,
      };

      return JSON.stringify(messageWithTimestamp);
    });

    const content = lines.join("\n") + "\n";

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
   * Read all messages from JSONL file
   * Includes metadata handling for backward compatibility
   */
  async read(filePath: string): Promise<SessionMessage[]> {
    try {
      const content = await readFile(filePath, "utf8");
      const lines = content
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);

      if (lines.length === 0) {
        return [];
      }

      const allMessages: SessionMessage[] = [];

      // Skip metadata line if present (first line with __meta__: true)
      let startIndex = 0;
      if (lines.length > 0) {
        try {
          const firstLine = JSON.parse(lines[0]);
          if (firstLine.__meta__ === true) {
            startIndex = 1; // Skip metadata line
          }
        } catch (error) {
          // If first line is not valid JSON, throw error with line number
          if (lines[0].trim().length > 0) {
            // Only throw if line is not empty
            throw new Error(`Invalid JSON at line 1: ${error}`);
          }
        }
      }

      // Parse all messages
      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];

        try {
          const message = JSON.parse(line) as SessionMessage;
          allMessages.push(message);
        } catch (error) {
          // Throw error for invalid JSON lines with line number
          throw new Error(`Invalid JSON at line ${i + 1}: ${error}`);
        }
      }

      return allMessages;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw new Error(`Failed to read JSONL file "${filePath}": ${error}`);
    }
  }

  /**
   * Get the last message from JSONL file using efficient file reading
   */
  async getLastMessage(filePath: string): Promise<SessionMessage | null> {
    try {
      // First check if file exists
      try {
        await stat(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw err;
      }

      // Use our elegant utility to get the last line
      const lastLine = await getLastLine(filePath);

      if (!lastLine) {
        return null;
      }

      try {
        const parsed = JSON.parse(lastLine);

        // Skip metadata line
        if (parsed.__meta__ === true) {
          // If the last line is metadata, the file only contains metadata
          return null;
        }

        // Found a valid message
        return parsed as SessionMessage;
      } catch (error) {
        throw new Error(`Invalid JSON in last line of "${filePath}": ${error}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to get last message from "${filePath}": ${error}`,
      );
    }
  }

  /**
   * Read session metadata from first line (streaming - only reads first line)
   */
  async readMetadata(filePath: string): Promise<SessionMetadataLine | null> {
    try {
      // First check if file exists
      try {
        await stat(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw err;
      }

      // Read the first line efficiently
      const firstLine = await readFirstLine(filePath);

      if (!firstLine) {
        return null; // Empty file or first line
      }

      try {
        const parsed = JSON.parse(firstLine);
        if (parsed.__meta__ === true) {
          return parsed as SessionMetadataLine;
        } else {
          return null; // First line is not metadata
        }
      } catch {
        return null; // Invalid JSON on first line
      }
    } catch (error) {
      throw new Error(`Failed to read metadata from "${filePath}": ${error}`);
    }
  }

  /**
   * Check if a session file has metadata (first line check only)
   * Very efficient - only reads first line
   */
  async hasMetadata(filePath: string): Promise<boolean> {
    const metadata = await this.readMetadata(filePath);
    return metadata !== null;
  }

  /**
   * Validate messages before writing
   */
  private validateMessages(messages: SessionMessage[]): void {
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (!message.role) {
        throw new Error(
          `Message at index ${i} is missing required field: role`,
        );
      }

      if (!message.blocks) {
        throw new Error(
          `Message at index ${i} is missing required field: blocks`,
        );
      }

      if (!Array.isArray(message.blocks)) {
        throw new Error(
          `Message at index ${i} has invalid blocks field: must be an array`,
        );
      }
    }
  }

  /**
   * Ensure directory exists for the given file path
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await mkdir(dirPath, { recursive: true });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw error;
      }
    }
  }
}
