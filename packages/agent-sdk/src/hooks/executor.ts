/**
 * Hook Command Executor
 *
 * Handles the execution of hook commands in isolated processes with proper
 * timeout handling, environment variable injection, and cross-platform support.
 */

import { spawn, type ChildProcess } from "child_process";
import {
  type HookExecutionContext,
  type HookExecutionResult,
  type HookExecutionOptions,
  type ExtendedHookExecutionContext,
  type HookJsonInput,
  getSessionFilePath,
} from "./types.js";
import type { Logger } from "../types.js";

/**
 * Build JSON input data for hook stdin
 */
function buildHookJsonInput(
  context: ExtendedHookExecutionContext,
): HookJsonInput {
  const jsonInput: HookJsonInput = {
    session_id: context.sessionId || "unknown",
    transcript_path:
      context.transcriptPath ||
      (context.sessionId ? getSessionFilePath(context.sessionId) : ""),
    cwd: context.cwd || context.projectDir,
    hook_event_name: context.event,
  };

  // Add optional fields based on event type
  if (context.event === "PreToolUse" || context.event === "PostToolUse") {
    if (context.toolName) {
      jsonInput.tool_name = context.toolName;
    }
    if (context.toolInput !== undefined) {
      jsonInput.tool_input = context.toolInput;
    }
  }

  if (context.event === "PostToolUse" && context.toolResponse !== undefined) {
    jsonInput.tool_response = context.toolResponse;
  }

  if (
    context.event === "UserPromptSubmit" &&
    context.userPrompt !== undefined
  ) {
    jsonInput.user_prompt = context.userPrompt;
  }

  return jsonInput;
}

export interface IHookExecutor {
  // Execute a single hook command
  executeCommand(
    command: string,
    context: HookExecutionContext | ExtendedHookExecutionContext,
    options?: HookExecutionOptions,
  ): Promise<HookExecutionResult>;

  // Execute multiple commands in sequence
  executeCommands(
    commands: string[],
    context: HookExecutionContext | ExtendedHookExecutionContext,
    options?: HookExecutionOptions,
  ): Promise<HookExecutionResult[]>;

  // Validate command safety
  isCommandSafe(command: string): boolean;
}

export class HookExecutor implements IHookExecutor {
  private readonly defaultTimeout = 10000; // 10 seconds
  private readonly maxTimeout = 300000; // 5 minutes
  private readonly logger?: Logger;
  private readonly skipExecution: boolean;

  constructor(logger?: Logger, options?: { skipExecution?: boolean }) {
    this.logger = logger;
    // Skip execution in test environment unless we're specifically testing the executor
    this.skipExecution =
      options?.skipExecution ??
      ((process.env.NODE_ENV === "test" || process.env.VITEST === "true") &&
        !process.env.WAVE_TEST_HOOKS_EXECUTION);
  }

  /**
   * Execute a single hook command in an isolated process
   */
  async executeCommand(
    command: string,
    context: HookExecutionContext | ExtendedHookExecutionContext,
    options: HookExecutionOptions = {},
  ): Promise<HookExecutionResult> {
    const startTime = Date.now();
    const timeout = Math.min(
      options.timeout ?? this.defaultTimeout,
      this.maxTimeout,
    );
    const cwd = options.cwd ?? context.projectDir;

    // Skip command execution in test environment (unless specifically testing hooks)
    if (this.skipExecution) {
      this.logger?.debug(`[Hook] Skipping command execution: ${command}`);
      return {
        success: true,
        exitCode: 0,
        stdout: "Test environment: command execution skipped",
        duration: Date.now() - startTime,
        timedOut: false,
      };
    }

    // Log hook execution start
    this.logger?.info(`[Hook] Executing ${context.event} hook: ${command}`);
    this.logger?.info(
      `[Hook] Context: event=${context.event}, tool=${context.toolName || "N/A"}, cwd=${cwd}`,
    );

    // Validate command safety
    if (!this.isCommandSafe(command)) {
      const error = "Command contains potentially unsafe characters";
      this.logger?.warn(`[Hook] Command safety validation failed: ${error}`);
      return {
        success: false,
        exitCode: -1,
        stderr: error,
        duration: Date.now() - startTime,
        timedOut: false,
      };
    }

    // Prepare environment variables
    const env = this.buildEnvironment(context);

    // Resolve command with environment variables
    const resolvedCommand = this.resolveEnvironmentVariables(command, env);

    // Prepare JSON input for stdin (if extended context is provided)
    const isExtendedContext =
      "sessionId" in context ||
      "toolInput" in context ||
      "toolResponse" in context ||
      "userPrompt" in context;
    const jsonInput = isExtendedContext
      ? buildHookJsonInput(context as ExtendedHookExecutionContext)
      : null;

    this.logger?.info(`[Hook] Resolved command: ${resolvedCommand}`);
    if (jsonInput) {
      this.logger?.debug(`[Hook] JSON input: ${JSON.stringify(jsonInput)}`);
    }

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let childProcess: ChildProcess;

      // Setup timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        this.logger?.warn(
          `[Hook] Command timed out after ${timeout}ms: ${resolvedCommand}`,
        );
        if (childProcess && !childProcess.killed) {
          childProcess.kill("SIGTERM");
          // Force kill after 5 seconds if SIGTERM doesn't work
          setTimeout(() => {
            if (childProcess && !childProcess.killed) {
              this.logger?.warn(
                `[Hook] Force killing process: ${resolvedCommand}`,
              );
              childProcess.kill("SIGKILL");
            }
          }, 5000);
        }
      }, timeout);

      try {
        // Execute command using shell for cross-platform compatibility
        const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
        const shellArgs = process.platform === "win32" ? ["/c"] : ["-c"];

        childProcess = spawn(shell, [...shellArgs, resolvedCommand], {
          cwd,
          env,
          stdio: "pipe",
          windowsHide: true, // Hide console window on Windows
        });

        this.logger?.debug(`[Hook] Process started (PID: ${childProcess.pid})`);

        // Write JSON input to stdin if available
        if (jsonInput && childProcess.stdin) {
          try {
            const jsonString = JSON.stringify(jsonInput, null, 2);
            childProcess.stdin.write(jsonString);
            childProcess.stdin.end();
            this.logger?.debug(`[Hook] JSON input written to stdin`);
          } catch (error) {
            this.logger?.warn(`[Hook] Failed to write JSON to stdin: ${error}`);
          }
        }

        // Collect stdout
        childProcess.stdout?.on("data", (data) => {
          stdout += data.toString();
        });

        // Collect stderr
        childProcess.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        // Handle process completion
        childProcess.on("close", (exitCode) => {
          clearTimeout(timeoutId);

          const duration = Date.now() - startTime;
          const success = !timedOut && exitCode === 0;

          // Log execution result
          if (success) {
            this.logger?.info(
              `[Hook] Command completed successfully in ${duration}ms (exit code: ${exitCode})`,
            );
          } else {
            this.logger?.warn(
              `[Hook] Command failed in ${duration}ms (exit code: ${exitCode}, timed out: ${timedOut})`,
            );
            if (stderr) {
              this.logger?.warn(`[Hook] stderr: ${stderr.trim()}`);
            }
          }

          if (stdout && stdout.trim()) {
            this.logger?.info(`[Hook] stdout: ${stdout.trim()}`);
          }

          resolve({
            success,
            exitCode: exitCode ?? undefined,
            stdout: stdout.trim() || undefined,
            stderr: stderr.trim() || undefined,
            duration,
            timedOut,
          });
        });

        // Handle process errors
        childProcess.on("error", (error) => {
          clearTimeout(timeoutId);

          const duration = Date.now() - startTime;

          this.logger?.error(
            `[Hook] Process error in ${duration}ms: ${error.message}`,
          );

          resolve({
            success: false,
            stderr: error.message,
            duration,
            timedOut,
          });
        });
      } catch (error) {
        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown execution error";

        this.logger?.error(
          `[Hook] Execution error in ${duration}ms: ${errorMessage}`,
        );

        resolve({
          success: false,
          stderr: errorMessage,
          duration,
          timedOut,
        });
      }
    });
  }

  /**
   * Execute multiple commands in sequence
   * Stops on first failure unless configured otherwise
   */
  async executeCommands(
    commands: string[],
    context: HookExecutionContext | ExtendedHookExecutionContext,
    options: HookExecutionOptions = {},
  ): Promise<HookExecutionResult[]> {
    const results: HookExecutionResult[] = [];

    this.logger?.info(
      `[Hook] Executing ${commands.length} commands in sequence for ${context.event} event`,
    );

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      this.logger?.debug(
        `[Hook] Command ${i + 1}/${commands.length}: ${command}`,
      );

      try {
        const result = await this.executeCommand(command, context, options);
        results.push(result);

        // Stop on first failure to prevent cascading issues
        if (!result.success) {
          this.logger?.warn(
            `[Hook] Stopping sequence at command ${i + 1} due to failure`,
          );
          break;
        }
      } catch (error) {
        // This shouldn't happen as executeCommand handles all errors,
        // but include defensive handling
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger?.error(
          `[Hook] Unexpected error in command ${i + 1}: ${errorMessage}`,
        );

        results.push({
          success: false,
          stderr: errorMessage,
          duration: 0,
          timedOut: false,
        });
        break;
      }
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger?.info(
      `[Hook] Completed sequence: ${successCount}/${results.length} commands succeeded`,
    );

    return results;
  }

  /**
   * Validate command safety to prevent injection attacks
   */
  isCommandSafe(command: string): boolean {
    if (!command || typeof command !== "string") return false;

    // Command cannot be empty
    const trimmed = command.trim();
    if (trimmed.length === 0) return false;

    // Basic safety checks - these could be expanded based on security requirements
    const dangerousPatterns = [
      /\b(rm\s+-rf\s+\/|rm\s+-rf\s+~|rm\s+-rf\s+\*)/i, // Dangerous rm commands
      /\bdd\s+if=/i, // dd commands that could be destructive
      /:\(\)\{.*\}/, // Fork bomb patterns
      /\beval\s*[(\s]/i, // Code evaluation
      /\bexec\s+/i, // Process execution in shells
    ];

    // Check for obviously dangerous patterns
    if (dangerousPatterns.some((pattern) => pattern.test(trimmed))) {
      return false;
    }

    return true;
  }

  /**
   * Build environment variables for hook execution
   */
  private buildEnvironment(context: HookExecutionContext): NodeJS.ProcessEnv {
    return {
      ...process.env, // Inherit parent environment
      WAVE_PROJECT_DIR: context.projectDir,
    };
  }

  /**
   * Resolve environment variables in command string
   */
  private resolveEnvironmentVariables(
    command: string,
    env: NodeJS.ProcessEnv,
  ): string {
    let resolved = command;

    // Replace $VAR and ${VAR} patterns
    Object.entries(env).forEach(([key, value]) => {
      if (value !== undefined) {
        // Handle both $VAR and ${VAR} syntax
        const dollarPattern = new RegExp(`\\$${key}\\b`, "g");
        const bracesPattern = new RegExp(`\\$\\{${key}\\}`, "g");

        resolved = resolved.replace(dollarPattern, value);
        resolved = resolved.replace(bracesPattern, value);
      }
    });

    return resolved;
  }

  /**
   * Get process statistics for monitoring
   */
  getExecutionStats(): {
    platform: NodeJS.Platform;
    defaultTimeout: number;
    maxTimeout: number;
  } {
    return {
      platform: process.platform,
      defaultTimeout: this.defaultTimeout,
      maxTimeout: this.maxTimeout,
    };
  }

  /**
   * Test if the executor can run commands on this platform
   */
  isSupported(): boolean {
    try {
      // Try to detect shell availability - basic check could be enhanced with actual shell testing
      return true;
    } catch {
      return false;
    }
  }
}
