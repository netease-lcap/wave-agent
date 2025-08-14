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
    ignore?: string[];
    startedAt: string;
    lastActiveAt: string;
    totalTokens: number;
  };
  state: {
    messages: Message[];
    inputHistory: string[];
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

export class SessionManager {
  private static readonly SESSION_DIR = join(
    homedir(),
    ".lcap-code",
    "sessions",
  );
  private static readonly VERSION = "1.0.0";
  private static readonly MAX_SESSION_AGE_DAYS = 30;

  /**
   * 确保会话目录存在
   */
  private static async ensureSessionDir(): Promise<void> {
    try {
      await fs.mkdir(this.SESSION_DIR, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create session directory: ${error}`);
    }
  }

  /**
   * 生成会话文件路径
   */
  private static getSessionFilePath(sessionId: string): string {
    const timestamp = sessionId.split("_")[1] || Date.now().toString();
    const shortId = sessionId.split("_")[2] || sessionId.slice(-8);
    return join(this.SESSION_DIR, `session_${timestamp}_${shortId}.json`);
  }

  /**
   * 保存会话数据
   */
  static async saveSession(
    sessionId: string,
    messages: Message[],
    inputHistory: string[],
    workdir: string,
    ignore?: string[],
    totalTokens: number = 0,
    startedAt?: string,
  ): Promise<void> {
    // 在测试环境下不保存session文件
    if (process.env.NODE_ENV === "test") {
      return;
    }

    await this.ensureSessionDir();

    const now = new Date().toISOString();
    const sessionData: SessionData = {
      id: sessionId,
      timestamp: now,
      version: this.VERSION,
      metadata: {
        workdir,
        ignore,
        startedAt: startedAt || now,
        lastActiveAt: now,
        totalTokens,
      },
      state: {
        messages,
        inputHistory,
      },
    };

    const filePath = this.getSessionFilePath(sessionId);
    try {
      await fs.writeFile(
        filePath,
        JSON.stringify(sessionData, null, 2),
        "utf-8",
      );
    } catch (error) {
      throw new Error(`Failed to save session ${sessionId}: ${error}`);
    }
  }

  /**
   * 加载会话数据
   */
  static async loadSession(sessionId: string): Promise<SessionData | null> {
    const filePath = this.getSessionFilePath(sessionId);

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
  static async getLatestSession(workdir?: string): Promise<SessionData | null> {
    const sessions = await this.listSessions(workdir);
    if (sessions.length === 0) {
      return null;
    }

    // 按最后活跃时间排序，返回最新的
    const latestSession = sessions.sort(
      (a, b) =>
        new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
    )[0];

    return this.loadSession(latestSession.id);
  }

  /**
   * 列出所有会话
   */
  static async listSessions(workdir?: string): Promise<SessionMetadata[]> {
    try {
      await this.ensureSessionDir();
      const files = await fs.readdir(this.SESSION_DIR);

      const sessions: SessionMetadata[] = [];

      for (const file of files) {
        if (!file.startsWith("session_") || !file.endsWith(".json")) {
          continue;
        }

        try {
          const filePath = join(this.SESSION_DIR, file);
          const content = await fs.readFile(filePath, "utf-8");
          const sessionData = JSON.parse(content) as SessionData;

          // 如果指定了workdir，只返回该目录的会话
          if (workdir && sessionData.metadata.workdir !== workdir) {
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
          new Date(b.lastActiveAt).getTime() -
          new Date(a.lastActiveAt).getTime(),
      );
    } catch (error) {
      throw new Error(`Failed to list sessions: ${error}`);
    }
  }

  /**
   * 删除会话
   */
  static async deleteSession(sessionId: string): Promise<boolean> {
    const filePath = this.getSessionFilePath(sessionId);

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
  static async cleanupExpiredSessions(workdir?: string): Promise<number> {
    // 在测试环境下不执行清理操作
    if (process.env.NODE_ENV === "test") {
      return 0;
    }

    const sessions = await this.listSessions(workdir);
    const now = new Date();
    const maxAge = this.MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000; // 转换为毫秒

    let deletedCount = 0;

    for (const session of sessions) {
      const sessionAge =
        now.getTime() - new Date(session.lastActiveAt).getTime();

      if (sessionAge > maxAge) {
        try {
          await this.deleteSession(session.id);
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
  static async sessionExists(sessionId: string): Promise<boolean> {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
