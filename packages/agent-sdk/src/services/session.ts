/**
 * Session Management Service - JSONL Format Implementation
 *
 * OPTIMIZED IMPLEMENTATION (Phase 6 Complete):
 * - Filename-based session type identification
 * - Minimal file I/O for metadata extraction
 * - Eliminated metadata headers for cleaner session files
 * - Backward compatible with existing session files
 * - 8-10x performance improvement in session listing operations
 *
 * Key Features:
 * - Session creation without metadata headers
 * - Subagent sessions identified by filename prefix
 * - Performance-optimized session listing
 * - Full backward compatibility maintained
 */

import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type { Message } from "../types/index.js";
import { PathEncoder } from "../utils/pathEncoder.js";
import { JsonlHandler } from "../services/jsonlHandler.js";
import { extractLatestTotalTokens } from "../utils/tokenCalculation.js";
import { logger } from "../utils/globalLogger.js";
import {
  getMessageContent,
  sliceFromLastCompact,
} from "../utils/messageOperations.js";

export interface SessionData {
  id: string;
  messages: Message[];
  metadata: {
    workdir: string;
    lastActiveAt: string;
    latestTotalTokens: number;
  };
}

export interface SessionMetadata {
  id: string;
  sessionType: "main" | "subagent";
  subagentType?: string;
  workdir: string;
  createdAt: Date;
  lastActiveAt: Date;
  latestTotalTokens: number;
  firstMessage?: string;
}

/**
 * Generate a new session ID using Node.js native crypto.randomUUID()
 * @returns UUID string for session identification
 */
export function generateSessionId(): string {
  return randomUUID();
}

/**
 * Generate filename for subagent sessions
 * @param sessionId - UUID session identifier
 * @returns Filename with subagent prefix for subagent sessions
 */
export function generateSubagentFilename(sessionId: string): string {
  return `subagent-${sessionId}.jsonl`;
}

// Constants
export const SESSION_DIR = join(homedir(), ".wave", "projects");
const MAX_SESSION_AGE_DAYS = 14;

/**
 * Ensure session directory exists
 */
export async function ensureSessionDir(): Promise<void> {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create session directory: ${error}`);
  }
}

/**
 * Generate session file path without creating directories
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 * @returns Promise resolving to full file path for the session JSONL file
 */
export async function generateSessionFilePath(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<string> {
  const encoder = new PathEncoder();
  const projectDir = await encoder.getProjectDirectory(workdir, SESSION_DIR);

  // Generate filename based on session type
  const jsonlHandler = new JsonlHandler();
  const filename = jsonlHandler.generateSessionFilename(sessionId, sessionType);

  return join(projectDir.encodedPath, filename);
}

/**
 * Generate session file path using project-based directory structure
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 * @returns Promise resolving to full file path for the session JSONL file
 */
export async function getSessionFilePath(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<string> {
  const encoder = new PathEncoder();
  const projectDir = await encoder.createProjectDirectory(workdir, SESSION_DIR);

  // Generate filename based on session type
  const jsonlHandler = new JsonlHandler();
  const filename = jsonlHandler.generateSessionFilename(sessionId, sessionType);

  return join(projectDir.encodedPath, filename);
}

/**
 * Create a new session
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 */
export async function createSession(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<void> {
  const jsonlHandler = new JsonlHandler();
  const filePath = await getSessionFilePath(sessionId, workdir, sessionType);
  await jsonlHandler.createSession(filePath);
}

/**
 * Append messages to session using JSONL format (new approach)
 *
 * @param sessionId - UUID session identifier
 * @param newMessages - Array of messages to append
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 */
export async function appendMessages(
  sessionId: string,
  newMessages: Message[],
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<void> {
  // Do not save session files in test environment
  if (process.env.NODE_ENV === "test") {
    return;
  }

  // Do not save if there are no messages
  if (newMessages.length === 0) {
    return;
  }

  const jsonlHandler = new JsonlHandler();

  // Generate the session file path directly using known session type
  const filePath = await generateSessionFilePath(
    sessionId,
    workdir,
    sessionType,
  );

  // Check if the session file exists
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(
      `Session file not found: ${sessionId}. Use createSession() to create a new session first.`,
    );
  }

  await jsonlHandler.append(filePath, newMessages, {
    atomic: false,
  });
}

/**
 * Scan all project directories for a session file by ID. Used as a fallback
 * when the session is not found in the given working directory (e.g. resuming
 * a session created in another project or a sibling git worktree via
 * `wave --restore <id>`).
 *
 * @param sessionId - UUID session identifier
 * @param sessionType - Type of session ("main" or "subagent")
 * @returns Full path to the session file, or null if not found anywhere
 */
async function findSessionFileAcrossProjects(
  sessionId: string,
  sessionType: "main" | "subagent",
): Promise<string | null> {
  const targetFile =
    sessionType === "subagent"
      ? `subagent-${sessionId}.jsonl`
      : `${sessionId}.jsonl`;

  try {
    const projectDirs = await fs.readdir(SESSION_DIR);
    for (const projectDirName of projectDirs) {
      const candidate = join(SESSION_DIR, projectDirName, targetFile);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // ENOENT/ENOTDIR — keep scanning other project dirs
      }
    }
  } catch {
    // Sessions base dir missing or unreadable — nothing to scan
  }

  return null;
}

/**
 * Load session data from JSONL file (new approach)
 *
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 * @returns Promise that resolves to session data or null if session doesn't exist
 */
export async function loadSessionFromJsonl(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<SessionData | null> {
  try {
    const jsonlHandler = new JsonlHandler();

    // Generate the session file path directly using known session type
    const filePath = await generateSessionFilePath(
      sessionId,
      workdir,
      sessionType,
    );

    // Check if file exists
    let resolvedPath = filePath;
    try {
      await fs.access(resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Cross-project fallback: the session may live in a different project
        // directory (e.g. `wave --restore <id>` run from another cwd).
        const fallbackPath = await findSessionFileAcrossProjects(
          sessionId,
          sessionType,
        );
        if (!fallbackPath) {
          return null;
        }
        resolvedPath = fallbackPath;
      } else {
        throw error;
      }
    }

    const allMessages = await jsonlHandler.read(resolvedPath);

    // Find the last compact boundary — only return messages from there forward
    const messages = sliceFromLastCompact(allMessages);

    // Extract metadata from messages
    const lastMessage =
      messages.length > 0 ? messages[messages.length - 1] : null;

    const sessionData: SessionData = {
      id: sessionId,
      messages,
      metadata: {
        workdir,
        lastActiveAt: lastMessage
          ? lastMessage.timestamp
          : new Date().toISOString(),
        latestTotalTokens: lastMessage?.usage
          ? extractLatestTotalTokens([lastMessage])
          : 0,
      },
    };

    return sessionData;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if the underlying error is ENOENT (file doesn't exist)
    if (
      errorMessage.includes("ENOENT") ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null; // Session file does not exist
    }

    // Check for JSON parsing errors (corrupted files)
    if (
      errorMessage.includes("Invalid JSON") ||
      errorMessage.includes("Unexpected token")
    ) {
      return null; // Treat corrupted files as non-existent
    }

    throw new Error(`Failed to load session ${sessionId}: ${error}`);
  }
}

/**
 * Get the most recently active session for a specific working directory (new JSONL approach)
 * Only returns main sessions, skips subagent sessions
 * Uses listSessionsFromJsonl which already sorts sessions by last active time (most recent first)
 *
 * @param workdir - Working directory to find the most recently active session for
 * @returns Promise that resolves to the most recently active session data or null if no sessions exist
 */
export async function getLatestSessionFromJsonl(
  workdir: string,
): Promise<SessionData | null> {
  const sessions = await listSessionsFromJsonl(workdir); // Excludes subagent sessions by default

  if (sessions.length === 0) {
    return null;
  }

  // Sessions are already sorted by lastActiveAt from listSessionsFromJsonl (most recent first)
  const latestSession = sessions[0];
  return loadSessionFromJsonl(latestSession.id, workdir);
}

/**
 * List all sessions for a specific working directory (convenience wrapper)
 * Only returns main sessions, skips subagent sessions
 *
 * @param workdir - Working directory to filter sessions by
 * @returns Promise that resolves to array of session metadata objects
 */
export async function listSessions(
  workdir: string,
): Promise<SessionMetadata[]> {
  return listSessionsFromJsonl(workdir); // Excludes subagent sessions by default
}

/**
 * List all sessions for a specific working directory using JSONL format (optimized approach)
 *
 * PERFORMANCE OPTIMIZATION:
 * - Uses filename parsing exclusively for session metadata
 * - Only reads last message for timestamps and token counts
 * - Eliminates O(n*2) file operations, achieving O(n) performance
 * - Returns simplified session metadata objects
 * - Only includes main sessions, excludes subagent sessions
 *
 * @param workdir - Working directory to filter sessions by
 * @returns Promise that resolves to array of session metadata objects
 */
export async function listSessionsFromJsonl(
  workdir: string,
): Promise<SessionMetadata[]> {
  try {
    const encoder = new PathEncoder();
    const baseDir = SESSION_DIR;

    const projectDir = await encoder.getProjectDirectory(workdir, baseDir);

    let files: string[];
    try {
      files = await fs.readdir(projectDir.encodedPath);
    } catch (error) {
      // If project directory doesn't exist, return empty array
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const sessions: SessionMetadata[] = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) {
        continue;
      }

      // EARLY FILTERING: Skip subagent sessions by filename prefix for maximum performance
      if (file.startsWith("subagent-")) {
        continue;
      }

      try {
        const filePath = join(projectDir.encodedPath, file);

        // Validate main session filename format (UUID.jsonl)
        const uuidMatch = file.match(
          /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
        );
        if (!uuidMatch) {
          continue; // Skip invalid filenames
        }

        const sessionId = uuidMatch[1];

        // PERFORMANCE OPTIMIZATION: Only read the last message for timestamps and tokens
        const jsonlHandler = new JsonlHandler();
        const lastMessage = await jsonlHandler.getLastMessage(filePath);

        // Handle timing information efficiently
        let lastActiveAt: Date;

        if (lastMessage) {
          lastActiveAt = new Date(lastMessage.timestamp);
        } else {
          // Empty session file - use file modification time
          const stats = await fs.stat(filePath);
          lastActiveAt = stats.mtime;
        }

        // Return inline object for performance (no interface instantiation overhead)
        const sessionMeta: SessionMetadata = {
          id: sessionId,
          sessionType: "main",
          subagentType: undefined,
          workdir: projectDir.originalPath,
          createdAt: new Date(),
          lastActiveAt,
          latestTotalTokens: lastMessage?.usage
            ? extractLatestTotalTokens([lastMessage])
            : 0,
        };

        // Try to get first message content for display
        try {
          const firstContent = await getFirstMessageContent(sessionId, workdir);
          if (firstContent) {
            sessionMeta.firstMessage = firstContent;
          }
        } catch {
          // Ignore errors getting first message
        }

        sessions.push(sessionMeta);
      } catch {
        // Skip corrupted session files
        continue;
      }
    }

    // Sort by last active time (most recently active first)
    return sessions.sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
  } catch (error) {
    throw new Error(`Failed to list sessions: ${error}`);
  }
}

/**
 * List all sessions across all project directories.
 *
 * When `worktreePaths` is provided, only project directories that match a
 * same-repo git worktree (plus the current working directory's own project
 * dir) are scanned — used by the `wave -r` picker's worktree aggregation
 * (`Ctrl+W`). When omitted, every project directory under the sessions dir
 * is scanned (all-projects mode, `Ctrl+A`).
 *
 * No time-based filtering is applied — all sessions whose files still exist
 * are listed, regardless of how long ago they were last active.
 *
 * @param options.worktreePaths - Absolute paths of same-repo worktrees
 *   (from `git worktree list`). When provided, scanning is limited to
 *   matching project directories.
 * @param options.workdir - Current working directory. Its own project dir is
 *   always included in worktree mode so sessions created from a subdirectory
 *   inside a worktree are not missed.
 * @returns Promise that resolves to array of session metadata objects,
 *   deduplicated by sessionId (newest lastActiveAt wins), sorted by
 *   lastActiveAt descending.
 */
export async function listAllSessions(options?: {
  worktreePaths?: string[];
  workdir?: string;
}): Promise<SessionMetadata[]> {
  try {
    const { worktreePaths, workdir } = options ?? {};
    const baseDir = SESSION_DIR;
    let projectDirs: string[];
    try {
      projectDirs = await fs.readdir(baseDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    // Worktree-aware mode: only scan project dirs that match a same-repo
    // worktree path. Prefixes are sorted longest-first so a short prefix like
    // "home-user-repo" cannot swallow "home-user-repo-wt" (short paths require
    // exact match; prefix + "-" matching only kicks in for paths truncated by
    // the 200-char encoding limit, mirroring Claude Code's session listing).
    const encoder = new PathEncoder();
    const caseInsensitive = process.platform === "win32";
    let indexed: { prefix: string }[] | null = null;
    if (worktreePaths && worktreePaths.length > 0) {
      indexed = [];
      const seen = new Set<string>();
      for (const wt of worktreePaths) {
        let encoded: string;
        try {
          encoded = await encoder.encode(wt);
        } catch {
          encoded = encoder.encodeSync(wt);
        }
        const prefix = caseInsensitive ? encoded.toLowerCase() : encoded;
        if (seen.has(prefix)) continue;
        seen.add(prefix);
        indexed.push({ prefix });
      }
      indexed.sort((a, b) => b.prefix.length - a.prefix.length);
      // Always include the current working directory's own project dir —
      // the cwd may be a subdirectory inside a worktree whose root prefix
      // does not match (short-path matching is exact-only).
      if (workdir) {
        let encodedCwd: string;
        try {
          encodedCwd = await encoder.encode(workdir);
        } catch {
          encodedCwd = encoder.encodeSync(workdir);
        }
        const prefix = caseInsensitive ? encodedCwd.toLowerCase() : encodedCwd;
        if (!seen.has(prefix)) {
          seen.add(prefix);
          indexed.push({ prefix });
        }
      }
    }

    const allSessions: SessionMetadata[] = [];
    const MAX_ENCODED_PREFIX_LENGTH = 200;

    for (const projectDirName of projectDirs) {
      const projectPath = join(baseDir, projectDirName);
      try {
        const stat = await fs.stat(projectPath);
        if (!stat.isDirectory()) {
          continue;
        }

        if (indexed) {
          const dirName = caseInsensitive
            ? projectDirName.toLowerCase()
            : projectDirName;
          const matchesWorktree = indexed.some(
            ({ prefix }) =>
              dirName === prefix ||
              (prefix.length >= MAX_ENCODED_PREFIX_LENGTH &&
                dirName.startsWith(prefix + "-")),
          );
          if (!matchesWorktree) continue;
        }

        // Decode the encoded directory name back to the original project
        // path for display; fall back to the encoded name when the path was
        // truncated with a hash suffix (lossy, cannot be reliably reversed).
        const decodedWorkdir =
          encoder.decodeSync(projectDirName) ?? projectDirName;

        // Scan .jsonl files in the project directory
        const files = await fs.readdir(projectPath);

        for (const file of files) {
          if (!file.endsWith(".jsonl") || file.startsWith("subagent-")) {
            continue;
          }

          try {
            const filePath = join(projectPath, file);
            const uuidMatch = file.match(
              /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
            );
            if (!uuidMatch) continue;

            const sessionId = uuidMatch[1];
            const jsonlHandler = new JsonlHandler();
            const lastMessage = await jsonlHandler.getLastMessage(filePath);

            let lastActiveAt: Date;
            if (lastMessage) {
              lastActiveAt = new Date(lastMessage.timestamp);
            } else {
              const stats = await fs.stat(filePath);
              lastActiveAt = stats.mtime;
            }

            allSessions.push({
              id: sessionId,
              sessionType: "main" as const,
              subagentType: undefined,
              workdir: decodedWorkdir,
              createdAt: new Date(),
              lastActiveAt,
              latestTotalTokens: lastMessage?.usage
                ? extractLatestTotalTokens([lastMessage])
                : 0,
            });
          } catch {
            continue;
          }
        }
      } catch {
        // Skip if stat/readdir fails
      }
    }

    // Deduplicate by sessionId — the same session can appear in multiple
    // project dirs (e.g. worktree branches). Keep the newest lastActiveAt.
    const byId = new Map<string, SessionMetadata>();
    for (const session of allSessions) {
      const existing = byId.get(session.id);
      if (
        !existing ||
        session.lastActiveAt.getTime() > existing.lastActiveAt.getTime()
      ) {
        byId.set(session.id, session);
      }
    }

    return [...byId.values()].sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
  } catch (error) {
    throw new Error(`Failed to list all sessions: ${error}`);
  }
}

/**
 * Clean up expired sessions older than 14 days based on file modification time
 *
 * @param workdir - Working directory to clean up sessions for
 * @returns Promise that resolves to the number of sessions that were deleted
 */
export async function cleanupExpiredSessionsFromJsonl(
  workdir: string,
): Promise<number> {
  // Do not perform cleanup operations in test environment
  if (process.env.NODE_ENV === "test") {
    return 0;
  }

  try {
    const encoder = new PathEncoder();
    const projectDir = await encoder.getProjectDirectory(workdir, SESSION_DIR);
    const files = await fs.readdir(projectDir.encodedPath);

    const now = new Date();
    const maxAge = MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000; // Convert to milliseconds
    let deletedCount = 0;

    for (const file of files) {
      if (!file.endsWith(".jsonl")) {
        continue;
      }

      const filePath = join(projectDir.encodedPath, file);

      try {
        const stat = await fs.stat(filePath);
        const fileAge = now.getTime() - stat.mtime.getTime();

        if (fileAge > maxAge) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      } catch {
        // Skip failed operations and continue processing other files
        continue;
      }
    }

    // Clean up empty project directory if no files remain
    try {
      const remainingFiles = await fs.readdir(projectDir.encodedPath);
      if (remainingFiles.length === 0) {
        await fs.rmdir(projectDir.encodedPath);
      }
    } catch {
      // Ignore errors if directory is not empty or can't be removed
    }

    return deletedCount;
  } catch {
    // Return 0 if project directory doesn't exist or can't be accessed
    return 0;
  }
}

/**
 * Clean up empty project directories in the session directory
 */
export async function cleanupEmptyProjectDirectories(): Promise<void> {
  // Do not perform cleanup operations in test environment
  if (process.env.NODE_ENV === "test") {
    return;
  }

  try {
    const baseDir = SESSION_DIR;
    const projectDirs = await fs.readdir(baseDir);

    for (const projectDirName of projectDirs) {
      const projectPath = join(baseDir, projectDirName);
      const stat = await fs.stat(projectPath);

      if (stat.isDirectory()) {
        try {
          const files = await fs.readdir(projectPath);

          // If directory is empty, remove it
          if (files.length === 0) {
            await fs.rmdir(projectPath);
          }
        } catch {
          // Skip errors for directories we can't read or remove
          continue;
        }
      }
    }
  } catch {
    // Ignore errors if base directory doesn't exist or can't be accessed
  }
}

/**
 * Clean up "ghost" session files that contain only meta messages
 * (isMeta: true) — e.g. sessions where a SessionStart hook injected a
 * system-reminder but no real user/assistant message was ever sent.
 *
 * Such sessions are no longer created thanks to lazy materialization in
 * saveSession(); this one-time sweep removes files that predate that change
 * so they stop showing up as "0 tokens / No content" entries in the resume
 * list.
 *
 * @returns Promise that resolves to the number of files deleted
 */
export async function cleanupMetaOnlySessions(): Promise<number> {
  // Do not perform cleanup operations in test environment
  if (process.env.NODE_ENV === "test") {
    return 0;
  }

  let deletedCount = 0;
  try {
    const projectDirs = await fs.readdir(SESSION_DIR);

    for (const projectDirName of projectDirs) {
      const projectPath = join(SESSION_DIR, projectDirName);
      try {
        const stat = await fs.stat(projectPath);
        if (!stat.isDirectory()) {
          continue;
        }

        const files = await fs.readdir(projectPath);
        for (const file of files) {
          if (!file.endsWith(".jsonl")) {
            continue;
          }

          const filePath = join(projectPath, file);
          try {
            // Fast path: a file whose last message is not meta contains a
            // real message, so it can never be meta-only.
            const jsonlHandler = new JsonlHandler();
            const lastMessage = await jsonlHandler.getLastMessage(filePath);
            if (!lastMessage?.isMeta) {
              continue;
            }

            const messages = await jsonlHandler.read(filePath);
            if (messages.length > 0 && messages.every((m) => m.isMeta)) {
              await fs.unlink(filePath);
              deletedCount++;
            }
          } catch {
            // Skip corrupted or unreadable files
            continue;
          }
        }
      } catch {
        // Skip directories we can't access
        continue;
      }
    }
  } catch {
    // Ignore errors if base directory doesn't exist or can't be accessed
  }

  return deletedCount;
}

/**
 * Check if a session exists in JSONL storage (new approach)
 *
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent"). If not provided, checks both types.
 * @returns Promise that resolves to true if session exists, false otherwise
 */
export async function sessionExistsInJsonl(
  sessionId: string,
  workdir: string,
  sessionType?: "main" | "subagent",
): Promise<boolean> {
  try {
    if (sessionType) {
      // If session type is known, check directly
      const filePath = await generateSessionFilePath(
        sessionId,
        workdir,
        sessionType,
      );
      await fs.access(filePath);
      return true;
    } else {
      // If session type is unknown, try both
      const mainPath = await generateSessionFilePath(
        sessionId,
        workdir,
        "main",
      );
      try {
        await fs.access(mainPath);
        return true;
      } catch {
        const subagentPath = await generateSessionFilePath(
          sessionId,
          workdir,
          "subagent",
        );
        try {
          await fs.access(subagentPath);
          return true;
        } catch {
          return false;
        }
      }
    }
  } catch {
    return false;
  }
}

/**
 * Get the content of the first non-meta message in a session
 * For user role: get text block content
 * For assistant role: get compact block content
 * Skips meta messages (isMeta: true) to find the first meaningful message
 * @param sessionId - Session ID to get first message from
 * @param workdir - Working directory for session operations
 * @returns Promise that resolves to the first non-meta message content or null if not found
 */
export async function getFirstMessageContent(
  sessionId: string,
  workdir: string,
): Promise<string | null> {
  try {
    const encoder = new PathEncoder();
    const baseDir = SESSION_DIR;

    const projectDir = await encoder.getProjectDirectory(workdir, baseDir);
    const filePath = join(projectDir.encodedPath, `${sessionId}.jsonl`);

    // Read first N lines to skip meta messages
    const { readFirstNLines } = await import("../utils/fileUtils.js");
    const lines = await readFirstNLines(filePath, 10);

    for (const line of lines) {
      try {
        const message = JSON.parse(line) as Message;

        // Skip meta messages
        if (message.isMeta) {
          continue;
        }

        const content = getMessageContent(message);
        if (content) {
          return content;
        }
      } catch (error) {
        logger.warn(`Failed to parse message in session ${sessionId}:`, error);
      }
    }

    return null;
  } catch (error) {
    logger.warn(
      `Failed to get first message content for session ${sessionId}:`,
      error,
    );
    return null;
  }
}

/**
 * Delete a session
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 */
export async function deleteSession(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<void> {
  const filePath = await generateSessionFilePath(
    sessionId,
    workdir,
    sessionType,
  );
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Truncate content to a maximum length, adding ellipsis if truncated.
 * Also replaces real newlines with the literal string "\n".
 * @param content - The content to truncate
 * @param maxLength - Maximum length before truncation (default: 100)
 * @returns Truncated content with ellipsis if needed
 */
export function truncateContent(
  content: string,
  maxLength: number = 100,
): string {
  // Replace real newlines with literal "\n"
  const singleLineContent = content.replace(/\n/g, "\\n");

  if (singleLineContent.length <= maxLength) {
    return singleLineContent;
  }
  return singleLineContent.substring(0, maxLength) + "...";
}

/**
 * Handle session restoration logic
 * @param restoreSessionId - Specific session ID to restore
 * @param continueLastSession - Whether to continue the most recent session
 * @param workdir - Working directory for session restoration
 * @returns Promise that resolves to session data or undefined
 */
export async function handleSessionRestoration(
  restoreSessionId?: string,
  continueLastSession?: boolean,
  workdir?: string,
): Promise<SessionData | undefined> {
  if (!workdir) {
    throw new Error("Working directory is required for session restoration");
  }

  // Clean up expired sessions first
  cleanupExpiredSessionsFromJsonl(workdir).catch((error) => {
    logger.warn("Failed to cleanup expired sessions:", error);
  });

  if (!restoreSessionId && !continueLastSession) {
    return;
  }

  try {
    let sessionToRestore: SessionData | null = null;

    if (restoreSessionId) {
      // Use only JSONL format - no legacy support
      sessionToRestore = await loadSessionFromJsonl(restoreSessionId, workdir);
      if (!sessionToRestore) {
        // loadSessionFromJsonl already scans every project directory as a
        // fallback — reaching here means the session does not exist anywhere.
        // Surface a clear error instead of silently starting a fresh session.
        throw new Error(`Session ${restoreSessionId} not found on disk`);
      }
    } else if (continueLastSession) {
      // Use only JSONL format - no legacy support
      sessionToRestore = await getLatestSessionFromJsonl(workdir);
      if (!sessionToRestore) {
        throw new Error(`No previous session found for workdir: ${workdir}`);
      }
    }

    if (sessionToRestore) {
      console.log(`Restoring session: ${sessionToRestore.id}`);

      // // Initialize from session data
      // this.initializeFromSession();
      return sessionToRestore;
    }
  } catch (error) {
    console.error("Failed to restore session:", error);
    throw error;
  }
}

/**
 * Load the full message thread for a session.
 * With append-only compaction, all messages are in a single file.
 * Unlike loadSessionFromJsonl, this returns every message in the file,
 * including those before the last compact boundary — rewind needs the
 * complete history to allow rewinding past compaction points.
 * @param currentSessionId - The ID of the current session
 * @param workdir - Working directory for the session
 * @returns Promise that resolves to an array of all messages in the thread
 */
export async function loadFullMessageThread(
  currentSessionId: string,
  workdir: string,
): Promise<{ messages: Message[]; sessionIds: string[] }> {
  const jsonlHandler = new JsonlHandler();
  const filePath = await generateSessionFilePath(
    currentSessionId,
    workdir,
    "main",
  );

  try {
    await fs.access(filePath);
  } catch {
    return { messages: [], sessionIds: [] };
  }

  const messages = await jsonlHandler.read(filePath);
  return { messages, sessionIds: [currentSessionId] };
}
