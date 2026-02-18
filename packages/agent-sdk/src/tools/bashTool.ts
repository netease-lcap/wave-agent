import { spawn, ChildProcess } from "child_process";
import { logger } from "../utils/globalLogger.js";
import { stripAnsiColors } from "../utils/stringUtils.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import {
  BASH_TOOL_NAME,
  TASK_OUTPUT_TOOL_NAME,
  GLOB_TOOL_NAME,
  SEARCH_TOOL_NAME,
  READ_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "../constants/tools.js";

const MAX_OUTPUT_LENGTH = 30000;
const BASH_DEFAULT_TIMEOUT_MS = 120000;

/**
 * Bash command execution tool - supports both foreground and background execution
 */
export const bashTool: ToolPlugin = {
  name: BASH_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: BASH_TOOL_NAME,
      description: `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`ls\` to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use \`ls foo\` to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (up to ${BASH_DEFAULT_TIMEOUT_MS}ms / ${BASH_DEFAULT_TIMEOUT_MS / 60000} minutes). If not specified, commands will timeout after ${BASH_DEFAULT_TIMEOUT_MS}ms (${BASH_DEFAULT_TIMEOUT_MS / 60000} minutes).
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds ${MAX_OUTPUT_LENGTH} characters, output will be truncated before being returned to you.
  - You can use the \`run_in_background\` parameter to run the command in the background, which allows you to continue working while the command runs. You can monitor the output using the ${BASH_TOOL_NAME} tool as it becomes available. You do not need to use '&' at the end of the command when using this parameter.
  - Avoid using ${BASH_TOOL_NAME} with the \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:
    - File search: Use ${GLOB_TOOL_NAME} (NOT find or ls)
    - Content search: Use ${SEARCH_TOOL_NAME} (NOT grep or rg)
    - Read files: Use ${READ_TOOL_NAME} (NOT cat/head/tail)
    - Edit files: Use ${EDIT_TOOL_NAME} (NOT sed/awk)
    - Write files: Use ${WRITE_TOOL_NAME} (NOT echo >/cat <<EOF)
    - Communication: Output text directly (NOT echo/printf)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple ${BASH_TOOL_NAME} tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two ${BASH_TOOL_NAME} tool calls in parallel.
    - If the commands depend on each other and must run sequentially, use a single ${BASH_TOOL_NAME} call with '&&' to chain them together (e.g., \`git add . && git commit -m "message" && git push\`). For instance, if one operation must complete before another starts (like mkdir before cp, ${WRITE_TOOL_NAME} before ${BASH_TOOL_NAME} for git operations, or git add before git commit), run these operations sequentially instead.
    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it.
    <good-example>
    pytest /foo/bar/tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>
`,
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
            description: `Set to true to run this command in the background. Use ${TASK_OUTPUT_TOOL_NAME} to read the output later.`,
          },
        },
        required: ["command"],
      },
    },
  },
  prompt: () => `
- Reserve bash tools exclusively for actual system commands and terminal operations that require shell execution. NEVER use bash echo or other command-line tools to communicate thoughts, explanations, or instructions to the user. Output all communication directly in your response text instead.
- When making multiple bash tool calls, you MUST send a single message with multiple tools calls to run the calls in parallel. For example, if you need to run "git status" and "git diff", send a single message with two tool calls in parallel.`,
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const command = args.command as string;
    const runInBackground = args.run_in_background as boolean | undefined;
    const description = args.description as string | undefined;
    // Set default timeout: BASH_DEFAULT_TIMEOUT_MS for foreground, no timeout for background
    const timeout =
      (args.timeout as number | undefined) ??
      (runInBackground ? undefined : BASH_DEFAULT_TIMEOUT_MS);

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

    // Permission check after validation but before real operation
    if (context.permissionManager) {
      try {
        const permissionContext = context.permissionManager.createContext(
          BASH_TOOL_NAME,
          context.permissionMode || "default",
          context.canUseToolCallback,
          {
            command,
            description,
            run_in_background: runInBackground,
            timeout,
            workdir: context.workdir,
          },
        );
        const permissionResult =
          await context.permissionManager.checkPermission(permissionContext);

        if (permissionResult.behavior === "deny") {
          return {
            success: false,
            content: "",
            error: `${BASH_TOOL_NAME} operation denied, reason: ${permissionResult.message || "No reason provided"}`,
          };
        }
      } catch {
        return {
          success: false,
          content: "",
          error: "Permission check failed",
        };
      }
    }

    if (runInBackground) {
      // Background execution
      const backgroundTaskManager = context?.backgroundTaskManager;
      if (!backgroundTaskManager) {
        return {
          success: false,
          content: "",
          error: "Background task manager not available",
        };
      }

      const { id: taskId } = backgroundTaskManager.startShell(command, timeout);
      return {
        success: true,
        content: `Command started in background with ID: ${taskId}. Use TaskOutput tool with task_id="${taskId}" to monitor output.`,
        shortResult: `Background process ${taskId} started`,
      };
    }

    // Foreground execution (original behavior)
    return new Promise((resolve) => {
      const child: ChildProcess = spawn(command, {
        shell: true,
        stdio: "pipe",
        cwd: context.workdir,
        env: {
          ...process.env,
        },
      });

      let outputBuffer = "";
      let errorBuffer = "";
      let isAborted = false;
      let isBackgrounded = false;

      const foregroundTaskId = `bash_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Register as foreground task
      if (context.foregroundTaskManager && command) {
        context.foregroundTaskManager.registerForegroundTask({
          id: foregroundTaskId,
          backgroundHandler: async () => {
            isBackgrounded = true;
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }

            const backgroundTaskManager = context.backgroundTaskManager;
            if (backgroundTaskManager) {
              const taskId = backgroundTaskManager.adoptProcess(
                child,
                command,
                outputBuffer,
                errorBuffer,
              );
              resolve({
                success: true,
                content: `Command moved to background with ID: ${taskId}.`,
                shortResult: `Process ${taskId} backgrounded`,
                isManuallyBackgrounded: true,
              });
            } else {
              handleAbort(
                "Failed to background: Background task manager not available",
              );
            }
          },
        });
      }

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
                  } catch (killError) {
                    logger.error("Failed to force kill process:", killError);
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
              } catch (directKillError) {
                logger.error("Failed to kill child process:", directKillError);
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
        // Use { once: true } to prevent listener accumulation on signal reuse
        context.abortSignal.addEventListener("abort", () => handleAbort(), {
          once: true,
        });
      }

      child.stdout?.on("data", (data) => {
        if (!isAborted && !isBackgrounded) {
          outputBuffer += stripAnsiColors(data.toString());
        }
      });

      child.stderr?.on("data", (data) => {
        if (!isAborted && !isBackgrounded) {
          errorBuffer += stripAnsiColors(data.toString());
        }
      });

      child.on("exit", (code) => {
        if (context.foregroundTaskManager) {
          context.foregroundTaskManager.unregisterForegroundTask(
            foregroundTaskId,
          );
        }

        if (!isAborted && !isBackgrounded) {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          const exitCode = code ?? 0;
          const combinedOutput =
            outputBuffer + (errorBuffer ? "\n" + errorBuffer : "");

          // Handle large output by truncation if needed
          const finalOutput =
            combinedOutput || `Command executed with exit code: ${exitCode}`;
          const content =
            finalOutput.length > MAX_OUTPUT_LENGTH
              ? finalOutput.substring(0, MAX_OUTPUT_LENGTH) +
                "\n\n... (output truncated)"
              : finalOutput;

          resolve({
            success: exitCode === 0,
            content,
            error:
              exitCode !== 0
                ? `Command failed with exit code: ${exitCode}`
                : undefined,
          });
        }
      });

      child.on("error", (error) => {
        if (context.foregroundTaskManager) {
          context.foregroundTaskManager.unregisterForegroundTask(
            foregroundTaskId,
          );
        }

        if (!isAborted && !isBackgrounded) {
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
    const description = params.description as string;
    const command = params.command as string;
    const runInBackground = params.run_in_background as boolean;

    if (description) {
      return description;
    }

    return `${command}${runInBackground ? " (background)" : ""}`;
  },
};
