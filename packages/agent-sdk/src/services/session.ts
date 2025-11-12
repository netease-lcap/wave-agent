import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Message } from "../types/index.js";

export interface SessionData {
  id: string;
  timestamp: string;
  version: string;
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
  timestamp: string;
  workdir: string;
  startedAt: string;
  lastActiveAt: string;
  latestTotalTokens: number;
}

// Constants
const SESSION_DIR = join(homedir(), ".wave", "sessions");
const VERSION = "1.0.0";
const MAX_SESSION_AGE_DAYS = 30;

/**
 * Resolve session directory path with fallback to default
 * @param sessionDir Optional custom session directory
 * @returns Resolved session directory path
 */
export function resolveSessionDir(sessionDir?: string): string {
  return sessionDir || SESSION_DIR;
}

/**
 * Ensure session directory exists
 * @param sessionDir Optional custom session directory
 */
export async function ensureSessionDir(sessionDir?: string): Promise<void> {
  const resolvedDir = resolveSessionDir(sessionDir);
  try {
    await fs.mkdir(resolvedDir, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create session directory: ${error}`);
  }
}

/**
 * Generate session file path
 */
export function getSessionFilePath(
  sessionId: string,
  sessionDir?: string,
): string {
  const shortId = sessionId.split("_")[2] || sessionId.slice(-8);
  const resolvedDir = resolveSessionDir(sessionDir);
  return join(resolvedDir, `session_${shortId}.json`);
}

/**
 * Filter out diff blocks from messages to avoid saving unimportant data
 */
function filterDiffBlocks(messages: Message[]): Message[] {
  return messages
    .map((message) => ({
      ...message,
      blocks: message.blocks.filter((block) => block.type !== "diff"),
    }))
    .filter((message) => message.blocks.length > 0);
}

/**
 * Save session data to storage
 *
 * @param sessionId - Unique identifier for the session
 * @param messages - Array of messages to save
 * @param workdir - Working directory for the session
 * @param latestTotalTokens - Total tokens used in the session
 * @param startedAt - ISO timestamp when session started (defaults to current time)
 * @param sessionDir - Optional custom directory for session storage (defaults to ~/.wave/sessions/)
 * @throws {Error} When session cannot be saved due to permission or disk space issues
 */
export async function saveSession(
  sessionId: string,
  messages: Message[],
  workdir: string,
  latestTotalTokens: number = 0,
  startedAt?: string,
  sessionDir?: string,
): Promise<void> {
  // Do not save session files in test environment
  if (process.env.NODE_ENV === "test") {
    return;
  }

  // Do not save if there are no messages
  if (messages.length === 0) {
    return;
  }

  await ensureSessionDir(sessionDir);

  // Filter out diff blocks before saving
  const filteredMessages = filterDiffBlocks(messages);

  const now = new Date().toISOString();
  const sessionData: SessionData = {
    id: sessionId,
    timestamp: now,
    version: VERSION,
    messages: filteredMessages,
    metadata: {
      workdir: workdir,
      startedAt: startedAt || now,
      lastActiveAt: now,
      latestTotalTokens,
    },
  };

  const filePath = getSessionFilePath(sessionId, sessionDir);
  try {
    await fs.writeFile(filePath, JSON.stringify(sessionData, null, 2), "utf-8");
  } catch (error) {
    throw new Error(`Failed to save session ${sessionId}: ${error}`);
  }
}

/**
 * Load session data from storage
 *
 * @param sessionId - Unique identifier for the session to load
 * @param sessionDir - Optional custom directory for session storage (defaults to ~/.wave/sessions/)
 * @returns Promise that resolves to session data or null if session doesn't exist
 * @throws {Error} When session exists but cannot be read or contains invalid data
 */
export async function loadSession(
  sessionId: string,
  sessionDir?: string,
): Promise<SessionData | null> {
  const filePath = getSessionFilePath(sessionId, sessionDir);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const sessionData = JSON.parse(content) as SessionData;

    // Validate session data format
    if (!sessionData.id || !sessionData.messages || !sessionData.metadata) {
      throw new Error("Invalid session data format");
    }

    return sessionData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null; // Session file does not exist
    }
    throw new Error(`Failed to load session ${sessionId}: ${error}`);
  }
}

/**
 * Get the most recent session for a specific working directory
 *
 * @param workdir - Working directory to find the most recent session for
 * @param sessionDir - Optional custom directory for session storage (defaults to ~/.wave/sessions/)
 * @returns Promise that resolves to the most recent session data or null if no sessions exist
 * @throws {Error} When session directory cannot be accessed or session data is corrupted
 */
export async function getLatestSession(
  workdir: string,
  sessionDir?: string,
): Promise<SessionData | null> {
  const sessions = await listSessions(workdir, false, sessionDir);
  if (sessions.length === 0) {
    return null;
  }

  // Sort by last active time, return the latest
  const latestSession = sessions.sort(
    (a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  )[0];

  return loadSession(latestSession.id, sessionDir);
}

/**
 * List all sessions for a specific working directory or across all working directories
 *
 * @param workdir - Working directory to filter sessions by
 * @param includeAllWorkdirs - If true, returns sessions from all working directories
 * @param sessionDir - Optional custom directory for session storage (defaults to ~/.wave/sessions/)
 * @returns Promise that resolves to array of session metadata objects
 * @throws {Error} When session directory cannot be accessed or read
 */
export async function listSessions(
  workdir: string,
  includeAllWorkdirs = false,
  sessionDir?: string,
): Promise<SessionMetadata[]> {
  try {
    await ensureSessionDir(sessionDir);
    const resolvedDir = resolveSessionDir(sessionDir);
    const files = await fs.readdir(resolvedDir);

    const sessions: SessionMetadata[] = [];

    for (const file of files) {
      if (!file.startsWith("session_") || !file.endsWith(".json")) {
        continue;
      }

      try {
        const filePath = join(resolvedDir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const sessionData = JSON.parse(content) as SessionData;

        // Only return sessions for the current working directory, unless includeAllWorkdirs is true
        if (!includeAllWorkdirs && sessionData.metadata.workdir !== workdir) {
          continue;
        }

        sessions.push({
          id: sessionData.id,
          timestamp: sessionData.timestamp,
          workdir: sessionData.metadata.workdir,
          startedAt: sessionData.metadata.startedAt,
          lastActiveAt: sessionData.metadata.lastActiveAt,
          latestTotalTokens: sessionData.metadata.latestTotalTokens,
        });
      } catch {
        // Ignore corrupted session files
        console.warn(`Skipping corrupted session file: ${file}`);
      }
    }

    return sessions.sort(
      (a, b) =>
        new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
    );
  } catch (error) {
    throw new Error(`Failed to list sessions: ${error}`);
  }
}

/**
 * Delete a session from storage
 *
 * @param sessionId - Unique identifier for the session to delete
 * @param sessionDir - Optional custom directory for session storage (defaults to ~/.wave/sessions/)
 * @returns Promise that resolves to true if session was deleted, false if it didn't exist
 * @throws {Error} When session exists but cannot be deleted due to permission issues
 */
export async function deleteSession(
  sessionId: string,
  sessionDir?: string,
): Promise<boolean> {
  const filePath = getSessionFilePath(sessionId, sessionDir);

  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false; // File does not exist
    }
    throw new Error(`Failed to delete session ${sessionId}: ${error}`);
  }
}

/**
 * Clean up expired sessions older than the configured maximum age
 *
 * @param workdir - Working directory to clean up sessions for
 * @param sessionDir - Optional custom directory for session storage (defaults to ~/.wave/sessions/)
 * @returns Promise that resolves to the number of sessions that were deleted
 * @throws {Error} When session directory cannot be accessed or sessions cannot be deleted
 */
export async function cleanupExpiredSessions(
  workdir: string,
  sessionDir?: string,
): Promise<number> {
  // Do not perform cleanup operations in test environment
  if (process.env.NODE_ENV === "test") {
    return 0;
  }

  const sessions = await listSessions(workdir, true, sessionDir);
  const now = new Date();
  const maxAge = MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000; // Convert to milliseconds

  let deletedCount = 0;

  for (const session of sessions) {
    const sessionAge = now.getTime() - new Date(session.lastActiveAt).getTime();

    if (sessionAge > maxAge) {
      try {
        await deleteSession(session.id, sessionDir);
        deletedCount++;
      } catch (error) {
        console.warn(
          `Failed to delete expired session ${session.id}: ${error}`,
        );
      }
    }
  }

  return deletedCount;
}

/**
 * Check if a session exists in storage
 *
 * @param sessionId - Unique identifier for the session to check
 * @param sessionDir - Optional custom directory for session storage (defaults to ~/.wave/sessions/)
 * @returns Promise that resolves to true if session exists, false otherwise
 */
export async function sessionExists(
  sessionId: string,
  sessionDir?: string,
): Promise<boolean> {
  const filePath = getSessionFilePath(sessionId, sessionDir);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
