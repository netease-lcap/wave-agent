import type { MessageManager } from "./messageManager.js";
import { Container } from "../utils/container.js";
import { bashTool } from "../tools/bashTool.js";
import type { ConfigurationService } from "../services/configurationService.js";
import type { TaskManager } from "../services/taskManager.js";

export interface BangManagerOptions {
  workdir: string;
}

export interface CommandExecutionResult {
  exitCode: number;
  output: string;
}

export class BangManager {
  private workdir: string;
  public isCommandRunning = false;
  private abortController: AbortController | null = null;
  onCommandRunningChange?: (running: boolean) => void;

  constructor(
    private container: Container,
    options: BangManagerOptions,
  ) {
    this.workdir = options.workdir;
  }

  private get messageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  /**
   * Merged env (OS env overlaid with this session's settings snapshot) for
   * bang-command subprocesses, so settings `env` vars reach them without
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
   * Execute a `!` command. The command is surfaced as a user-message tool
   * block (name: "bash") — the same rendering as fork-skill / `/plan` outputs
   * (⎿ prefix + markdown, result stays out of the model context) — and
   * executed through the shared bash tool engine (shell resolution, CWD
   * tracking, timeout, output handling).
   */
  public async executeCommand(command: string): Promise<number> {
    if (this.isCommandRunning) {
      throw new Error("Command already running");
    }

    this.setCommandRunning(true);

    try {
      // User message + running tool block (incremental toolBlockUpdated
      // notifications drive the live UI on all three hosts).
      const messageId = this.messageManager.addUserMessage({
        content: command,
      });
      const blockId = this.messageManager.addToolBlockToMessage(messageId, {
        name: "bash",
        parameters: command,
        stage: "running",
      });

      this.abortController = new AbortController();

      const taskManager = this.container.get<TaskManager>("TaskManager")!;
      // No permissionManager in the context: bang is an explicit user command,
      // it must not be blocked by the permission gate.
      const result = await bashTool.execute(
        { command },
        {
          workdir: this.workdir,
          taskManager,
          sessionEnv: this.sessionEnv,
          abortSignal: this.abortController.signal,
        },
      );

      const exitCode =
        typeof result.metadata?.exitCode === "number"
          ? result.metadata.exitCode
          : result.success
            ? 0
            : 1;
      const resultText = result.success
        ? result.content
        : `[exit code: ${exitCode}]` +
          (result.content ? `\n\n${result.content}` : "");
      this.messageManager.updateToolBlock({
        id: blockId,
        messageId,
        result: resultText,
        stage: "end",
        success: result.success,
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
