import { spawn, ChildProcess } from "child_process";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";

// Background bash shell management
interface BackgroundShell {
  id: string;
  process: ChildProcess;
  command: string;
  startTime: number;
  status: "running" | "completed" | "killed";
  stdout: string;
  stderr: string;
  exitCode?: number;
  runtime?: number;
}

class BackgroundBashManager {
  private shells = new Map<string, BackgroundShell>();
  private nextId = 1;

  public startShell(command: string, timeout?: number): string {
    const id = `bash_${this.nextId++}`;
    const startTime = Date.now();

    const child = spawn(command, {
      shell: true,
      stdio: "pipe",
      cwd: process.cwd(),
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
    });

    child.stderr?.on("data", (data) => {
      shell.stderr += data.toString();
    });

    child.on("exit", (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      shell.status = "completed";
      shell.exitCode = code ?? 0;
      shell.runtime = Date.now() - startTime;
    });

    child.on("error", (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      shell.status = "completed";
      shell.stderr += `\nProcess error: ${error.message}`;
      shell.exitCode = 1;
      shell.runtime = Date.now() - startTime;
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
  }
}

// Global background bash manager instance
const backgroundBashManager = new BackgroundBashManager();

// Cleanup on process exit
process.on("exit", () => {
  backgroundBashManager.cleanup();
});

process.on("SIGINT", () => {
  backgroundBashManager.cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  backgroundBashManager.cleanup();
  process.exit(0);
});

/**
 * Bash command execution tool - supports both foreground and background execution
 */
export const bashTool: ToolPlugin = {
  name: "Bash",
  description:
    "Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.",
  config: {
    type: "function",
    function: {
      name: "Bash",
      description:
        "Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to execute",
          },
          timeout: {
            type: "number",
            description: "Optional timeout in milliseconds (max 600000)",
          },
          description: {
            type: "string",
            description:
              "Clear, concise description of what this command does in 5-10 words.",
          },
          run_in_background: {
            type: "boolean",
            description:
              "Set to true to run this command in the background. Use BashOutput to read the output later.",
          },
        },
        required: ["command"],
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> => {
    const command = args.command as string;
    const timeout = args.timeout as number | undefined;
    const runInBackground = args.run_in_background as boolean | undefined;

    if (!command || typeof command !== "string") {
      return {
        success: false,
        content: "",
        error: "Command parameter is required and must be a string",
      };
    }

    // Validate timeout
    if (
      timeout !== undefined &&
      (typeof timeout !== "number" || timeout < 0 || timeout > 600000)
    ) {
      return {
        success: false,
        content: "",
        error: "Timeout must be a number between 0 and 600000 milliseconds",
      };
    }

    if (runInBackground) {
      // Background execution
      const shellId = backgroundBashManager.startShell(command, timeout);
      return {
        success: true,
        content: `Command started in background with ID: ${shellId}. Use BashOutput tool with bash_id="${shellId}" to monitor output.`,
        shortResult: `Background process ${shellId} started`,
      };
    }

    // Foreground execution (original behavior)
    return new Promise((resolve) => {
      const child: ChildProcess = spawn(command, {
        shell: true,
        stdio: "pipe",
        cwd: process.cwd(),
        env: {
          ...process.env,
        },
      });

      let outputBuffer = "";
      let errorBuffer = "";
      let isAborted = false;

      // Set up timeout
      let timeoutHandle: NodeJS.Timeout | undefined;
      if (timeout && timeout > 0) {
        timeoutHandle = setTimeout(() => {
          if (!isAborted) {
            handleAbort("Command timed out");
          }
        }, timeout);
      }

      // Handle abort signal
      const handleAbort = (reason = "Command execution was aborted") => {
        if (!isAborted) {
          isAborted = true;

          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          // Force terminate child process and its children
          if (child.pid) {
            try {
              // Try graceful termination of process group
              process.kill(-child.pid, "SIGTERM");

              // Set timeout for force kill
              setTimeout(() => {
                if (child.pid && !child.killed) {
                  try {
                    process.kill(-child.pid, "SIGKILL");
                  } catch {
                    // logger.error("Failed to force kill process:", killError);
                  }
                }
              }, 1000);
            } catch {
              // If process group termination fails, try direct child process termination
              try {
                child.kill("SIGTERM");
                setTimeout(() => {
                  if (!child.killed) {
                    child.kill("SIGKILL");
                  }
                }, 1000);
              } catch {
                // logger.error("Failed to kill child process:", directKillError);
              }
            }
          }

          resolve({
            success: false,
            content: outputBuffer + (errorBuffer ? "\n" + errorBuffer : ""),
            error: reason,
          });
        }
      };

      // Handle abort signal from context
      if (context?.abortSignal) {
        if (context.abortSignal.aborted) {
          handleAbort();
          return;
        }
        context.abortSignal.addEventListener("abort", () => handleAbort());
      }

      child.stdout?.on("data", (data) => {
        if (!isAborted) {
          outputBuffer += data.toString();
        }
      });

      child.stderr?.on("data", (data) => {
        if (!isAborted) {
          errorBuffer += data.toString();
        }
      });

      child.on("exit", (code) => {
        if (!isAborted) {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          const exitCode = code ?? 0;
          const combinedOutput =
            outputBuffer + (errorBuffer ? "\n" + errorBuffer : "");

          resolve({
            success: exitCode === 0,
            content:
              combinedOutput || `Command executed with exit code: ${exitCode}`,
            error:
              exitCode !== 0
                ? `Command failed with exit code: ${exitCode}`
                : undefined,
          });
        }
      });

      child.on("error", (error) => {
        if (!isAborted) {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          resolve({
            success: false,
            content: "",
            error: `Failed to execute command: ${error.message}`,
          });
        }
      });
    });
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const command = params.command as string;
    const runInBackground = params.run_in_background as boolean;
    return `${command}${runInBackground ? " background" : ""}`;
  },
};

/**
 * BashOutput tool - retrieves output from background bash shells
 */
export const bashOutputTool: ToolPlugin = {
  name: "BashOutput",
  description:
    "Retrieves output from a running or completed background bash shell",
  config: {
    type: "function",
    function: {
      name: "BashOutput",
      description:
        "Retrieves output from a running or completed background bash shell",
      parameters: {
        type: "object",
        properties: {
          bash_id: {
            type: "string",
            description:
              "The ID of the background shell to retrieve output from",
          },
          filter: {
            type: "string",
            description:
              "Optional regular expression to filter the output lines. Only lines matching this regex will be included in the result. Any lines that do not match will no longer be available to read.",
          },
        },
        required: ["bash_id"],
      },
    },
  },
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const bashId = args.bash_id as string;
    const filter = args.filter as string | undefined;

    if (!bashId || typeof bashId !== "string") {
      return {
        success: false,
        content: "",
        error: "bash_id parameter is required and must be a string",
      };
    }

    const output = backgroundBashManager.getOutput(bashId, filter);
    if (!output) {
      return {
        success: false,
        content: "",
        error: `Background shell with ID ${bashId} not found`,
      };
    }

    const shell = backgroundBashManager.getShell(bashId);
    if (!shell) {
      return {
        success: false,
        content: "",
        error: `Background shell with ID ${bashId} not found`,
      };
    }

    let content = "";
    if (output.stdout) {
      content += output.stdout;
    }
    if (output.stderr) {
      content += (content ? "\n" : "") + output.stderr;
    }

    return {
      success: true,
      content: content || "No output available",
      shortResult: `${bashId}: ${output.status}${shell.exitCode !== undefined ? ` (${shell.exitCode})` : ""}`,
      error: undefined,
    };
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const bashId = params.bash_id as string;
    const filter = params.filter as string | undefined;
    return filter ? `${bashId} filtered: ${filter}` : bashId;
  },
};

/**
 * KillBash tool - kills a running background bash shell
 */
export const killBashTool: ToolPlugin = {
  name: "KillBash",
  description: "Kills a running background bash shell by its ID",
  config: {
    type: "function",
    function: {
      name: "KillBash",
      description: "Kills a running background bash shell by its ID",
      parameters: {
        type: "object",
        properties: {
          shell_id: {
            type: "string",
            description: "The ID of the background shell to kill",
          },
        },
        required: ["shell_id"],
      },
    },
  },
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const shellId = args.shell_id as string;

    if (!shellId || typeof shellId !== "string") {
      return {
        success: false,
        content: "",
        error: "shell_id parameter is required and must be a string",
      };
    }

    const shell = backgroundBashManager.getShell(shellId);
    if (!shell) {
      return {
        success: false,
        content: "",
        error: `Background shell with ID ${shellId} not found`,
      };
    }

    if (shell.status !== "running") {
      return {
        success: false,
        content: "",
        error: `Background shell ${shellId} is not running (status: ${shell.status})`,
      };
    }

    const killed = backgroundBashManager.killShell(shellId);
    if (killed) {
      return {
        success: true,
        content: `Background shell ${shellId} has been killed`,
        shortResult: `Killed ${shellId}`,
      };
    } else {
      return {
        success: false,
        content: "",
        error: `Failed to kill background shell ${shellId}`,
      };
    }
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const shellId = params.shell_id as string;
    return shellId;
  },
};

// Export the background bash manager for use in other parts of the application
export { backgroundBashManager };
