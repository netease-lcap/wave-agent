/**
 * Hook Execution Services
 *
 * Provides hook command execution functionality and hook-specific configuration loading.
 * This module focuses on hook execution while delegating general Wave configuration
 * management to ConfigurationService.
 */

import { spawn, type ChildProcess } from "child_process";
import {
  type HookExecutionContext,
  type HookExecutionResult,
  type HookExecutionOptions,
  type ExtendedHookExecutionContext,
  type HookJsonInput,
} from "../types/hooks.js";
import { generateSessionFilePath } from "./session.js";

// =============================================================================
// Hook Execution Functions
// =============================================================================

/**
 * Build JSON input data for hook stdin
 */
async function buildHookJsonInput(
  context: ExtendedHookExecutionContext,
): Promise<HookJsonInput> {
  const workdir = context.cwd || context.projectDir || process.cwd();

  let transcriptPath = context.transcriptPath;
  if (!transcriptPath && context.sessionId) {
    try {
      transcriptPath = await generateSessionFilePath(
        context.sessionId,
        workdir,
      );
    } catch {
      transcriptPath = "";
    }
  }

  const jsonInput: HookJsonInput = {
    session_id: context.sessionId || "unknown",
    transcript_path: transcriptPath || "",
    cwd: workdir,
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

  // Add subagent_type if present
  if (context.subagentType !== undefined) {
    jsonInput.subagent_type = context.subagentType;
  }

  // Add notification fields for Notification events
  if (context.event === "Notification") {
    if (context.message !== undefined) {
      jsonInput.message = context.message;
    }
    if (context.notificationType !== undefined) {
      jsonInput.notification_type = context.notificationType;
    }
  }

  return jsonInput;
}

/**
 * Execute a single hook command
 */
export async function executeCommand(
  command: string,
  context: HookExecutionContext | ExtendedHookExecutionContext,
  options?: HookExecutionOptions,
): Promise<HookExecutionResult> {
  const defaultTimeout = 10000; // 10 seconds
  const maxTimeout = 300000; // 5 minutes
  const skipExecution =
    process.env.NODE_ENV === "test" &&
    process.env.TEST_HOOK_EXECUTION !== "true";

  const startTime = Date.now();
  const timeout = Math.min(options?.timeout ?? defaultTimeout, maxTimeout);

  // Return mock result if execution is skipped
  if (skipExecution) {
    return {
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      duration: 0,
      timedOut: false,
    };
  }

  // Prepare JSON input for hooks that need it
  let jsonInput: string | null = null;
  if ("sessionId" in context) {
    try {
      const hookJsonInput = await buildHookJsonInput(context);
      jsonInput = JSON.stringify(hookJsonInput, null, 2);
    } catch {
      // Continue execution even if JSON input preparation fails
    }
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Parse command for shell execution
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/sh";
    const shellFlag = isWindows ? "/c" : "-c";

    const childProcess: ChildProcess = spawn(shell, [shellFlag, command], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: context.projectDir,
      env: {
        ...process.env, // Environment variables from process.env
        ...("env" in context ? context.env || {} : {}), // Additional environment variables from configuration (if ExtendedHookExecutionContext)
        HOOK_EVENT: context.event,
        HOOK_TOOL_NAME: context.toolName || "",
        WAVE_PROJECT_DIR: context.projectDir,
      },
    });

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      childProcess.kill("SIGTERM");

      // Force kill after additional delay
      setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill("SIGKILL");
        }
      }, 2000);
    }, timeout);

    // Handle stdout
    if (childProcess.stdout) {
      childProcess.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
    }

    // Handle stderr
    if (childProcess.stderr) {
      childProcess.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    }

    // Send JSON input to stdin if we have prepared it
    if (childProcess.stdin && jsonInput) {
      try {
        childProcess.stdin.write(jsonInput);
        childProcess.stdin.end();
      } catch {
        // Continue execution even if JSON input fails
      }
    } else if (childProcess.stdin) {
      childProcess.stdin.end();
    }

    // Handle process completion
    childProcess.on("close", (code: number | null) => {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      resolve({
        success: !timedOut && (code === 0 || code === null),
        exitCode: code || 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        duration,
        timedOut,
      });
    });

    // Handle process errors
    childProcess.on("error", (error: Error) => {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      resolve({
        success: false,
        exitCode: 1,
        stdout: stdout.trim(),
        stderr: error.message,
        duration,
        timedOut,
      });
    });
  });
}

/**
 * Execute multiple commands in sequence
 */
export async function executeCommands(
  commands: string[],
  context: HookExecutionContext | ExtendedHookExecutionContext,
  options?: HookExecutionOptions,
): Promise<HookExecutionResult[]> {
  const results: HookExecutionResult[] = [];

  for (const command of commands) {
    const result = await executeCommand(command, context, options);
    results.push(result);

    // Stop on first failure unless continueOnFailure is set
    if (!result.success && !options?.continueOnFailure) {
      break;
    }
  }

  return results;
}

/**
 * Validate command safety (basic checks)
 */
export function isCommandSafe(command: string): boolean {
  const trimmed = command.trim();

  // Empty commands are safe (no-op)
  if (!trimmed) {
    return true;
  }

  // Check for obviously dangerous patterns
  const dangerousPatterns = [
    /rm\s+-rf\s+\//, // rm -rf /
    /sudo\s+rm/, // sudo rm
    />\s*\/dev\/sd[a-z]/, // writing to disk devices
    /dd\s+if=.*of=\/dev/, // dd to devices
    /mkfs/, // filesystem creation
    /fdisk/, // disk partitioning
    /format\s+[a-z]:/, // Windows format command
  ];

  return !dangerousPatterns.some((pattern) =>
    pattern.test(trimmed.toLowerCase()),
  );
}
