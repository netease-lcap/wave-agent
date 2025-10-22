import { spawn } from "child_process";
import type { BackgroundShell } from "../types.js";

export interface BackgroundBashManagerCallbacks {
  onShellsChange?: (shells: BackgroundShell[]) => void;
}

export interface BackgroundBashManagerOptions {
  callbacks?: BackgroundBashManagerCallbacks;
  workdir: string;
}

export class BackgroundBashManager {
  private shells = new Map<string, BackgroundShell>();
  private nextId = 1;
  private callbacks: BackgroundBashManagerCallbacks;
  private workdir: string;

  constructor(options: BackgroundBashManagerOptions) {
    this.callbacks = options.callbacks || {};
    this.workdir = options.workdir;
  }

  private notifyShellsChange(): void {
    this.callbacks.onShellsChange?.(Array.from(this.shells.values()));
  }

  public startShell(command: string, timeout?: number): string {
    const id = `bash_${this.nextId++}`;
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
      process: child,
      command,
      startTime,
      status: "running",
      stdout: "",
      stderr: "",
    };

    this.shells.set(id, shell);
    this.notifyShellsChange();

    // Set up timeout if specified
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (timeout && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        if (shell.status === "running") {
          this.killShell(id);
        }
      }, timeout);
    }

    child.stdout?.on("data", (data) => {
      shell.stdout += data.toString();
      this.notifyShellsChange();
    });

    child.stderr?.on("data", (data) => {
      shell.stderr += data.toString();
      this.notifyShellsChange();
    });

    child.on("exit", (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      shell.status = "completed";
      shell.exitCode = code ?? 0;
      shell.runtime = Date.now() - startTime;
      this.notifyShellsChange();
    });

    child.on("error", (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      shell.status = "completed";
      shell.stderr += `\nProcess error: ${error.message}`;
      shell.exitCode = 1;
      shell.runtime = Date.now() - startTime;
      this.notifyShellsChange();
    });

    return id;
  }

  public getShell(id: string): BackgroundShell | undefined {
    return this.shells.get(id);
  }

  public getAllShells(): BackgroundShell[] {
    return Array.from(this.shells.values());
  }

  public getOutput(
    id: string,
    filter?: string,
  ): { stdout: string; stderr: string; status: string } | null {
    const shell = this.shells.get(id);
    if (!shell) {
      return null;
    }

    let stdout = shell.stdout;
    let stderr = shell.stderr;

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
      } catch {
        // logger.warn(`Invalid filter regex: ${filter}`, error);
      }
    }

    return {
      stdout,
      stderr,
      status: shell.status,
    };
  }

  public killShell(id: string): boolean {
    const shell = this.shells.get(id);
    if (!shell || shell.status !== "running") {
      return false;
    }

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
            } catch {
              // logger.error("Failed to force kill process:", error);
            }
          }
        }, 1000);
      }

      shell.status = "killed";
      shell.runtime = Date.now() - shell.startTime;
      this.notifyShellsChange();
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
        shell.runtime = Date.now() - shell.startTime;
        this.notifyShellsChange();
        return true;
      } catch {
        // logger.error("Failed to kill child process:", directKillError);
        return false;
      }
    }
  }

  public cleanup(): void {
    // Kill all running shells
    for (const [id, shell] of this.shells) {
      if (shell.status === "running") {
        this.killShell(id);
      }
    }
    this.shells.clear();
    this.notifyShellsChange();
  }
}
