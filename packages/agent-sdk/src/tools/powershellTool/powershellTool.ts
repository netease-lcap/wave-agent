import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { Readable } from "stream";
import { logger } from "../../utils/globalLogger.js";
import { getShellProvider } from "../../utils/shell/resolveProvider.js";
import { WindowsStreamDecoder } from "../../utils/encoding.js";
import { terminateChildProcessTree } from "../../utils/terminateProcessTree.js";
import { processToolResult } from "../../utils/toolResultStorage.js";
import { BASH_MAX_OUTPUT_CHARS } from "../../constants/toolLimits.js";
import { POWERSHELL_TOOL_NAME, READ_TOOL_NAME } from "../../constants/tools.js";
import type { ToolPlugin, ToolResult, ToolContext } from "../types.js";

const POWERSHELL_DEFAULT_TIMEOUT_MS = 120000;
const POWERSHELL_MAX_TIMEOUT_MS = 600000;

// Same valve as the Bash tool: the child's 'exit' event fires before its stdio
// pipes have drained, so the buffers are read only after the streams emit
// 'end' — with a bound, because a grandchild that inherited the pipe write ends
// (`Start-Process` with a redirected stream, a detached `cmd /c`) would delay
// 'end' indefinitely.
const STREAM_FLUSH_TIMEOUT_MS = 100;

/**
 * The PowerShell tool: one command, one `powershell.exe -Command`, one result.
 *
 * Registration is gated (`utils/shell/shellToolGate.ts`): the tool only exists
 * in a session whose shell is PowerShell, so its absence and the shell choice
 * can never disagree. What it does *not* do yet — and what P5 adds — is remember
 * the working directory between calls (`Set-Location` dies with the process) or
 * run in the background.
 *
 * Permission goes through `PermissionManager`, whose PowerShell branch
 * (`tools/powershellTool/permissions.ts`) does the real work: this file hands it
 * the command and spawns what survives.
 */
export const powershellTool: ToolPlugin = {
  name: POWERSHELL_TOOL_NAME,
  searchHint: "run a PowerShell command",
  isConcurrencySafe: false,
  config: {
    type: "function",
    function: {
      name: POWERSHELL_TOOL_NAME,
      description: "Run PowerShell command",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The PowerShell command to execute",
          },
          timeout: {
            type: "number",
            description: `Optional timeout in milliseconds (max ${POWERSHELL_MAX_TIMEOUT_MS})`,
          },
          description: {
            type: "string",
            description:
              "Clear, concise description of what this command does in 5-10 words.",
          },
        },
        required: ["command"],
      },
    },
  },
  leanPrompt: `Executes a PowerShell command and returns its output. Each call is a fresh, non-interactive PowerShell process started with \`-NoProfile\`: the working directory is the session's, but shell state (variables, functions, aliases, \`Set-Location\`) does not persist between calls. Prefer absolute paths over \`Set-Location\`.

- File search: use \`Get-ChildItem\` / \`Select-String\` here — this session has no \`grep\` / \`find\` shadows and no dedicated search tools.
- Read files: use ${READ_TOOL_NAME} (NOT \`Get-Content\`) unless you need it for a pipeline.
- \`timeout\` is in milliseconds: default ${POWERSHELL_DEFAULT_TIMEOUT_MS} (${POWERSHELL_DEFAULT_TIMEOUT_MS / 60000} minutes), max ${POWERSHELL_MAX_TIMEOUT_MS} (${POWERSHELL_MAX_TIMEOUT_MS / 60000} minutes).
- Output over ${BASH_MAX_OUTPUT_CHARS.toLocaleString()} characters is truncated and persisted to a file you can read with the ${READ_TOOL_NAME} tool.
- Use PowerShell syntax, not cmd.exe or bash: \`Get-ChildItem\` not \`dir\`, \`Remove-Item\` not \`rm\`, \`$env:PATH\` not \`$PATH\`.`,
  prompt:
    () => `Executes a given PowerShell command with optional timeout, ensuring proper handling and security measures. Each invocation runs in a fresh, non-interactive PowerShell process (\`-NoProfile -NonInteractive -NoLogo -Command\`): the working directory is the session's, but shell state — variables, functions, aliases, \`Set-Location\` — does not persist between calls.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`Get-ChildItem\` to verify the parent directory exists and is the correct location

2. Command Execution:
   - Always quote paths that contain spaces (e.g., \`Get-Content "C:\\path with spaces\\file.txt"\`)
   - Capture the output of the command.

Usage notes:
  - The command argument is required and is PowerShell syntax, not cmd.exe or bash: \`Get-ChildItem\` not \`dir\`, \`Remove-Item\` not \`rm\`, \`$env:PATH\` not \`$PATH\`.
  - You may specify an optional timeout in milliseconds (up to ${POWERSHELL_MAX_TIMEOUT_MS}ms / ${POWERSHELL_MAX_TIMEOUT_MS / 60000} minutes). By default, your command will timeout after ${POWERSHELL_DEFAULT_TIMEOUT_MS}ms (${POWERSHELL_DEFAULT_TIMEOUT_MS / 60000} minutes).
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds ${BASH_MAX_OUTPUT_CHARS.toLocaleString()} characters, output will be truncated and the full output will be persisted to a file you can read with the ${READ_TOOL_NAME} tool.
  - The exit code is reported as-is. PowerShell does not propagate a native program's exit code by itself — check the output, or end the command with \`exit $LASTEXITCODE\` when you need the child process's code.
  - Reserve this tool for actual system commands and terminal operations that require shell execution. NEVER use it to communicate thoughts, explanations, or instructions to the user — output all communication directly in your response text instead.`,
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const command = args.command;
    const description = args.description as string | undefined;
    const timeout =
      (args.timeout as number | undefined) ?? POWERSHELL_DEFAULT_TIMEOUT_MS;

    if (!command || typeof command !== "string") {
      return {
        success: false,
        content: "",
        error: "Command parameter is required and must be a string",
      };
    }

    // The binary behind this provider is resolved by the same module the
    // parser uses (`getPowerShellPath`), so "the shell that judges" and "the
    // shell that runs" cannot end up being different PowerShell versions.
    const provider = getShellProvider("powershell");
    if (!provider) {
      return {
        success: false,
        content: "",
        error:
          "PowerShell not found. Install PowerShell 7 (pwsh) or enable Windows PowerShell, then retry.",
      };
    }

    // Type only, like Bash: no upper bound is enforced (the tool description
    // states one, the schema is the model's job to respect).
    if (timeout !== undefined && (typeof timeout !== "number" || timeout < 0)) {
      return {
        success: false,
        content: "",
        error: "Timeout must be a non-negative number of milliseconds",
      };
    }

    if (context.permissionManager) {
      try {
        const permissionContext = context.permissionManager.createContext(
          POWERSHELL_TOOL_NAME,
          context.permissionMode || "default",
          context.canUseToolCallback,
          { command, description, timeout, workdir: context.workdir },
          context.toolCallId,
        );
        const permissionResult =
          await context.permissionManager.checkPermission(permissionContext);

        if (permissionResult.behavior === "deny") {
          return {
            success: false,
            content: "",
            error: `${POWERSHELL_TOOL_NAME} operation denied by user, reason: ${permissionResult.message || "No reason provided"}`,
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

    return new Promise<ToolResult>((resolve) => {
      const spawnOptions: SpawnOptions = {
        // fd0 is never a live pipe: nothing writes to the command's stdin, and
        // a command that prompts would otherwise hang until the timeout.
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // The command is already an argv entry (`-Command <string>`); letting
        // spawn prepend a shell would re-quote it a third time.
        shell: false,
        cwd: context.workdir,
        env: { ...process.env, ...context.sessionEnv },
      };

      let child: ChildProcess;
      try {
        child = spawn(
          provider.shellPath,
          provider.getSpawnArgs(command),
          spawnOptions,
        );
      } catch (error) {
        resolve({
          success: false,
          content: "",
          error: `Failed to execute command: ${(error as Error).message}`,
        });
        return;
      }

      let outputBuffer = "";
      let errorBuffer = "";
      let isAborted = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      let finished = false;

      // Windows PowerShell 5.1 writes GBK (cp936) for native tools it calls and
      // the console's code page in general — not UTF-8, which is what 7 writes.
      // `WindowsStreamDecoder` decides per stream, so both editions work.
      const stdoutDecoder =
        process.platform === "win32" ? new WindowsStreamDecoder() : null;
      const stderrDecoder =
        process.platform === "win32" ? new WindowsStreamDecoder() : null;

      const describeOutput = (): string =>
        outputBuffer + (errorBuffer ? "\n" + errorBuffer : "");

      const handleAbort = (reason = "Command execution was aborted") => {
        if (finished || isAborted) return;
        isAborted = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        terminateChildProcessTree(child);

        const processedOutput = processToolResult(
          describeOutput(),
          BASH_MAX_OUTPUT_CHARS,
          "powershell",
        );
        resolve({
          success: false,
          content: processedOutput ? `${processedOutput}\n\n${reason}` : reason,
          error: reason,
          metadata: { exitCode: 130 },
        });
      };

      if (context.abortSignal) {
        if (context.abortSignal.aborted) {
          handleAbort();
          return;
        }
        context.abortSignal.addEventListener("abort", () => handleAbort(), {
          once: true,
        });
      }

      if (timeout && timeout > 0) {
        timeoutHandle = setTimeout(() => {
          handleAbort(
            `Command timed out after ${Math.round(timeout / 1000)}s. Consider breaking the command into smaller steps or increasing the timeout.`,
          );
        }, timeout);
      }

      child.stdout?.on("data", (data) => {
        if (isAborted) return;
        outputBuffer += stdoutDecoder
          ? stdoutDecoder.push(data)
          : data.toString();
      });

      child.stderr?.on("data", (data) => {
        if (isAborted) return;
        errorBuffer += stderrDecoder
          ? stderrDecoder.push(data)
          : data.toString();
      });

      /**
       * Read the buffers once the pipes are done, not when the process exits:
       * `-Command` writes its last line and exits in the same breath, so at
       * 'exit' the trailing chunk can still be in flight. The valve covers
       * pipes held open by a grandchild.
       */
      const finalize = (code: number | null): void => {
        if (finished) return;
        finished = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (stdoutDecoder) outputBuffer += stdoutDecoder.flush();
        if (stderrDecoder) errorBuffer += stderrDecoder.flush();

        const exitCode = code ?? 0;
        const combinedOutput = describeOutput();
        const content = processToolResult(
          combinedOutput || `Command executed with exit code: ${exitCode}`,
          BASH_MAX_OUTPUT_CHARS,
          "powershell",
        );

        const lines = combinedOutput.trim().split("\n");
        const shortResult =
          lines.length <= 3
            ? lines.join("\n")
            : `... +${lines.length - 3} lines\n` + lines.slice(-3).join("\n");

        resolve({
          success: exitCode === 0,
          content,
          shortResult: shortResult || undefined,
          // Reported as-is: PowerShell's own exit status is not `$LASTEXITCODE`
          // (that is the hook layer's concern, not the tool's).
          error:
            exitCode !== 0
              ? `Command failed with exit code: ${exitCode}`
              : undefined,
          metadata: { exitCode },
        });
      };

      child.on("exit", (code) => {
        if (isAborted) return;

        const pendingStreams = [child.stdout, child.stderr].filter(
          (stream): stream is Readable =>
            !!stream &&
            !stream.readableEnded &&
            typeof stream.once === "function",
        );
        if (pendingStreams.length === 0) {
          finalize(code);
          return;
        }

        let drained = false;
        let flushTimer: NodeJS.Timeout | undefined;
        const finish = () => {
          if (drained) return;
          drained = true;
          if (flushTimer) clearTimeout(flushTimer);
          finalize(code);
        };
        const remaining = new Set(pendingStreams);
        for (const stream of pendingStreams) {
          const onDone = () => {
            remaining.delete(stream);
            if (remaining.size === 0) finish();
          };
          stream.once("end", onDone);
          stream.once("error", onDone);
        }
        flushTimer = setTimeout(() => {
          if (!drained) setImmediate(finish);
        }, STREAM_FLUSH_TIMEOUT_MS);
      });

      child.on("error", (error) => {
        if (finished || isAborted) return;
        finished = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        logger.debug(`[PowerShell] spawn error: ${error.message}`);
        resolve({
          success: false,
          content: "",
          error: `Failed to execute command: ${error.message}`,
        });
      });
    });
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const description = params.description as string;
    const command = params.command as string;

    return description || command;
  },
};
