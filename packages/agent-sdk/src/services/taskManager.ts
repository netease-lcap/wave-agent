import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Task } from "../types/tasks.js";
import { logger } from "../utils/globalLogger.js";

export class TaskManager {
  private readonly baseDir: string;

  constructor() {
    this.baseDir = join(homedir(), ".wave", "tasks");
  }

  private getSessionDir(sessionId: string): string {
    return join(this.baseDir, sessionId);
  }

  private getTaskPath(sessionId: string, taskId: string): string {
    return join(this.getSessionDir(sessionId), `${taskId}.json`);
  }

  private getLockPath(sessionId: string, taskId: string): string {
    return join(this.getSessionDir(sessionId), `${taskId}.lock`);
  }

  async ensureSessionDir(sessionId: string): Promise<void> {
    await fs.mkdir(this.getSessionDir(sessionId), { recursive: true });
  }

  private async withLock<T>(
    sessionId: string,
    taskId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockPath = this.getLockPath(sessionId, taskId);
    let lockHandle;
    const maxRetries = 10;
    const retryDelay = process.env.NODE_ENV === "test" ? 10 : 100;

    for (let i = 0; i < maxRetries; i++) {
      try {
        lockHandle = await fs.open(lockPath, "wx");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          if (i === maxRetries - 1) {
            throw new Error(
              `Could not acquire lock for task ${taskId} after ${maxRetries} retries`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }
        throw error;
      }
    }

    try {
      return await operation();
    } finally {
      if (lockHandle) {
        await lockHandle.close();
      }
      try {
        await fs.unlink(lockPath);
      } catch (error) {
        logger.error(`Failed to release lock for task ${taskId}:`, error);
      }
    }
  }

  private validateTask(task: Task): void {
    if (!task.id || typeof task.id !== "string")
      throw new Error("Invalid task ID");
    if (!task.subject || typeof task.subject !== "string")
      throw new Error("Invalid task subject");
    if (!task.description || typeof task.description !== "string")
      throw new Error("Invalid task description");
    if (
      !task.status ||
      !["pending", "in_progress", "completed", "deleted"].includes(task.status)
    ) {
      throw new Error(`Invalid task status: ${task.status}`);
    }
  }

  async createTask(sessionId: string, task: Task): Promise<void> {
    this.validateTask(task);
    await this.ensureSessionDir(sessionId);
    await this.withLock(sessionId, task.id, async () => {
      const taskPath = this.getTaskPath(sessionId, task.id);
      const content = JSON.stringify(task, null, 2);
      await fs.writeFile(taskPath, content, "utf8");
      logger.info(`Task ${task.id} created in session ${sessionId}`);
    });
  }

  async getTask(sessionId: string, taskId: string): Promise<Task | null> {
    const taskPath = this.getTaskPath(sessionId, taskId);
    try {
      const content = await fs.readFile(taskPath, "utf8");
      try {
        return JSON.parse(content.trim()) as Task;
      } catch (parseError) {
        logger.error(`Failed to parse task file ${taskPath}:`, parseError);
        logger.error(`Corrupted content: ${content}`);
        throw parseError;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async updateTask(sessionId: string, task: Task): Promise<void> {
    this.validateTask(task);
    await this.withLock(sessionId, task.id, async () => {
      const taskPath = this.getTaskPath(sessionId, task.id);
      const content = JSON.stringify(task, null, 2);
      await fs.writeFile(taskPath, content, "utf8");
      logger.info(`Task ${task.id} updated in session ${sessionId}`);
    });
  }

  async listTasks(sessionId: string): Promise<Task[]> {
    const sessionDir = this.getSessionDir(sessionId);
    try {
      const files = await fs.readdir(sessionDir);
      const taskFiles = files.filter((f) => f.endsWith(".json"));

      const tasks = await Promise.all(
        taskFiles.map(async (file) => {
          const taskPath = join(sessionDir, file);
          try {
            const content = await fs.readFile(taskPath, "utf8");
            return JSON.parse(content.trim()) as Task;
          } catch (error) {
            logger.error(
              `Failed to read or parse task file ${taskPath}:`,
              error,
            );
            return null;
          }
        }),
      );

      return tasks.filter((t): t is Task => t !== null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async getNextTaskId(sessionId: string): Promise<string> {
    const tasks = await this.listTasks(sessionId);
    if (tasks.length === 0) {
      return "1";
    }
    const ids = tasks.map((t) => parseInt(t.id, 10)).filter((id) => !isNaN(id));

    if (ids.length === 0) {
      return (tasks.length + 1).toString();
    }

    return (Math.max(...ids) + 1).toString();
  }
}
