import { spawn } from "child_process";
import { BackgroundTask, BackgroundShell } from "../types/processes.js";
import { stripAnsiColors } from "../utils/stringUtils.js";
import { logger } from "../utils/globalLogger.js";

export interface BackgroundTaskManagerCallbacks {
  onTasksChange?: (tasks: BackgroundTask[]) => void;
}

export interface BackgroundTaskManagerOptions {
  callbacks?: BackgroundTaskManagerCallbacks;
  workdir: string;
}

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private nextId = 1;
  private callbacks: BackgroundTaskManagerCallbacks;
  private workdir: string;

  constructor(options: BackgroundTaskManagerOptions) {
    this.callbacks = options.callbacks || {};
    this.workdir = options.workdir;
  }

  private notifyTasksChange(): void {
    this.callbacks.onTasksChange?.(Array.from(this.tasks.values()));
  }

  public generateId(): string {
    return `task_${this.nextId++}`;
  }

  public addTask(task: BackgroundTask): void {
    this.tasks.set(task.id, task);
    this.notifyTasksChange();
  }

  public getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  public getAllTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }

  public startShell(command: string, timeout?: number): string {
    const id = this.generateId();
    const startTime = Date.now();

    const child = spawn(command, {
      shell: true,
      stdio: "pipe",
      cwd: this.workdir,
      env: {
        ...process.env,
      },
    });

    const shell: BackgroundShell = {
      id,
      type: "shell",
      process: child,
      command,
      startTime,
      status: "running",
      stdout: "",
      stderr: "",
    };

    this.tasks.set(id, shell);
    this.notifyTasksChange();

    // Set up timeout if specified
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (timeout && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        if (shell.status === "running") {
          this.stopTask(id);
        }
      }, timeout);
    }

    child.stdout?.on("data", (data) => {
      shell.stdout += stripAnsiColors(data.toString());
      this.notifyTasksChange();
    });

    child.stderr?.on("data", (data) => {
      shell.stderr += stripAnsiColors(data.toString());
      this.notifyTasksChange();
    });

    child.on("exit", (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      shell.status = code === 0 ? "completed" : "failed";
      shell.exitCode = code ?? 0;
      shell.endTime = Date.now();
      shell.runtime = shell.endTime - startTime;
      this.notifyTasksChange();
    });

    child.on("error", (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      shell.status = "failed";
      shell.stderr += `\nProcess error: ${stripAnsiColors(error.message)}`;
      shell.exitCode = 1;
      shell.endTime = Date.now();
      shell.runtime = shell.endTime - startTime;
      this.notifyTasksChange();
    });

    return id;
  }

  public getOutput(
    id: string,
    filter?: string,
  ): { stdout: string; stderr: string; status: string } | null {
    const task = this.tasks.get(id);
    if (!task) {
      return null;
    }

    let stdout = task.stdout;
    let stderr = task.stderr;

    // Apply regex filter if provided
    if (filter) {
      try {
        const regex = new RegExp(filter);
        stdout = stdout
          .split("\n")
          .filter((line) => regex.test(line))
          .join("\n");
        stderr = stderr
          .split("\n")
          .filter((line) => regex.test(line))
          .join("\n");
      } catch (error) {
        logger.warn(`Invalid filter regex: ${filter}`, error);
      }
    }

    return {
      stdout,
      stderr,
      status: task.status,
    };
  }

  public stopTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "running") {
      return false;
    }

    if (task.type === "shell") {
      const shell = task as BackgroundShell;
      try {
        // Try to kill process group first
        if (shell.process.pid) {
          process.kill(-shell.process.pid, "SIGTERM");

          // Force kill after timeout
          setTimeout(() => {
            if (
              shell.status === "running" &&
              shell.process.pid &&
              !shell.process.killed
            ) {
              try {
                process.kill(-shell.process.pid, "SIGKILL");
              } catch (error) {
                logger.error("Failed to force kill process:", error);
              }
            }
          }, 1000);
        }

        shell.status = "killed";
        shell.endTime = Date.now();
        shell.runtime = shell.endTime - shell.startTime;
        this.notifyTasksChange();
        return true;
      } catch {
        // Fallback to direct process kill
        try {
          shell.process.kill("SIGTERM");
          setTimeout(() => {
            if (!shell.process.killed) {
              shell.process.kill("SIGKILL");
            }
          }, 1000);
          shell.status = "killed";
          shell.endTime = Date.now();
          shell.runtime = shell.endTime - shell.startTime;
          this.notifyTasksChange();
          return true;
        } catch (directKillError) {
          logger.error("Failed to kill child process:", directKillError);
          return false;
        }
      }
    } else if (task.type === "subagent") {
      // Subagent termination logic will be handled by aborting the AI loop
      // which is already managed by the SubagentManager and AIManager.
      // Here we just update the status.
      task.status = "killed";
      task.endTime = Date.now();
      task.runtime = task.endTime - task.startTime;
      this.notifyTasksChange();
      return true;
    }

    return false;
  }

  public cleanup(): void {
    // Kill all running tasks
    for (const [id, task] of this.tasks) {
      if (task.status === "running") {
        this.stopTask(id);
      }
    }
    this.tasks.clear();
    this.notifyTasksChange();
  }
}
