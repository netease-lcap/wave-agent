import { spawn, ChildProcess } from "child_process";
import type { ToolPlugin, ToolResult, ToolContext } from "./types";
import { logger } from "../../utils/logger";

/**
 * Terminal command execution tool plugin
 */
export const terminalTool: ToolPlugin = {
  name: "run_terminal_cmd",
  description: "Execute terminal commands",
  config: {
    type: "function",
    function: {
      name: "run_terminal_cmd",
      description: "Execute terminal commands",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The terminal command to execute",
          },
          explanation: {
            type: "string",
            description:
              "One sentence explanation as to why this tool is being used, and how it contributes to the goal.",
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

    if (!command || typeof command !== "string") {
      return {
        success: false,
        content: "",
        error: "Command parameter is required and must be a string",
      };
    }

    return new Promise((resolve) => {
      const child: ChildProcess = spawn(command, {
        shell: true,
        stdio: "pipe",
        env: {
          ...process.env,
        },
      });

      let outputBuffer = "";
      let errorBuffer = "";
      let isAborted = false;

      // 处理中断信号
      const handleAbort = () => {
        if (!isAborted) {
          isAborted = true;

          // 强制终止子进程及其子进程
          if (child.pid) {
            try {
              // 尝试优雅终止进程组
              process.kill(-child.pid, "SIGTERM");

              // 设置超时后强制杀死
              setTimeout(() => {
                if (child.pid && !child.killed) {
                  try {
                    process.kill(-child.pid, "SIGKILL");
                  } catch (killError) {
                    logger.error("Failed to force kill process:", killError);
                  }
                }
              }, 1000);
            } catch {
              // 如果进程组终止失败，尝试直接终止子进程
              try {
                child.kill("SIGTERM");
                setTimeout(() => {
                  if (!child.killed) {
                    child.kill("SIGKILL");
                  }
                }, 1000);
              } catch (directKillError) {
                logger.error("Failed to kill child process:", directKillError);
              }
            }
          }

          resolve({
            success: false,
            content: outputBuffer + (errorBuffer ? "\n" + errorBuffer : ""),
            error: "Command execution was aborted",
          });
        }
      };

      // 如果有中断信号，监听中断事件
      if (context?.abortSignal) {
        if (context.abortSignal.aborted) {
          // 如果信号已经被中断，直接返回
          handleAbort();
          return;
        }
        context.abortSignal.addEventListener("abort", handleAbort);
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
    return command || "";
  },
};
