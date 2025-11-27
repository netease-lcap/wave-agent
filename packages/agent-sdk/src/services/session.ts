import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import { v6 as uuidv6 } from "uuid";
import type { Message } from "../types/index.js";
import type { SessionMessage } from "../types/session.js";
import { PathEncoder } from "../utils/pathEncoder.js";
import { JsonlHandler } from "../services/jsonlHandler.js";

export interface SessionData {
  id: string;
  messages: Message[];
  metadata: {
    workdir: string;
    startedAt: string;
    lastActiveAt: string;
    latestTotalTokens: number;
  };
}

export interface SessionMetadata {
  id: string;
  sessionType: "main" | "subagent";
  parentSessionId?: string;
  subagentType?: string;
  workdir: string;
  startedAt: Date;
  lastActiveAt: Date;
  latestTotalTokens: number;
}

/**
 * Generate a new UUIDv6-based session ID
 * @returns UUIDv6 string for time-ordered sessions
 */
export function generateSessionId(): string {
  return uuidv6();
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
 * Generate session file path using project-based directory structure
 * Note: With metadata-based approach, we no longer need separate subagent directories
 * @param sessionId - UUIDv6 session identifier
 * @param workdir - Working directory for the session
 * @returns Promise resolving to full file path for the session JSONL file
 */
export async function getSessionFilePath(
  sessionId: string,
  workdir: string,
): Promise<string> {
  const encoder = new PathEncoder();
  const projectDir = await encoder.createProjectDirectory(workdir, SESSION_DIR);

  // All sessions (main and subagent) now go in the same directory
  // Session type is determined by metadata, not file path
  return join(projectDir.encodedPath, `${sessionId}.jsonl`);
}

/**
 * Create a new session with metadata
 * @param sessionId - UUIDv6 session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ('main' or 'subagent')
 * @param parentSessionId - Parent session ID for subagent sessions
 * @param subagentType - Type of subagent for subagent sessions
 */
export async function createSession(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
  parentSessionId?: string,
  subagentType?: string,
): Promise<void> {
  const jsonlHandler = new JsonlHandler();
  const filePath = await getSessionFilePath(sessionId, workdir);
  await jsonlHandler.createSession(
    filePath,
    sessionId,
    workdir,
    sessionType,
    parentSessionId,
    subagentType,
  );
}

/**
 * Append messages to session using JSONL format (new approach)
 *
 * @param sessionId - UUIDv6 session identifier
 * @param newMessages - Array of messages to append
 * @param workdir - Working directory for the session
 */
export async function appendMessages(
  sessionId: string,
  newMessages: Message[],
  workdir: string,
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
  const filePath = await getSessionFilePath(sessionId, workdir);

  // Check if session file exists, throw error if it doesn't
  try {
    await fs.access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist, throw error - sessions must be created explicitly
      throw new Error(
        `Session file not found: ${sessionId}. Use createSession() to create a new session first.`,
      );
    } else {
      // Some other error accessing the file, re-throw it
      throw error;
    }
  }

  const messagesWithTimestamp: SessionMessage[] = newMessages.map((msg) => ({
    timestamp: new Date().toISOString(),
    ...msg,
  }));

  await jsonlHandler.append(filePath, messagesWithTimestamp, { atomic: false });
}

/**
 * Load session data from JSONL file (new approach)
 *
 * @param sessionId - UUIDv6 session identifier
 * @param workdir - Working directory for the session
 * @returns Promise that resolves to session data or null if session doesn't exist
 */
export async function loadSessionFromJsonl(
  sessionId: string,
  workdir: string,
): Promise<SessionData | null> {
  try {
    const jsonlHandler = new JsonlHandler();
    const filePath = await getSessionFilePath(sessionId, workdir);

    const messages = await jsonlHandler.read(filePath);

    if (messages.length === 0) {
      return null;
    }

    // Extract metadata from messages
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];

    const sessionData: SessionData = {
      id: sessionId,
      messages: messages.map((msg) => {
        // Remove timestamp property for backward compatibility
        const { timestamp: _ignored, ...messageWithoutTimestamp } = msg;
        void _ignored; // Use the variable to avoid eslint error
        return messageWithoutTimestamp;
      }),
      metadata: {
        workdir,
        startedAt: firstMessage.timestamp,
        lastActiveAt: lastMessage.timestamp,
        latestTotalTokens: lastMessage.usage?.total_tokens || 0,
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
 * Get the most recent session for a specific working directory (new JSONL approach)
 * Only returns main sessions, skips subagent sessions
 *
 * @param workdir - Working directory to find the most recent session for
 * @returns Promise that resolves to the most recent session data or null if no sessions exist
 */
export async function getLatestSessionFromJsonl(
  workdir: string,
): Promise<SessionData | null> {
  const sessions = await listSessionsFromJsonl(workdir, false); // Uses default includeSubagentSessions = false

  if (sessions.length === 0) {
    return null;
  }

  // UUIDv6 sessions are naturally time-ordered, so we can sort by ID
  const latestSession = sessions.sort((a, b) => b.id.localeCompare(a.id))[0];
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
  return listSessionsFromJsonl(workdir, false); // Uses default includeSubagentSessions = false
}

/**
 * List all sessions for a specific working directory using JSONL format (new approach)
 *
 * @param workdir - Working directory to filter sessions by
 * @param includeAllWorkdirs - If true, returns sessions from all working directories
 * @param includeSubagentSessions - If true, includes subagent sessions (default: false for user-facing operations)
 * @returns Promise that resolves to array of session metadata objects
 */
export async function listSessionsFromJsonl(
  workdir: string,
  includeAllWorkdirs = false,
  includeSubagentSessions = false,
): Promise<SessionMetadata[]> {
  try {
    const encoder = new PathEncoder();
    const baseDir = SESSION_DIR;

    // If not including all workdirs, just scan the specific project directory
    if (!includeAllWorkdirs) {
      const projectDir = await encoder.createProjectDirectory(workdir, baseDir);
      const files = await fs.readdir(projectDir.encodedPath);

      const sessions: SessionMetadata[] = [];

      for (const file of files) {
        if (!file.endsWith(".jsonl")) {
          continue;
        }

        const sessionId = file.replace(".jsonl", "");
        try {
          const jsonlHandler = new JsonlHandler();
          const filePath = join(projectDir.encodedPath, file);

          // Try to read metadata first (efficient O(1) operation)
          const metadata = await jsonlHandler.readMetadata(filePath);
          if (metadata) {
            // Use metadata for efficient session listing

            // For lastActiveAt and latestTotalTokens, we need the last message
            const lastMessage = await jsonlHandler.getLastMessage(filePath);

            sessions.push({
              id: sessionId,
              sessionType: metadata.sessionType,
              parentSessionId: metadata.parentSessionId,
              subagentType: metadata.subagentType,
              workdir: metadata.workdir,
              startedAt: new Date(metadata.startedAt),
              lastActiveAt: lastMessage
                ? new Date(lastMessage.timestamp)
                : new Date(metadata.startedAt),
              latestTotalTokens: lastMessage?.usage?.total_tokens || 0,
            });
          } else {
            // Fallback for legacy sessions without metadata
            const messages = await jsonlHandler.read(filePath, { limit: 1 });
            const lastMessage = await jsonlHandler.getLastMessage(filePath);

            if (messages.length > 0 && lastMessage) {
              const firstMessage = messages[0];

              sessions.push({
                id: sessionId,
                sessionType: "main", // Default for existing sessions
                workdir,
                startedAt: new Date(firstMessage.timestamp),
                lastActiveAt: new Date(lastMessage.timestamp),
                latestTotalTokens: lastMessage.usage?.total_tokens || 0,
              });
            }
          }
        } catch {
          // Skip corrupted session files
          continue;
        }
      }

      // UUIDv6 is time-ordered, so we can sort by ID (newest first)
      const sortedSessions = sessions.sort((a, b) => b.id.localeCompare(a.id));

      // Filter out subagent sessions if requested
      if (!includeSubagentSessions) {
        return sortedSessions.filter(
          (session) => session.sessionType === "main",
        );
      }

      return sortedSessions;
    }

    // For all workdirs, scan all project directories
    const sessions: SessionMetadata[] = [];
    try {
      const projectDirs = await fs.readdir(baseDir);

      for (const projectDirName of projectDirs) {
        const projectPath = join(baseDir, projectDirName);
        const stat = await fs.stat(projectPath);

        if (!stat.isDirectory()) {
          continue;
        }

        const files = await fs.readdir(projectPath);

        for (const file of files) {
          if (!file.endsWith(".jsonl")) {
            continue;
          }

          const sessionId = file.replace(".jsonl", "");
          try {
            const jsonlHandler = new JsonlHandler();
            const filePath = join(projectPath, file);

            // Try to read metadata first (efficient O(1) operation)
            const metadata = await jsonlHandler.readMetadata(filePath);
            if (metadata) {
              // Use metadata for efficient session listing

              // For lastActiveAt and latestTotalTokens, we need the last message
              const lastMessage = await jsonlHandler.getLastMessage(filePath);

              sessions.push({
                id: sessionId,
                sessionType: metadata.sessionType,
                parentSessionId: metadata.parentSessionId,
                subagentType: metadata.subagentType,
                workdir: metadata.workdir,
                startedAt: new Date(metadata.startedAt),
                lastActiveAt: lastMessage
                  ? new Date(lastMessage.timestamp)
                  : new Date(metadata.startedAt),
                latestTotalTokens: lastMessage?.usage?.total_tokens || 0,
              });
            } else {
              // Fallback for legacy sessions without metadata
              const messages = await jsonlHandler.read(filePath, { limit: 1 });
              const lastMessage = await jsonlHandler.getLastMessage(filePath);

              if (messages.length > 0 && lastMessage) {
                const firstMessage = messages[0];

                // Decode the project directory to get workdir
                const encoder = new PathEncoder();
                const projectWorkdir = await encoder.decode(projectDirName);

                // Skip if we can't decode the project directory
                if (!projectWorkdir) {
                  continue;
                }

                sessions.push({
                  id: sessionId,
                  sessionType: "main", // Default for existing sessions
                  workdir: projectWorkdir,
                  startedAt: new Date(firstMessage.timestamp),
                  lastActiveAt: new Date(lastMessage.timestamp),
                  latestTotalTokens: lastMessage.usage?.total_tokens || 0,
                });
              }
            }
          } catch {
            // Skip corrupted session files
            continue;
          }
        }
      }
    } catch {
      // If base directory doesn't exist, return empty array
      return [];
    }

    // UUIDv6 is time-ordered, so we can sort by ID (newest first)
    const sortedSessions = sessions.sort((a, b) => b.id.localeCompare(a.id));

    // Filter out subagent sessions if requested
    if (!includeSubagentSessions) {
      return sortedSessions.filter((session) => session.sessionType === "main");
    }

    return sortedSessions;
  } catch (error) {
    throw new Error(`Failed to list sessions: ${error}`);
  }
}

/**
 * Delete a session from JSONL storage (new approach)
 *
 * @param sessionId - UUIDv6 session identifier
 * @param workdir - Working directory for the session
 * @returns Promise that resolves to true if session was deleted, false if it didn't exist
 */
export async function deleteSessionFromJsonl(
  sessionId: string,
  workdir: string,
): Promise<boolean> {
  try {
    const filePath = await getSessionFilePath(sessionId, workdir);
    await fs.unlink(filePath);

    // Try to clean up empty project directory
    const encoder = new PathEncoder();
    const projectDir = await encoder.createProjectDirectory(
      workdir,
      SESSION_DIR,
    );
    try {
      const files = await fs.readdir(projectDir.encodedPath);
      if (files.length === 0) {
        await fs.rmdir(projectDir.encodedPath);
      }
    } catch {
      // Ignore errors if directory is not empty or can't be removed
    }

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false; // File does not exist
    }
    throw new Error(`Failed to delete session ${sessionId}: ${error}`);
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
    const projectDir = await encoder.createProjectDirectory(
      workdir,
      SESSION_DIR,
    );
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
 * Check if a session exists in JSONL storage (new approach)
 *
 * @param sessionId - UUIDv6 session identifier
 * @param workdir - Working directory for the session
 * @returns Promise that resolves to true if session exists, false otherwise
 */
export async function sessionExistsInJsonl(
  sessionId: string,
  workdir: string,
): Promise<boolean> {
  try {
    const filePath = await getSessionFilePath(sessionId, workdir);
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
