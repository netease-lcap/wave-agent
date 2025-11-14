/**
 * Hook Services
 *
 * Consolidated hook services providing both execution and configuration functionality.
 * Combines hook command execution and settings management into a single module.
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  type HookExecutionContext,
  type HookExecutionResult,
  type HookExecutionOptions,
  type ExtendedHookExecutionContext,
  type HookJsonInput,
  type HookConfiguration,
  type PartialHookConfiguration,
  isValidHookEvent,
} from "../types/hooks.js";
import { getSessionFilePath } from "./session.js";

// =============================================================================
// Hook Execution Functions
// =============================================================================

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
        ...process.env,
        HOOK_EVENT: context.event,
        HOOK_TOOL_NAME: context.toolName || "",
        HOOK_PROJECT_DIR: context.projectDir,
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

    // Send JSON input to stdin if we have extended context
    if (childProcess.stdin && "sessionId" in context) {
      try {
        const jsonInput = buildHookJsonInput(context);
        childProcess.stdin.write(JSON.stringify(jsonInput, null, 2));
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

// =============================================================================
// Hook Settings Functions
// =============================================================================

/**
 * Get the user-specific hooks configuration file path
 */
export function getUserHooksConfigPath(): string {
  return join(homedir(), ".wave", "hooks.json");
}

/**
 * Get the project-specific hooks configuration file path
 */
export function getProjectHooksConfigPath(workdir: string): string {
  return join(workdir, ".wave", "hooks.json");
}

/**
 * Load hooks configuration from a JSON file
 */
export function loadHooksConfigFromFile(
  filePath: string,
): PartialHookConfiguration | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, "utf-8");
  const config = JSON.parse(content) as HookConfiguration;

  // Validate basic structure
  if (!config || typeof config !== "object" || !config.hooks) {
    throw new Error(`Invalid hooks configuration structure in ${filePath}`);
  }

  return config.hooks;
}

/**
 * Load user-specific hooks configuration
 */
export function loadUserHooksConfig(): PartialHookConfiguration | null {
  return loadHooksConfigFromFile(getUserHooksConfigPath());
}

/**
 * Load project-specific hooks configuration
 */
export function loadProjectHooksConfig(
  workdir: string,
): PartialHookConfiguration | null {
  return loadHooksConfigFromFile(getProjectHooksConfigPath(workdir));
}

/**
 * Load and merge hooks configuration from both user and project sources
 */
export function loadMergedHooksConfig(
  workdir: string,
): PartialHookConfiguration | null {
  const userConfig = loadUserHooksConfig();
  const projectConfig = loadProjectHooksConfig(workdir);

  // No configuration found
  if (!userConfig && !projectConfig) {
    return null;
  }

  // Only one configuration found
  if (!userConfig) return projectConfig;
  if (!projectConfig) return userConfig;

  // Merge configurations (project overrides user)
  const merged: PartialHookConfiguration = {};

  // Combine all hook events
  const allEvents = new Set([
    ...Object.keys(userConfig),
    ...Object.keys(projectConfig),
  ]);

  for (const event of allEvents) {
    if (!isValidHookEvent(event)) continue;

    const userEventConfigs = userConfig[event] || [];
    const projectEventConfigs = projectConfig[event] || [];

    // Project configurations take precedence
    merged[event] = [...userEventConfigs, ...projectEventConfigs];
  }

  return merged;
}

/**
 * Check if hooks configuration exists (user or project)
 */
export function hasHooksConfiguration(workdir: string): boolean {
  return (
    existsSync(getUserHooksConfigPath()) ||
    existsSync(getProjectHooksConfigPath(workdir))
  );
}

/**
 * Get hooks configuration information for debugging
 */
export function getHooksConfigurationInfo(workdir: string): {
  hasUser: boolean;
  hasProject: boolean;
  paths: string[];
} {
  const userPath = getUserHooksConfigPath();
  const projectPath = getProjectHooksConfigPath(workdir);

  return {
    hasUser: existsSync(userPath),
    hasProject: existsSync(projectPath),
    paths: [userPath, projectPath],
  };
}
