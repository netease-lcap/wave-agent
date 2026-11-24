import type { MessageManager } from "./messageManager.js";
import { Container } from "../utils/container.js";
import { bashTool } from "../tools/bashTool.js";
import { powershellTool } from "../tools/powershellTool/powershellTool.js";
import { BASH_TOOL_NAME, POWERSHELL_TOOL_NAME } from "../constants/tools.js";
import {
  collectShellToolGateInput,
  resolveShellKind,
} from "../utils/shell/shellToolGate.js";
import type { ToolPlugin } from "../tools/types.js";
import type { ConfigurationService } from "../services/configurationService.js";
import type { TaskManager } from "../services/taskManager.js";

export interface BashModeManagerOptions {
  workdir: string;
}

export interface CommandExecutionResult {
  exitCode: number;
  output: string;
}

/**
 * Bash mode (`!command`) execution. The command is surfaced as a user-message
 * tool block — the same rendering as fork-skill / `/plan` outputs (⎿ prefix +
 * markdown, result enters the model context via the generic
 * `<local-command-stdout>` rule) — and executed through the shell tool this
 * session actually has (shell resolution, CWD tracking, timeout, output
 * handling).
 *
 * The `!` syntax, the manager's name and the rendering are unchanged; only the
 * engine behind them is chosen by shell kind, the way Claude Code picks
 * `PowerShellTool` or `BashTool` for the same input
 * (`utils/processUserInput/processBashCommand.tsx:26,81`).
 */
export class BashModeManager {
  private workdir: string;
  public isCommandRunning = false;
  private abortController: AbortController | null = null;
  onCommandRunningChange?: (running: boolean) => void;

  constructor(
    private container: Container,
    options: BashModeManagerOptions,
  ) {
    this.workdir = options.workdir;
  }

  private get messageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  /**
   * Merged env (OS env overlaid with this session's settings snapshot) for
   * bash-mode subprocesses, so settings `env` vars reach them without
   * polluting other sessions in one `wave --stdio` process.
   */
  private get sessionEnv(): Record<string, string> {
    return (
      this.container
        .get<ConfigurationService>("ConfigurationService")
        ?.getMergedEnv?.() ?? (process.env as Record<string, string>)
    );
  }

  private setCommandRunning(isRunning: boolean): void {
    this.isCommandRunning = isRunning;
    this.onCommandRunningChange?.(isRunning);
  }

  /**
   * The shell tool a `!` command runs through, and the name its block carries.
   *
   * One decision, shared with the tool registry (`utils/shell/shellToolGate.ts`),
   * so a `!` command can never drive a shell the session does not have, and the
   * block is labelled after the tool that actually ran — a PowerShell session
   * shows a `PowerShell` block, its result formats through the same tool.
   *
   * A missing binary is deliberately not handled here: each tool already returns
   * the message that says what to install ("Git Bash not found…" /
   * "PowerShell not found. Install PowerShell 7…"), and a third one in this file
   * would be the one that goes stale.
   */
  private resolveShellTool(): { tool: ToolPlugin; name: string } {
    const kind = resolveShellKind(collectShellToolGateInput(this.workdir));
    return kind === "powershell"
      ? { tool: powershellTool, name: POWERSHELL_TOOL_NAME }
      : { tool: bashTool, name: BASH_TOOL_NAME };
  }

  public async executeCommand(command: string): Promise<number> {
    if (this.isCommandRunning) {
      throw new Error("Command already running");
    }

    this.setCommandRunning(true);

    try {
      const shell = this.resolveShellTool();

      // User message + running tool block. The user text mirrors the command
      // itself (`!ls` renders as `!ls`); the output lands on that block once,
      // when the command ends.
      const messageId = this.messageManager.addUserMessage({
        content: command,
      });
      const blockId = this.messageManager.addToolBlockToMessage(messageId, {
        name: shell.name,
        parameters: command,
        stage: "running",
      });

      this.abortController = new AbortController();

      const taskManager = this.container.get<TaskManager>("TaskManager")!;
      // No permissionManager in the context: bash mode is an explicit user
      // command, it must not be blocked by the permission gate.
      const result = await shell.tool.execute(
        {
          command,
          // The user typed this command themselves, so it runs outside the
          // sandbox when policy allows it — the same flag Claude Code passes to
          // both shell tools. `sandbox.allowUnsandboxedCommands: false` still
          // wins inside the sandbox manager.
          dangerouslyDisableSandbox: true,
        },
        {
          workdir: this.workdir,
          taskManager,
          sessionEnv: this.sessionEnv,
          abortSignal: this.abortController.signal,
        },
      );

      // 退出码由 shell 工具写在 `data.exitCode` 里；没给就按成功与否兜底。
      const dataExitCode = (result.data as { exitCode?: unknown } | undefined)
        ?.exitCode;
      const exitCode =
        typeof dataExitCode === "number"
          ? dataExitCode
          : result.success
            ? 0
            : 1;
      // bash 模式是用户的终端，成败只看退出码（spec `ui/bash-mode.md`「退出码呈现」：
      // 成功是 exit 0、失败标 `[exit code: N]`）。**不能读 `result.success`**：自
      // spec `core/bash-tools.md`「退出码不是工具成败」起，命令非零退出也是
      // `success: true`（解释进 `data.returnCodeInterpretation`），照旧读它会让
      // `!ls /nonexistent` 既没有退出码标注、又亮绿点。
      //
      // 前缀不省：工具自己也会在正文末尾补一行 `Exit code N`（给模型看的，
      // `resultData/bash.ts`），两条重复一次是刻意的——中断档（超时、abort）的正文
      // 只有原因句、不带退出码，去掉前缀那一档就看不到 130 了。
      const failed = exitCode !== 0;
      const resultText = failed
        ? `[exit code: ${exitCode}]` +
          (result.content ? `\n\n${result.content}` : "")
        : result.content;
      this.messageManager.updateToolBlock({
        id: blockId,
        messageId,
        result: resultText,
        shortResult: result.shortResult,
        stage: "end",
        success: !failed,
      });

      return exitCode;
    } finally {
      this.abortController = null;
      this.setCommandRunning(false);
    }
  }

  public abortCommand(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.isCommandRunning = false;
  }
}
