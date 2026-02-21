import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import { Task } from "../types/tasks.js";
import { logger } from "../utils/globalLogger.js";

export class TaskManager extends EventEmitter {
  private readonly baseDir: string;
  private taskListId: string;

  constructor(taskListId: string) {
    super();
    this.taskListId = taskListId;
    this.baseDir = join(homedir(), ".wave", "tasks");
  }

  public getTaskListId(): string {
    return this.taskListId;
  }

  public setTaskListId(taskListId: string): void {
    this.taskListId = taskListId;
  }

  private getSessionDir(): string {
    return join(this.baseDir, this.taskListId);
  }

  public getTaskPath(taskId: string): string {
    return join(this.getSessionDir(), `${taskId}.json`);
  }

  private getLockPath(): string {
    return join(this.getSessionDir(), `.lock`);
  }

  async ensureSessionDir(): Promise<void> {
    await fs.mkdir(this.getSessionDir(), { recursive: true });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = this.getLockPath();
    let lockHandle;
    const maxRetries = 100;
    const retryDelay = process.env.NODE_ENV === "test" ? 10 : 100;

    await this.ensureSessionDir();

    for (let i = 0; i < maxRetries; i++) {
      try {
        lockHandle = await fs.open(lockPath, "wx");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          if (i === maxRetries - 1) {
            throw new Error(
              `Could not acquire lock for task list ${this.taskListId} after ${maxRetries} retries`,
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
        logger.error(
          `Failed to release lock for task list ${this.taskListId}:`,
          error,
        );
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

  async createTask(task: Omit<Task, "id">): Promise<string> {
    return await this.withLock(async () => {
      const taskId = await this.getNextTaskId();
      const fullTask: Task = { ...task, id: taskId };
      this.validateTask(fullTask);
      const taskPath = this.getTaskPath(taskId);
      const content = JSON.stringify(fullTask, null, 2);
      await fs.writeFile(taskPath, content, "utf8");
      this.emit("tasksChange", this.taskListId);
      logger.info(`Task ${taskId} created in task list ${this.taskListId}`);
      return taskId;
    });
  }

  async getTask(taskId: string): Promise<Task | null> {
    const taskPath = this.getTaskPath(taskId);
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

  async updateTask(task: Task): Promise<void> {
    this.validateTask(task);
    await this.withLock(async () => {
      const taskPath = this.getTaskPath(task.id);
      const content = JSON.stringify(task, null, 2);
      await fs.writeFile(taskPath, content, "utf8");
      this.emit("tasksChange", this.taskListId);
      logger.info(`Task ${task.id} updated in task list ${this.taskListId}`);
    });
  }

  async listTasks(): Promise<Task[]> {
    const sessionDir = this.getSessionDir();
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

  async getNextTaskId(): Promise<string> {
    const tasks = await this.listTasks();
    if (tasks.length === 0) {
      return "1";
    }
    const ids = tasks.map((t) => parseInt(t.id, 10)).filter((id) => !isNaN(id));

    if (ids.length === 0) {
      return (tasks.length + 1).toString();
    }

    return (Math.max(...ids) + 1).toString();
  }

  /**
   * Refreshes the task list by re-reading tasks from disk and emitting a change event.
   */
  public async refreshTasks(): Promise<void> {
    this.emit("tasksChange", this.taskListId);
  }
}
