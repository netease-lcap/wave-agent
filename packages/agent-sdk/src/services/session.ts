import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Message } from "../types.js";

export interface SessionData {
  id: string;
  timestamp: string;
  version: string;
  metadata: {
    workdir: string;
    startedAt: string;
    lastActiveAt: string;
    latestTotalTokens: number;
  };
  state: {
    messages: Message[];
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
 * Ensure session directory exists
 */
async function ensureSessionDir(): Promise<void> {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create session directory: ${error}`);
  }
}

/**
 * Generate session file path
 */
export function getSessionFilePath(sessionId: string): string {
  const shortId = sessionId.split("_")[2] || sessionId.slice(-8);
  return join(SESSION_DIR, `session_${shortId}.json`);
}

/**
 * Save session data
 */
export async function saveSession(
  sessionId: string,
  messages: Message[],
  workdir: string,
  latestTotalTokens: number = 0,
  startedAt?: string,
): Promise<void> {
  // Do not save session files in test environment
  if (process.env.NODE_ENV === "test") {
    return;
  }

  await ensureSessionDir();

  const now = new Date().toISOString();
  const sessionData: SessionData = {
    id: sessionId,
    timestamp: now,
    version: VERSION,
    metadata: {
      workdir: workdir,
      startedAt: startedAt || now,
      lastActiveAt: now,
      latestTotalTokens,
    },
    state: {
      messages,
    },
  };

  const filePath = getSessionFilePath(sessionId);
  try {
    await fs.writeFile(filePath, JSON.stringify(sessionData, null, 2), "utf-8");
  } catch (error) {
    throw new Error(`Failed to save session ${sessionId}: ${error}`);
  }
}

/**
 * Load session data
 */
export async function loadSession(
  sessionId: string,
): Promise<SessionData | null> {
  const filePath = getSessionFilePath(sessionId);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const sessionData = JSON.parse(content) as SessionData;

    // Validate session data format
    if (!sessionData.id || !sessionData.state || !sessionData.metadata) {
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
 * Get most recent session
 */
export async function getLatestSession(
  workdir: string,
): Promise<SessionData | null> {
  const sessions = await listSessions(workdir);
  if (sessions.length === 0) {
    return null;
  }

  // Sort by last active time, return the latest
  const latestSession = sessions.sort(
    (a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  )[0];

  return loadSession(latestSession.id);
}

/**
 * List all sessions
 */
export async function listSessions(
  workdir: string,
  includeAllWorkdirs = false,
): Promise<SessionMetadata[]> {
  try {
    await ensureSessionDir();
    const files = await fs.readdir(SESSION_DIR);

    const sessions: SessionMetadata[] = [];

    for (const file of files) {
      if (!file.startsWith("session_") || !file.endsWith(".json")) {
        continue;
      }

      try {
        const filePath = join(SESSION_DIR, file);
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
 * Delete session
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const filePath = getSessionFilePath(sessionId);

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
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(workdir: string): Promise<number> {
  // Do not perform cleanup operations in test environment
  if (process.env.NODE_ENV === "test") {
    return 0;
  }

  const sessions = await listSessions(workdir, true);
  const now = new Date();
  const maxAge = MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000; // Convert to milliseconds

  let deletedCount = 0;

  for (const session of sessions) {
    const sessionAge = now.getTime() - new Date(session.lastActiveAt).getTime();

    if (sessionAge > maxAge) {
      try {
        await deleteSession(session.id);
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
 * Check if session exists
 */
export async function sessionExists(sessionId: string): Promise<boolean> {
  const filePath = getSessionFilePath(sessionId);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
