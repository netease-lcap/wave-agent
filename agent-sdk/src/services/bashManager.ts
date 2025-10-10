import { spawn, type ChildProcess } from "child_process";
import { addBashCommandToHistory } from "../utils/bashHistory.js";

export interface BashManagerOptions {
  onAddCommandOutputMessage: (command: string) => void;
  onUpdateCommandOutputMessage: (command: string, output: string) => void;
  onCompleteCommandMessage: (command: string, exitCode: number) => void;
}

export interface CommandExecutionResult {
  exitCode: number;
  output: string;
}

export class BashManager {
  private workdir: string;
  private onAddCommandOutputMessage: (command: string) => void;
  private onUpdateCommandOutputMessage: (
    command: string,
    output: string,
  ) => void;
  private onCompleteCommandMessage: (command: string, exitCode: number) => void;
  private isCommandRunning = false;
  private currentProcess: ChildProcess | null = null;

  constructor(options: BashManagerOptions) {
    this.workdir = process.cwd();
    this.onAddCommandOutputMessage = options.onAddCommandOutputMessage;
    this.onUpdateCommandOutputMessage = options.onUpdateCommandOutputMessage;
    this.onCompleteCommandMessage = options.onCompleteCommandMessage;
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
    this.onAddCommandOutputMessage(command);

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
        this.onUpdateCommandOutputMessage(command, outputBuffer);
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

        this.onCompleteCommandMessage(command, exitCode);

        this.isCommandRunning = false;
        this.currentProcess = null;
        resolve(exitCode);
      });

      child.on("error", (error) => {
        updateOutput(`\nError: ${error.message}\n`);
        this.onCompleteCommandMessage(command, 1);

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
