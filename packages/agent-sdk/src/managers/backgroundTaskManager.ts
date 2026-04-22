import { spawn, type ChildProcess } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { BackgroundTask, BackgroundShell } from "../types/processes.js";
import { stripAnsiColors } from "../utils/stringUtils.js";
import { logger } from "../utils/globalLogger.js";
import { Container } from "../utils/container.js";
import { NotificationQueue } from "./notificationQueue.js";

export interface BackgroundTaskManagerCallbacks {
  onBackgroundTasksChange?: (tasks: BackgroundTask[]) => void;
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

  constructor(
    private container: Container,
    options: BackgroundTaskManagerOptions,
  ) {
    this.callbacks = options.callbacks || {};
    this.workdir = options.workdir;
  }

  private get notificationQueue(): NotificationQueue {
    return this.container.get<NotificationQueue>("NotificationQueue")!;
  }

  private notifyTasksChange(): void {
    this.callbacks.onBackgroundTasksChange?.(Array.from(this.tasks.values()));
  }

  public generateId(): string {
    return `task_${process.pid}_${this.nextId++}`;
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

  public startShell(
    command: string,
    timeout?: number,
  ): { id: string; child: ChildProcess; detach: () => void } {
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

    // Create log file
    const logPath = path.join(os.tmpdir(), `wave-task-${id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: "w" });

    const shell: BackgroundShell = {
      id,
      type: "shell",
      process: child,
      command,
      startTime,
      status: "running",
      stdout: "",
      stderr: "",
      outputPath: logPath,
      onStop: () => {
        try {
          logStream.end();
          if (child.pid) {
            process.kill(-child.pid, "SIGTERM");
            const forceKillTimer = setTimeout(() => {
              if (child.pid && !child.killed) {
                try {
                  process.kill(-child.pid, "SIGKILL");
                } catch (error) {
                  logger.error("Failed to force kill process:", error);
                }
              }
            }, 1000);
            forceKillTimer.unref();
          } else {
            child.kill("SIGTERM");
          }
        } catch {
          child.kill("SIGTERM");
        }
      },
    };

    this.tasks.set(id, shell);
    this.notifyTasksChange();

    // Set up timeout if specified
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (timeout && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        if (shell.status === "running") {
          const timeoutMsg = "\n\nCommand timed out";
          shell.stderr += timeoutMsg;
          if (logStream.writable) {
            logStream.write(timeoutMsg);
          }
          this.stopTask(id);
        }
      }, timeout);
    }

    const onStdout = (data: Buffer | string) => {
      const stripped = stripAnsiColors(data.toString());
      shell.stdout += stripped;
      if (logStream.writable) {
        logStream.write(stripped);
      }
      this.notifyTasksChange();
    };

    const onStderr = (data: Buffer | string) => {
      const stripped = stripAnsiColors(data.toString());
      shell.stderr += stripped;
      if (logStream.writable) {
        logStream.write(stripped);
      }
      this.notifyTasksChange();
    };

    const onExit = (code: number | null) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (logStream.writable) {
        logStream.end();
      }
      const wasKilled = shell.status === "killed";
      if (!wasKilled) {
        shell.status = code === 0 ? "completed" : "failed";
      }
      shell.exitCode = code ?? 0;
      shell.endTime = Date.now();
      shell.runtime = shell.endTime - startTime;
      this.notifyTasksChange();

      // Skip notification if task was manually killed (user/agent-initiated stop)
      if (!wasKilled) {
        const notificationQueue = this.container.has("NotificationQueue")
          ? this.container.get<NotificationQueue>("NotificationQueue")
          : undefined;
        if (notificationQueue) {
          const statusStr = shell.status;
          const summary = `Command "${command}" ${statusStr} with exit code ${code ?? 0}`;
          notificationQueue.enqueue(
            `<task-notification>\n<task-id>${id}</task-id>\n<task-type>shell</task-type>\n<output-file>${logPath}</output-file>\n<status>${statusStr}</status>\n<summary>${summary}</summary>\n</task-notification>`,
          );
        }
      }
    };

    const onError = (error: Error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      const stripped = `\nProcess error: ${stripAnsiColors(error.message)}`;
      shell.status = "failed";
      shell.stderr += stripped;
      if (logStream.writable) {
        logStream.write(stripped);
        logStream.end();
      }
      shell.exitCode = 1;
      shell.endTime = Date.now();
      shell.runtime = shell.endTime - startTime;
      this.notifyTasksChange();

      // Enqueue error notification
      const notificationQueue = this.container.has("NotificationQueue")
        ? this.container.get<NotificationQueue>("NotificationQueue")
        : undefined;
      if (notificationQueue) {
        const summary = `Command "${command}" failed with error: ${stripAnsiColors(error.message)}`;
        notificationQueue.enqueue(
          `<task-notification>\n<task-id>${id}</task-id>\n<task-type>shell</task-type>\n<output-file>${logPath}</output-file>\n<status>failed</status>\n<summary>${summary}</summary>\n</task-notification>`,
        );
      }
    };

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("exit", onExit);
    child.on("error", onError);

    const detach = () => {
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      logStream.end();
      this.tasks.delete(id);
      this.notifyTasksChange();
    };

    return { id, child, detach };
  }

  public adoptProcess(
    child: ChildProcess,
    command: string,
    initialStdout: string = "",
    initialStderr: string = "",
  ): string {
    const id = this.generateId();
    const startTime = Date.now();

    // Create log file
    const logPath = path.join(os.tmpdir(), `wave-task-${id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: "w" });

    // Write initial output to log file
    if (initialStdout) {
      logStream.write(stripAnsiColors(initialStdout));
    }
    if (initialStderr) {
      logStream.write(stripAnsiColors(initialStderr));
    }

    const shell: BackgroundShell = {
      id,
      type: "shell",
      process: child,
      command,
      startTime,
      status: "running",
      stdout: initialStdout,
      stderr: initialStderr,
      outputPath: logPath,
      onStop: () => {
        try {
          logStream.end();
          if (child.pid) {
            process.kill(-child.pid, "SIGTERM");
            const forceKillTimer = setTimeout(() => {
              if (child.pid && !child.killed) {
                try {
                  process.kill(-child.pid, "SIGKILL");
                } catch (error) {
                  logger.error("Failed to force kill process:", error);
                }
              }
            }, 1000);
            forceKillTimer.unref();
          } else {
            child.kill("SIGTERM");
          }
        } catch {
          child.kill("SIGTERM");
        }
      },
    };

    this.tasks.set(id, shell);
    this.notifyTasksChange();

    child.stdout?.on("data", (data) => {
      const stripped = stripAnsiColors(data.toString());
      shell.stdout += stripped;
      if (logStream.writable) {
        logStream.write(stripped);
      }
      this.notifyTasksChange();
    });

    child.stderr?.on("data", (data) => {
      const stripped = stripAnsiColors(data.toString());
      shell.stderr += stripped;
      if (logStream.writable) {
        logStream.write(stripped);
      }
      this.notifyTasksChange();
    });

    child.on("exit", (code) => {
      if (logStream.writable) {
        logStream.end();
      }
      const wasKilled = shell.status === "killed";
      if (!wasKilled) {
        shell.status = code === 0 ? "completed" : "failed";
      }
      shell.exitCode = code ?? 0;
      shell.endTime = Date.now();
      shell.runtime = shell.endTime - startTime;
      this.notifyTasksChange();

      // Skip notification if task was manually killed (user/agent-initiated stop)
      if (!wasKilled) {
        const notificationQueue = this.container.has("NotificationQueue")
          ? this.container.get<NotificationQueue>("NotificationQueue")
          : undefined;
        if (notificationQueue) {
          const statusStr = shell.status;
          const summary = `Command "${command}" ${statusStr} with exit code ${code ?? 0}`;
          notificationQueue.enqueue(
            `<task-notification>\n<task-id>${id}</task-id>\n<task-type>shell</task-type>\n<output-file>${logPath}</output-file>\n<status>${statusStr}</status>\n<summary>${summary}</summary>\n</task-notification>`,
          );
        }
      }
    });

    child.on("error", (error) => {
      const stripped = `\nProcess error: ${stripAnsiColors(error.message)}`;
      shell.status = "failed";
      shell.stderr += stripped;
      if (logStream.writable) {
        logStream.write(stripped);
        logStream.end();
      }
      shell.exitCode = 1;
      shell.endTime = Date.now();
      shell.runtime = shell.endTime - startTime;
      this.notifyTasksChange();

      // Enqueue error notification
      const notificationQueue = this.container.has("NotificationQueue")
        ? this.container.get<NotificationQueue>("NotificationQueue")
        : undefined;
      if (notificationQueue) {
        const summary = `Command "${command}" failed with error: ${stripAnsiColors(error.message)}`;
        notificationQueue.enqueue(
          `<task-notification>\n<task-id>${id}</task-id>\n<task-type>shell</task-type>\n<output-file>${logPath}</output-file>\n<status>failed</status>\n<summary>${summary}</summary>\n</task-notification>`,
        );
      }
    });

    return id;
  }

  public getOutput(
    id: string,
    filter?: string,
  ): {
    stdout: string;
    stderr: string;
    status: string;
    outputPath?: string;
    type: string;
    exitCode?: number;
  } | null {
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
      outputPath: task.outputPath,
      type: task.type,
      exitCode: task.exitCode,
    };
  }

  public stopTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "running") {
      return false;
    }

    if (task.onStop) {
      try {
        const result = task.onStop();
        if (result instanceof Promise) {
          result.catch((error) => {
            logger.error("Error in background task onStop callback:", error);
          });
        }
      } catch (error) {
        logger.error("Error in background task onStop callback:", error);
      }
    }

    // If it's a subagent task, we should also notify the subagent manager to cleanup
    // However, to avoid circular dependency, we rely on the onStop callback
    // which is already set to instance.aiManager.abortAIMessage()
    // The subagentManager.cleanupInstance will be called by the tool or by status change.

    task.status = "killed";
    task.endTime = Date.now();
    task.runtime = task.endTime - task.startTime;
    this.notifyTasksChange();

    return true;
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
