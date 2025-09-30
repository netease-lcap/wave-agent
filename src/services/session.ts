import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Message } from "../types";

export interface SessionData {
  id: string;
  timestamp: string;
  version: string;
  metadata: {
    workdir: string;
    startedAt: string;
    lastActiveAt: string;
    totalTokens: number;
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
  totalTokens: number;
}

// Constants
const SESSION_DIR = join(homedir(), ".lcap-code", "sessions");
const VERSION = "1.0.0";
const MAX_SESSION_AGE_DAYS = 30;

/**
 * 确保会话目录存在
 */
async function ensureSessionDir(): Promise<void> {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create session directory: ${error}`);
  }
}

/**
 * 生成会话文件路径
 */
function getSessionFilePath(sessionId: string): string {
  const shortId = sessionId.split("_")[2] || sessionId.slice(-8);
  return join(SESSION_DIR, `session_${shortId}.json`);
}

/**
 * 保存会话数据
 */
export async function saveSession(
  sessionId: string,
  messages: Message[],
  totalTokens: number = 0,
  startedAt?: string,
): Promise<void> {
  // 在测试环境下不保存session文件
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
      workdir: process.cwd(),
      startedAt: startedAt || now,
      lastActiveAt: now,
      totalTokens,
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
 * 加载会话数据
 */
export async function loadSession(
  sessionId: string,
): Promise<SessionData | null> {
  const filePath = getSessionFilePath(sessionId);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const sessionData = JSON.parse(content) as SessionData;

    // 验证会话数据格式
    if (!sessionData.id || !sessionData.state || !sessionData.metadata) {
      throw new Error("Invalid session data format");
    }

    return sessionData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null; // 会话文件不存在
    }
    throw new Error(`Failed to load session ${sessionId}: ${error}`);
  }
}

/**
 * 获取最近的会话
 */
export async function getLatestSession(): Promise<SessionData | null> {
  const sessions = await listSessions();
  if (sessions.length === 0) {
    return null;
  }

  // 按最后活跃时间排序，返回最新的
  const latestSession = sessions.sort(
    (a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  )[0];

  return loadSession(latestSession.id);
}

/**
 * 列出所有会话
 */
export async function listSessions(): Promise<SessionMetadata[]> {
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

        // 只返回当前工作目录的会话
        if (sessionData.metadata.workdir !== process.cwd()) {
          continue;
        }

        sessions.push({
          id: sessionData.id,
          timestamp: sessionData.timestamp,
          workdir: sessionData.metadata.workdir,
          startedAt: sessionData.metadata.startedAt,
          lastActiveAt: sessionData.metadata.lastActiveAt,
          totalTokens: sessionData.metadata.totalTokens,
        });
      } catch {
        // 忽略损坏的会话文件
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
 * 删除会话
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const filePath = getSessionFilePath(sessionId);

  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false; // 文件不存在
    }
    throw new Error(`Failed to delete session ${sessionId}: ${error}`);
  }
}

/**
 * 清理过期会话
 */
export async function cleanupExpiredSessions(): Promise<number> {
  // 在测试环境下不执行清理操作
  if (process.env.NODE_ENV === "test") {
    return 0;
  }

  const sessions = await listSessions();
  const now = new Date();
  const maxAge = MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000; // 转换为毫秒

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
 * 检查会话是否存在
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
