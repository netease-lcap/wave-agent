import { spawn, type ChildProcess } from "child_process";
import type { Message } from "../types";
import { addBashCommandToHistory } from "../utils/bashHistory";

export interface BashManagerOptions {
  workdir: string;
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
    this.workdir = options.workdir;
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

    // Add command output placeholder
    const outputMessage: Message = {
      role: "assistant",
      blocks: [
        {
          type: "command_output",
          command,
          output: "",
          isRunning: true,
          exitCode: null,
        },
      ],
    };

    this.onMessagesUpdate((prev: Message[]) => [...prev, outputMessage]);

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
        this.onMessagesUpdate((prev) => {
          const newMessages = [...prev];
          // Find the last assistant message with a command_output block for this command
          for (let i = newMessages.length - 1; i >= 0; i--) {
            const msg = newMessages[i];
            if (msg.role === "assistant") {
              const commandBlock = msg.blocks.find(
                (block) =>
                  block.type === "command_output" &&
                  block.command === command &&
                  block.isRunning,
              );
              if (commandBlock && commandBlock.type === "command_output") {
                commandBlock.output = outputBuffer.trim();
                break;
              }
            }
          }
          return newMessages;
        });
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

        this.onMessagesUpdate((prev) => {
          const newMessages = [...prev];
          // Find the last assistant message with a command_output block for this command
          for (let i = newMessages.length - 1; i >= 0; i--) {
            const msg = newMessages[i];
            if (msg.role === "assistant") {
              const commandBlock = msg.blocks.find(
                (block) =>
                  block.type === "command_output" &&
                  block.command === command &&
                  block.isRunning,
              );
              if (commandBlock && commandBlock.type === "command_output") {
                commandBlock.isRunning = false;
                commandBlock.exitCode = exitCode;
                break;
              }
            }
          }
          return newMessages;
        });

        this.isCommandRunning = false;
        this.currentProcess = null;
        resolve(exitCode);
      });

      child.on("error", (error) => {
        updateOutput(`\nError: ${error.message}\n`);
        this.onMessagesUpdate((prev: Message[]) => {
          const newMessages = [...prev];
          // Find the last assistant message with a command_output block for this command
          for (let i = newMessages.length - 1; i >= 0; i--) {
            const msg = newMessages[i];
            if (msg.role === "assistant") {
              const commandBlock = msg.blocks.find(
                (block) =>
                  block.type === "command_output" &&
                  block.command === command &&
                  block.isRunning,
              );
              if (commandBlock && commandBlock.type === "command_output") {
                commandBlock.isRunning = false;
                commandBlock.exitCode = 1;
                break;
              }
            }
          }
          return newMessages;
        });

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

  public updateWorkdir(newWorkdir: string): void {
    this.workdir = newWorkdir;
  }
}

export const createBashManager = (options: BashManagerOptions): BashManager => {
  return new BashManager(options);
};
