import { spawn, type ChildProcess } from "child_process";
import type { Message } from "../types.js";
import { addBashCommandToHistory } from "../utils/bashHistory.js";
import {
  addCommandOutputMessage,
  updateCommandOutputInMessage,
  completeCommandInMessage,
} from "../utils/messageOperations.js";

export interface BashManagerOptions {
  onMessagesUpdate: (updater: (prev: Message[]) => Message[]) => void;
}

export interface CommandExecutionResult {
  exitCode: number;
  output: string;
}

export class BashManager {
  private workdir: string;
  private onMessagesUpdate: (updater: (prev: Message[]) => Message[]) => void;
  private isCommandRunning = false;
  private currentProcess: ChildProcess | null = null;

  constructor(options: BashManagerOptions) {
    this.workdir = process.cwd();
    this.onMessagesUpdate = options.onMessagesUpdate;
  }

  public getIsCommandRunning(): boolean {
    return this.isCommandRunning;
  }

  public async executeCommand(command: string): Promise<number> {
    if (this.isCommandRunning) {
      throw new Error("Command already running");
    }

    this.isCommandRunning = true;

    // Add command output placeholder using message operations utility
    this.onMessagesUpdate((prev: Message[]) =>
      addCommandOutputMessage(prev, command),
    );

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
        this.onMessagesUpdate((prev) =>
          updateCommandOutputInMessage(prev, command, outputBuffer),
        );
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

        this.onMessagesUpdate((prev) =>
          completeCommandInMessage(prev, command, exitCode),
        );

        this.isCommandRunning = false;
        this.currentProcess = null;
        resolve(exitCode);
      });

      child.on("error", (error) => {
        updateOutput(`\nError: ${error.message}\n`);
        this.onMessagesUpdate((prev: Message[]) =>
          completeCommandInMessage(prev, command, 1),
        );

        this.isCommandRunning = false;
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
