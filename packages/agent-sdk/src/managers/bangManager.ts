import { spawn, type ChildProcess } from "child_process";
import type { MessageManager } from "./messageManager.js";
import { Container } from "../utils/container.js";

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
  private currentProcess: ChildProcess | null = null;
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

  private setCommandRunning(isRunning: boolean): void {
    this.isCommandRunning = isRunning;
    this.onCommandRunningChange?.(isRunning);
  }

  public async executeCommand(command: string): Promise<number> {
    if (this.isCommandRunning) {
      throw new Error("Command already running");
    }

    this.setCommandRunning(true);

    // Add bang placeholder
    this.messageManager.addBangMessage(command);

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
      };

      child.stdout?.on("data", (data) => {
        updateOutput(data.toString());
      });

      child.stderr?.on("data", (data) => {
        updateOutput(data.toString());
      });

      child.on("exit", (code, signal) => {
        const exitCode = code === null && signal ? 130 : (code ?? 0);

        this.messageManager.completeBangMessage(
          command,
          exitCode,
          outputBuffer,
        );

        this.setCommandRunning(false);
        this.currentProcess = null;
        resolve(exitCode);
      });

      child.on("error", (error) => {
        updateOutput(`\nError: ${error.message}\n`);
        this.messageManager.completeBangMessage(command, 1, outputBuffer);

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
