/**
 * JSONL file operations service
 * Handles reading and writing JSONL (JSON Lines) session files for improved performance
 */

import { appendFile, readFile, writeFile, stat, mkdir } from "fs/promises";
import { dirname } from "path";
import { getLastLine, readFirstNLines } from "../utils/fileUtils.js";

import type { Message } from "../types/index.js";
import type { SessionFilename } from "../types/session.js";

/**
 * JSONL write options
 */
export interface JsonlWriteOptions {
  // Safety options
  atomic?: boolean; // Default: true (write to temp file first)
}

/**
 * Creation-time metadata persisted in the session file's header line
 * (`{"type":"metadata",...}`). The header is append-only — written once on
 * session creation and never rewritten — so only fields that are fixed at
 * creation time belong here.
 */
export interface SessionMetadataHeader {
  /** Real working directory (the encoded project dir name is lossy for paths containing "-"). */
  workdir?: string;
  /** ISO 8601 creation timestamp. */
  createdAt?: string;
  /** Git branch at creation time (`git branch --show-current`), when the directory is a git repo. */
  gitBranch?: string;
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
   * Create a new session file.
   *
   * When `metadata` is provided, the first line is a metadata header
   * recording creation-time facts about the session:
   * `{"type":"metadata","workdir":...,"createdAt":...,"gitBranch":...}`. The
   * encoded project dir name is lossy for paths containing "-", so persisting
   * the real path lets session listing show it without decoding; `createdAt`
   * and `gitBranch` similarly avoid lossy/fabricated reconstruction later.
   * The header carries no `timestamp`, so message readers filter it out
   * naturally.
   *
   * Legacy callers that omit `metadata` still get an empty file.
   */
  async createSession(
    filePath: string,
    metadata?: SessionMetadataHeader,
  ): Promise<void> {
    // Ensure directory exists
    await this.ensureDirectory(dirname(filePath));

    const content =
      metadata && Object.keys(metadata).length > 0
        ? `${JSON.stringify({ type: "metadata", ...metadata })}\n`
        : "";
    await writeFile(filePath, content, "utf8");
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

    return this.append(filePath, messages);
  }

  /**
   * Append messages to JSONL file
   */
  async append(
    filePath: string,
    messages: Message[],
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

    // Convert messages to JSONL lines (compact JSON, timestamp first)
    const lines = messages.map((message) => {
      const { timestamp, ...rest } = message;
      return JSON.stringify({ timestamp, ...rest });
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
   * Read all messages from JSONL file (simplified - no metadata handling)
   */
  async read(filePath: string): Promise<Message[]> {
    try {
      const content = await readFile(filePath, "utf8");
      const lines = content
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);

      if (lines.length === 0) {
        return [];
      }

      const allMessages: Message[] = [];

      // Parse all messages, skipping the metadata header line (if any)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        try {
          const message = JSON.parse(line) as Message & {
            type?: string;
          };
          // Metadata header line: not a message, skip
          if (message.type === "metadata") continue;
          if (message.timestamp) allMessages.push(message);
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
   * Get the last message from JSONL file using efficient file reading (simplified)
   */
  async getLastMessage(filePath: string): Promise<Message | null> {
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
        const parsed = JSON.parse(lastLine) as Message & { type?: string };
        // A file whose only line is the metadata header has no messages yet
        if (parsed.type === "metadata") {
          return null;
        }
        return parsed as Message;
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
   * Read the creation-time metadata from the session file's header line.
   *
   * Newer session files start with a `{"type":"metadata",...}` line (see
   * `createSession`). Legacy files have no header.
   *
   * @param filePath - Path to the session JSONL file
   * @returns The persisted metadata, or null when the file has no header
   */
  async readMetadata(filePath: string): Promise<SessionMetadataHeader | null> {
    try {
      const lines = await readFirstNLines(filePath, 1);
      if (lines.length === 0) {
        return null;
      }
      const header = JSON.parse(lines[0]) as
        | ({ type?: string } & SessionMetadataHeader)
        | null;
      if (header?.type === "metadata") {
        return {
          workdir: header.workdir,
          createdAt: header.createdAt,
          gitBranch: header.gitBranch,
        };
      }
    } catch {
      // Unreadable or invalid first line — treat as a legacy file
    }
    return null;
  }

  /**
   * Validate messages before writing
   */
  private validateMessages(messages: Message[]): void {
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (!message.id) {
        throw new Error(`Message at index ${i} is missing required field: id`);
      }

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

  /**
   * Parse session metadata from filename
   * @param filePath - Path to the session file
   * @returns Parsed session filename metadata
   */
  parseSessionFilename(filePath: string): SessionFilename {
    // Extract filename from path
    const filename = filePath.split("/").pop() || "";

    // Check if it's a subagent session
    const subagentMatch = filename.match(
      /^subagent-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
    );
    if (subagentMatch) {
      return {
        sessionId: subagentMatch[1],
        sessionType: "subagent",
      };
    }

    // Check if it's a main session
    const mainMatch = filename.match(
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
    );
    if (mainMatch) {
      return {
        sessionId: mainMatch[1],
        sessionType: "main",
      };
    }

    throw new Error(`Invalid session filename format: ${filename}`);
  }

  /**
   * Validate filename format
   * @param filename - Filename to validate
   * @returns True if valid, false otherwise
   */
  isValidSessionFilename(filename: string): boolean {
    // UUID validation patterns
    const uuidPattern =
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
    const subagentPattern =
      /^subagent-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

    return uuidPattern.test(filename) || subagentPattern.test(filename);
  }

  /**
   * Generate simple filename for sessions
   * @param sessionId - UUID session identifier
   * @param sessionType - Type of session ("main" or "subagent")
   * @returns Generated filename
   */
  generateSessionFilename(
    sessionId: string,
    sessionType: "main" | "subagent",
  ): string {
    // Validate sessionId is a valid UUID
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (!uuidPattern.test(sessionId)) {
      throw new Error(`Invalid session ID format: ${sessionId}`);
    }

    if (sessionType === "subagent") {
      return `subagent-${sessionId}.jsonl`;
    } else {
      return `${sessionId}.jsonl`;
    }
  }
}
