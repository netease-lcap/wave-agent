import { spawn, type ChildProcess } from "child_process";
import { addBashCommandToHistory } from "../utils/bashHistory.js";
import type { MessageManager } from "./messageManager.js";

export interface BashManagerOptions {
  messageManager: MessageManager;
  workdir: string;
}

export interface CommandExecutionResult {
  exitCode: number;
  output: string;
}

export class BashManager {
  private workdir: string;
  private messageManager: MessageManager;
  public isCommandRunning = false;
  private currentProcess: ChildProcess | null = null;

  constructor(options: BashManagerOptions) {
    this.workdir = options.workdir;
    this.messageManager = options.messageManager;
  }

  private setCommandRunning(isRunning: boolean): void {
    this.isCommandRunning = isRunning;
  }

  public async executeCommand(command: string): Promise<number> {
    if (this.isCommandRunning) {
      throw new Error("Command already running");
    }

    this.setCommandRunning(true);

    // Add command output placeholder
    this.messageManager.addCommandOutputMessage(command);

    return new Promise<number>((resolve) => {
      const child = spawn(command, {
        shell: true,
        stdio: "pipe",
        cwd: this.workdir,
        env: {
          ...process.env,
        },
      });

      this.currentProcess = child;
      let outputBuffer = "";

      const updateOutput = (newData: string) => {
        outputBuffer += newData;
        this.messageManager.updateCommandOutputMessage(command, outputBuffer);
      };

      child.stdout?.on("data", (data) => {
        updateOutput(data.toString());
      });

      child.stderr?.on("data", (data) => {
        updateOutput(data.toString());
      });

      child.on("exit", (code, signal) => {
        const exitCode = code === null && signal ? 130 : (code ?? 0);

        // 添加命令到bash历史记录
        addBashCommandToHistory(command, this.workdir);

        this.messageManager.completeCommandMessage(command, exitCode);

        this.setCommandRunning(false);
        this.currentProcess = null;
        resolve(exitCode);
      });

      child.on("error", (error) => {
        updateOutput(`\nError: ${error.message}\n`);
        this.messageManager.completeCommandMessage(command, 1);

        this.setCommandRunning(false);
        this.currentProcess = null;
        resolve(1);
      });
    });
  }

  public abortCommand(): void {
    if (this.currentProcess && this.isCommandRunning) {
      this.currentProcess.kill("SIGKILL");
      this.currentProcess = null;
      this.isCommandRunning = false;
    }
  }
}
