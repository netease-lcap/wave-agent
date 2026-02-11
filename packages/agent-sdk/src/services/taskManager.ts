import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Task } from "../types/tasks.js";

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

  async ensureSessionDir(sessionId: string): Promise<void> {
    await fs.mkdir(this.getSessionDir(sessionId), { recursive: true });
  }

  async createTask(sessionId: string, task: Task): Promise<void> {
    await this.ensureSessionDir(sessionId);
    const taskPath = this.getTaskPath(sessionId, task.id);
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
  }

  async getTask(sessionId: string, taskId: string): Promise<Task | null> {
    const taskPath = this.getTaskPath(sessionId, taskId);
    try {
      const content = await fs.readFile(taskPath, "utf8");
      return JSON.parse(content) as Task;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async updateTask(sessionId: string, task: Task): Promise<void> {
    const taskPath = this.getTaskPath(sessionId, task.id);
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
  }

  async listTasks(sessionId: string): Promise<Task[]> {
    const sessionDir = this.getSessionDir(sessionId);
    try {
      const files = await fs.readdir(sessionDir);
      const taskFiles = files.filter((f) => f.endsWith(".json"));

      const tasks: Task[] = [];
      for (const file of taskFiles) {
        const content = await fs.readFile(join(sessionDir, file), "utf8");
        tasks.push(JSON.parse(content) as Task);
      }
      return tasks;
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
