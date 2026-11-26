import { type ChildProcess, type SpawnOptions } from "child_process";
import * as fs from "fs";
import { Readable } from "stream";
import { logger } from "../../utils/globalLogger.js";
import { spawnHidden } from "../../utils/execFileHidden.js";
import { getShellProvider } from "../../utils/shell/resolveProvider.js";
import { terminateChildProcessTree } from "../../utils/terminateProcessTree.js";
import { persistToolResult } from "../../utils/toolResultStorage.js";
import { probeTempDir, resolveTempDir } from "../../utils/tempDir.js";
import { BASH_MAX_OUTPUT_CHARS } from "../../constants/toolLimits.js";
import { POWERSHELL_TOOL_NAME, READ_TOOL_NAME } from "../../constants/tools.js";
import { resolveToCanonical } from "../../utils/powershellStructure/canonical.js";
import {
  POWERSHELL_DEFAULT_TIMEOUT_MS,
  POWERSHELL_MAX_TIMEOUT_MS,
  powershellPrompt,
} from "./prompt.js";
import {
  composePowerShellResultText,
  powershellOutputSchema,
  renderPowerShellResultData,
  type PowerShellResultData,
} from "../resultData/powershell.js";
import { emptyOutputSentence } from "../resultData/bash.js";
import { interpretPowerShellExit } from "../shellExitCode.js";
import type { ToolPlugin, ToolResult, ToolContext } from "../types.js";

// Same valve as the Bash tool: the child's 'exit' event fires before its stdio
// pipes have drained, so the buffers are read only after the streams emit
// 'end' — with a bound, because a grandchild that inherited the pipe write ends
// (`Start-Process` with a redirected stream, a detached `cmd /c`) would delay
// 'end' indefinitely.
const STREAM_FLUSH_TIMEOUT_MS = 100;

/**
 * Commands that must never be auto-backgrounded when they hit the timeout.
 * They are the "wait a moment" idiom: handing the model a task ID instead of
 * the answer it asked for is worse than failing. Same rule the Bash tool
 * applies to `sleep`, spelled for PowerShell — `sleep` is the built-in alias of
 * `Start-Sleep`, so both forms are listed (aliases are folded by
 * `resolveToCanonical`, which is the same table the permission path uses).
 */
const DISALLOWED_AUTO_BACKGROUND_COMMANDS = ["start-sleep", "sleep"];

function isAutobackgroundingAllowed(command: string): boolean {
  const firstWord = command.trim().split(/\s+/)[0];
  if (!firstWord) return true;
  return !DISALLOWED_AUTO_BACKGROUND_COMMANDS.includes(
    resolveToCanonical(firstWord).toLowerCase(),
  );
}

/**
 * Read the CWD the shell wrote, then delete the file.
 *
 * Best-effort, like the Bash tool's reader: a target directory that no longer
 * exists (a removed worktree, a `cd` into a deleted path) must not turn a
 * finished command into a failure, so every failure path returns `undefined`.
 */
function readTrackedCwd(cwdFilePath: string): string | undefined {
  try {
    if (!fs.existsSync(cwdFilePath)) return undefined;
    // 5.1's `Out-File -Encoding utf8` writes a BOM; PowerShell 7 does not.
    const trackedCwd = fs
      .readFileSync(cwdFilePath, "utf8")
      .replace(/^\uFEFF/, "")
      .trim();
    if (!trackedCwd) return undefined;
    fs.accessSync(trackedCwd, fs.constants.F_OK);
    return trackedCwd;
  } catch (error) {
    logger.debug(
      `[PowerShell] Could not read or validate the tracked cwd from ${cwdFilePath}:`,
      error,
    );
    return undefined;
  } finally {
    try {
      fs.unlinkSync(cwdFilePath);
    } catch {
      // Best-effort cleanup: the file may never have been written.
    }
  }
}

/**
 * The compact label is one line, whatever the command looks like — a script
 * block pasted into PowerShell would otherwise break the `● PowerShell <label>`
 * row (and the REPL summary line) into several. Same collapse as `bashTool`.
 */
function oneLineLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Long output goes to disk, exactly as the Bash tool does it: the whole body is
 * written into the tool-results directory, `data` keeps the path and the length,
 * and the text the model sees is the `<persisted-output>` wrapper the renderer
 * builds from those two (CC's `persistedOutputPath` / `persistedOutputSize`,
 * `PowerShellTool.tsx:251-252`).
 *
 * The write is a side effect and belongs here; the wording belongs to
 * `renderPowerShellResultData`. `data.stdout` keeps just enough to derive the
 * preview (first 2048 characters) — the rest is in the file.
 */
function stashLongOutput(data: PowerShellResultData): void {
  const body = composePowerShellResultText(data);
  if (body.length <= BASH_MAX_OUTPUT_CHARS) return;
  const filePath = persistToolResult(body, "powershell");
  if (!filePath) return;
  data.persistedOutputPath = filePath;
  data.persistedOutputSize = body.length;
  data.stdout = data.stdout.slice(0, BASH_MAX_OUTPUT_CHARS);
}

/**
 * The PowerShell tool: one command, one `powershell.exe -Command`, one result.
 *
 * Registration is gated (`utils/shell/shellToolGate.ts`): the tool only exists
 * in a session whose shell is PowerShell, so its absence and the shell choice
 * can never disagree. The working directory is tracked the same way the Bash
 * tool tracks it — the provider appends a `(Get-Location).Path | Out-File`
 * statement and this file reports the change through `onCwdChange`. What P5 adds
 * is background execution, not CWD memory.
 *
 * Permission goes through `PermissionManager`, whose PowerShell branch
 * (`tools/powershellTool/permissions.ts`) does the real work: this file hands it
 * the command and spawns what survives.
 */
export const powershellTool: ToolPlugin = {
  name: POWERSHELL_TOOL_NAME,
  searchHint: "run a PowerShell command",
  outputSchema: powershellOutputSchema,
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
          run_in_background: {
            type: "boolean",
            description: `Set to true to run this command in the background. Use ${READ_TOOL_NAME} to read the output later.`,
          },
        },
        required: ["command"],
      },
    },
  },
  // No `leanPrompt`: CC's PowerShellTool has none either (`@343320400`), and a
  // condensed variant would hide the bash → PowerShell table from every lean
  // session — which is the default. See `./prompt.ts`.
  prompt: powershellPrompt,
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const command = args.command;
    const description = args.description as string | undefined;
    const runInBackground = args.run_in_background as boolean | undefined;
    // Background runs carry no default timeout: the default exists to stop a
    // foreground command from blocking the turn, and a background task is
    // exactly the case where the user asked it to take its time (Bash does the
    // same). An explicit `timeout` still applies.
    const timeout = runInBackground
      ? (args.timeout as number | undefined)
      : ((args.timeout as number | undefined) ?? POWERSHELL_DEFAULT_TIMEOUT_MS);

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

    if (runInBackground) {
      const backgroundTaskManager = context.backgroundTaskManager;
      if (!backgroundTaskManager) {
        return {
          success: false,
          content: "",
          error: "Background task manager not available",
        };
      }

      // No CWD tracking and no exit probe for a background task: the process
      // outlives this call, so a tracked-cwd temp file would never be read, and
      // the manager reports the shell's own exit code anyway (the Bash tool's
      // background branch skips the wrapper for the same reason).
      // This branch spawns the shell itself, so it misses the encoding statement
      // `buildExecCommand` carries: prepare the command and hand that to argv.
      const preparedCommand = await provider.prepareCommand(command);
      const { id: taskId } = backgroundTaskManager.startShell(
        preparedCommand,
        timeout,
        context.workdir,
        {
          // The task list shows what the model wrote, not the statement.
          displayCommand: command,
          shell: {
            file: provider.shellPath,
            args: provider.getSpawnArgs(preparedCommand),
            // Measured: a detached Windows PowerShell 5.1 child never runs the
            // command at all (exit 0, no output, no side effect) — DETACHED_PROCESS
            // gives it no console and 5.1's `-Command` then does nothing. So the
            // PowerShell branch stays attached, where `windowsHide` does its job.
            detached: false,
          },
        },
      );
      const task = backgroundTaskManager.getTask(taskId);
      const outputPath = task?.outputPath;
      const data: PowerShellResultData = {
        stdout: "",
        interrupted: false,
        backgroundTaskId: taskId,
        ...(outputPath ? { backgroundOutputPath: outputPath } : {}),
      };
      return {
        success: true,
        content: renderPowerShellResultData(data),
        shortResult: `Background process ${taskId} started${outputPath ? ` → ${outputPath}` : ""}`,
        backgroundTaskId: taskId,
        data,
      };
    }

    // The working directory is tracked through a temp file, exactly as the Bash
    // tool does it; an unwritable temp dir turns tracking off rather than
    // failing the command (the exit probe still runs — the provider appends it
    // either way).
    const tempDir = resolveTempDir();
    const tempDirProbe = probeTempDir(tempDir);
    const exec = provider.buildExecCommand(command, {
      tempDir: () => tempDir,
      cwdTracking: !tempDirProbe || tempDirProbe.writable,
    });
    const wrappedCommand = exec.commandString;
    const tempCwdFile = exec.cwdFilePath;

    // A command that outlives its timeout is moved to the background rather
    // than killed when it still has work to do — the same rule the Bash tool
    // applies, with the same exceptions (`Start-Sleep` / `sleep`).
    const shouldAutoBackground =
      !!context.backgroundTaskManager && isAutobackgroundingAllowed(command);

    return new Promise<ToolResult>((resolve) => {
      const spawnOptions: SpawnOptions = {
        // fd0 is never a live pipe: nothing writes to the command's stdin, and
        // a command that prompts would otherwise hang until the timeout.
        stdio: ["ignore", "pipe", "pipe"],
        // `spawnHidden` forces `windowsHide: true` — the host main process has
        // no console, so without it every command allocates a visible one.
        // The command is already an argv entry (`-Command <string>`); letting
        // spawn prepend a shell would re-quote it a third time.
        shell: false,
        cwd: context.workdir,
        env: { ...process.env, ...context.sessionEnv },
      };

      let child: ChildProcess;
      try {
        child = spawnHidden(
          provider.shellPath,
          provider.getSpawnArgs(wrappedCommand),
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
      let isBackgrounded = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      let finished = false;

      const describeOutput = (): string =>
        outputBuffer + (errorBuffer ? "\n" + errorBuffer : "");

      const cleanupTempFile = () => {
        try {
          fs.unlinkSync(tempCwdFile);
        } catch {
          // Best-effort cleanup: the file may never have been written.
        }
      };

      const handleAbort = (reason = "Command execution was aborted") => {
        if (finished || isAborted) return;
        isAborted = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        terminateChildProcessTree(child);
        cleanupTempFile();

        // `data` first, text from it: whatever the buffers held when the command
        // was cut off, plus the reason as the sentence the model reads.
        const data: PowerShellResultData = {
          stdout: describeOutput(),
          interrupted: true,
          interruptedReason: reason,
          // 中断档的退出码；正文不读它（见 resultData/powershell.ts）。
          exitCode: 130,
        };
        stashLongOutput(data);
        // 中断**是**失败（CC 的 mapper 用 `is_error: interrupted`，与 `Bash` 同一口
        // 径）：原因句在正文里，`error` 留同一个原因给宿主与 `$`。
        resolve({
          success: false,
          content: renderPowerShellResultData(data),
          data,
          error: reason,
        });
      };

      // A foreground command can be moved to the background by the user — CLI's
      // Ctrl-B, or the background button the GUI hosts put on the running tool
      // block; both land on `backgroundCurrentTask`. Without a registration here
      // that call walks an empty list and silently does nothing, which is why the
      // shortcut looked dead in PowerShell sessions (Bash registers the same way
      // in `bashTool.ts`).
      const foregroundTaskId = `powershell_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      if (context.foregroundTaskManager && command) {
        context.foregroundTaskManager.registerForegroundTask({
          id: foregroundTaskId,
          backgroundHandler: async () => {
            isBackgrounded = true;
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }

            const backgroundTaskManager = context.backgroundTaskManager;
            if (!backgroundTaskManager) {
              // Same wording as the Bash tool. `finished` is still false here,
              // so `handleAbort` really resolves the promise instead of
              // returning on its guard.
              handleAbort(
                "Failed to background: Background task manager not available",
              );
              return;
            }

            // The child keeps running; only its owner changes. `adoptProcess`
            // decodes and logs the rest of the output, so this call resolves
            // with the receipt text the model sees for the Bash tool too.
            finished = true;
            const taskId = backgroundTaskManager.adoptProcess(
              child,
              command,
              outputBuffer,
              errorBuffer,
            );
            const task = backgroundTaskManager.getTask(taskId);
            const outputPath = task?.outputPath;
            const data: PowerShellResultData = {
              stdout: "",
              interrupted: false,
              backgroundTaskId: taskId,
              backgroundedByUser: true,
              ...(outputPath ? { backgroundOutputPath: outputPath } : {}),
            };
            resolve({
              success: true,
              content: renderPowerShellResultData(data),
              shortResult: `Process ${taskId} backgrounded`,
              backgroundedByUser: true,
              backgroundTaskId: taskId,
              data,
            });
          },
        });
      }

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
          if (isAborted || isBackgrounded || finished) return;

          if (shouldAutoBackground) {
            // The command is still working, it just outlived the budget: keep it
            // running and hand the model the same receipt the Bash tool returns.
            isBackgrounded = true;
            finished = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (context.foregroundTaskManager) {
              context.foregroundTaskManager.unregisterForegroundTask(
                foregroundTaskId,
              );
            }

            const backgroundTaskManager = context.backgroundTaskManager!;
            const taskId = backgroundTaskManager.adoptProcess(
              child,
              command,
              outputBuffer,
              errorBuffer,
            );
            const task = backgroundTaskManager.getTask(taskId);
            const outputPath = task?.outputPath;
            logger.info(
              `[PowerShell] Command timed out after ${timeout}ms, auto-backgrounded as ${taskId}`,
            );
            const autoBackgroundData: PowerShellResultData = {
              stdout: "",
              interrupted: false,
              backgroundTaskId: taskId,
              assistantAutoBackgrounded: true,
              ...(outputPath ? { backgroundOutputPath: outputPath } : {}),
              timeoutMs: timeout,
            };
            resolve({
              success: true,
              content: renderPowerShellResultData(autoBackgroundData),
              shortResult: `Process ${taskId} auto-backgrounded`,
              assistantAutoBackgrounded: true,
              backgroundTaskId: taskId,
              data: autoBackgroundData,
            });
            return;
          }

          handleAbort(
            `Command timed out after ${Math.round(timeout / 1000)}s. Consider breaking the command into smaller steps or increasing the timeout.`,
          );
        }, timeout);
      }

      // UTF-8 because the provider says so: `prepareCommand` sets
      // `[Console]::OutputEncoding` before the command runs, which is the code
      // page 5.1 uses both for its own output and for decoding what a native
      // program wrote (7 defaults to it). No guessing on this side, matching
      // Claude Code's single decoding path.
      // 走 Node 自带的流式解码器：一个汉字被两次 pipe 读切开时保持完整。
      // 逐 chunk `toString()` 会在每个读边界落一个 U+FFFD（实测 100 KB 中文
      // 输出里 3 个）；可选调用是因为 child_process 的测试桩只实现了 `on`。
      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");

      child.stdout?.on("data", (data) => {
        if (isAborted) return;
        outputBuffer += data.toString();
      });

      child.stderr?.on("data", (data) => {
        if (isAborted) return;
        errorBuffer += data.toString();
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

        const exitCode = code ?? 0;
        const combinedOutput = describeOutput();

        // Same contract as the Bash tool: the shell wrote its final location to
        // a temp file, which is the only way a `Set-Location` survives the
        // process it ran in.
        const newCwd = readTrackedCwd(tempCwdFile);
        let cwdMessage: string | undefined;
        if (newCwd && newCwd !== context.workdir && context.onCwdChange) {
          // Working directories only: an internal grant (the auto-memory
          // directory) must not become where the shell lives, or every later
          // relative path would resolve there.
          const isInWorkingDirectory =
            context.permissionManager?.isPathInWorkingDirectory?.(newCwd) ??
            true;
          if (!isInWorkingDirectory && context.originalWorkdir) {
            context.onCwdChange(context.originalWorkdir);
            cwdMessage = `Shell cwd was reset to ${context.originalWorkdir}`;
          } else {
            context.onCwdChange(newCwd);
            cwdMessage = `Shell working directory changed to ${newCwd}`;
          }
        }

        // `data` first, text from it: the cwd note is its own field (CC keeps it
        // apart as well, `PowerShellTool.tsx:645`) and the empty-output sentence
        // stands in for `stdout`, so the renderer needs no exit code. The exit
        // code itself rides `data.exitCode` for the host card (it used to be
        // `ToolResult.metadata.exitCode`).
        //
        // Same family rule as `Bash`: exit 1 of `grep` / `where` / `diff` is the
        // command's answer, and `robocopy`'s 0–7 are too, so neither makes the
        // call a failure.
        //
        // Unlike `Bash`, CC's PowerShell tool never appends `Exit code N` to the
        // output (`1918-…PowerShellTool.js` only appends the trimmed stdout), so
        // the exit code shows up in `data.exitCode` and in nothing else.
        const verdict = interpretPowerShellExit(command, exitCode);
        const data: PowerShellResultData = {
          stdout: combinedOutput.trimEnd() || emptyOutputSentence(exitCode),
          interrupted: false,
          exitCode,
          ...(verdict.interpretation !== undefined
            ? { returnCodeInterpretation: verdict.interpretation }
            : {}),
          ...(cwdMessage ? { stderr: cwdMessage } : {}),
        };
        stashLongOutput(data);
        const content = renderPowerShellResultData(data);

        const lines = combinedOutput.trim().split("\n");
        const shortResult =
          lines.length <= 3
            ? lines.join("\n")
            : `... +${lines.length - 3} lines\n` + lines.slice(-3).join("\n");

        // Same rule as `Bash` (spec `core/bash-tools.md`「退出码不是工具成败」): the
        // command ran, so the exit code is its answer — not a failed call. The
        // reading rides `data.returnCodeInterpretation`.
        resolve({
          success: true,
          content,
          data,
          shortResult: shortResult || undefined,
        });
      };

      child.on("exit", (code) => {
        if (context.foregroundTaskManager) {
          context.foregroundTaskManager.unregisterForegroundTask(
            foregroundTaskId,
          );
        }

        // A backgrounded (or aborted) command already resolved its promise, and
        // its output now belongs to the background task's log.
        if (isAborted || isBackgrounded) return;

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
        if (context.foregroundTaskManager) {
          context.foregroundTaskManager.unregisterForegroundTask(
            foregroundTaskId,
          );
        }
        if (finished || isAborted) return;
        finished = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        cleanupTempFile();
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

    return oneLineLabel(description || command || "");
  },
};
