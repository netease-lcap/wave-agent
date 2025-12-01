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
  type WaveConfiguration,
  type PartialHookConfiguration,
  getSessionFilePath,
  isValidHookEvent,
} from "../types/hooks.js";
import {
  type EnvironmentValidationResult,
  type MergedEnvironmentContext,
  type EnvironmentMergeOptions,
  isValidEnvironmentVars,
} from "../types/environment.js";

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

  // Add subagent_type if present
  if (context.subagentType !== undefined) {
    jsonInput.subagent_type = context.subagentType;
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
  additionalEnvVars?: Record<string, string>,
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
        ...additionalEnvVars, // Merge additional environment variables from Wave configuration
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
  additionalEnvVars?: Record<string, string>,
): Promise<HookExecutionResult[]> {
  const results: HookExecutionResult[] = [];

  for (const command of commands) {
    const result = await executeCommand(
      command,
      context,
      options,
      additionalEnvVars,
    );
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
// Environment Variable Functions
// =============================================================================

/**
 * Validate environment variable configuration
 */
export function validateEnvironmentConfig(
  env: unknown,
  configPath?: string,
): EnvironmentValidationResult {
  const result: EnvironmentValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  // Check if env is defined
  if (env === undefined || env === null) {
    return result; // undefined/null env is valid (means no env vars)
  }

  // Validate that env is a Record<string, string>
  if (!isValidEnvironmentVars(env)) {
    result.isValid = false;
    result.errors.push(
      `Invalid env field format${configPath ? ` in ${configPath}` : ""}. Environment variables must be a Record<string, string>.`,
    );
    return result;
  }

  // Additional validation for environment variable names
  const envVars = env as Record<string, string>;
  for (const [key, value] of Object.entries(envVars)) {
    // Check for valid environment variable naming convention
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      result.warnings.push(
        `Environment variable '${key}' does not follow standard naming convention (alphanumeric and underscores only).`,
      );
    }

    // Check for empty values
    if (value === "") {
      result.warnings.push(`Environment variable '${key}' has an empty value.`);
    }

    // Check for reserved variable names that might cause conflicts
    const reservedNames = [
      "PATH",
      "HOME",
      "USER",
      "PWD",
      "SHELL",
      "TERM",
      "NODE_ENV",
    ];
    if (reservedNames.includes(key.toUpperCase())) {
      result.warnings.push(
        `Environment variable '${key}' overrides a system variable, which may cause unexpected behavior.`,
      );
    }
  }

  return result;
}

/**
 * Merge environment configurations with project taking precedence over user
 */
export function mergeEnvironmentConfig(
  userEnv: Record<string, string> | undefined,
  projectEnv: Record<string, string> | undefined,
  options: EnvironmentMergeOptions = {},
): MergedEnvironmentContext {
  const userVars = userEnv || {};
  const projectVars = projectEnv || {};
  const mergedVars: Record<string, string> = {};
  const conflicts: MergedEnvironmentContext["conflicts"] = [];

  // Start with user environment variables
  Object.assign(mergedVars, userVars);

  // Override with project environment variables and track conflicts
  for (const [key, projectValue] of Object.entries(projectVars)) {
    const userValue = userVars[key];

    if (
      userValue !== undefined &&
      userValue !== projectValue &&
      options.includeConflictWarnings !== false
    ) {
      // Conflict detected - project value takes precedence
      conflicts.push({
        key,
        userValue,
        projectValue,
        resolvedValue: projectValue,
      });
    }

    mergedVars[key] = projectValue;
  }

  return {
    userVars,
    projectVars,
    mergedVars,
    conflicts,
  };
}

// =============================================================================
// Hook Settings Functions
// =============================================================================

/**
 * Get the user-specific hooks configuration file path
 */
export function getUserHooksConfigPath(): string {
  return join(homedir(), ".wave", "settings.json");
}

/**
 * Get the project-specific hooks configuration file path
 */
export function getProjectHooksConfigPath(workdir: string): string {
  return join(workdir, ".wave", "settings.json");
}

/**
 * Load Wave configuration from a JSON file with graceful fallback
 * This version is optimized for live reload scenarios where invalid config should not crash the system
 */
export function loadWaveConfigFromFileWithFallback(
  filePath: string,
  previousValidConfig?: WaveConfiguration | null,
): { config: WaveConfiguration | null; error?: string; usedFallback: boolean } {
  if (!existsSync(filePath)) {
    return { config: null, usedFallback: false };
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const config = JSON.parse(content) as WaveConfiguration;

    // Validate basic structure
    if (!config || typeof config !== "object") {
      const error = `Invalid configuration structure in ${filePath}`;
      return {
        config: previousValidConfig || null,
        error,
        usedFallback: !!previousValidConfig,
      };
    }

    // Validate environment variables if present
    if (config.env !== undefined) {
      const envValidation = validateEnvironmentConfig(config.env, filePath);

      if (!envValidation.isValid) {
        const error = `Environment variable validation failed in ${filePath}: ${envValidation.errors.join(", ")}`;
        return {
          config: previousValidConfig || null,
          error,
          usedFallback: !!previousValidConfig,
        };
      }

      // Log warnings if any
      if (envValidation.warnings.length > 0) {
        console.warn(
          `Environment variable warnings in ${filePath}:\n- ${envValidation.warnings.join("\n- ")}`,
        );
      }
    }

    // Return valid configuration
    return {
      config: {
        hooks: config.hooks || undefined,
        env: config.env || undefined,
      },
      usedFallback: false,
    };
  } catch (error) {
    let errorMessage: string;

    if (error instanceof SyntaxError) {
      errorMessage = `Invalid JSON syntax in ${filePath}: ${error.message}`;
    } else {
      errorMessage = `Error loading configuration from ${filePath}: ${(error as Error).message}`;
    }

    return {
      config: previousValidConfig || null,
      error: errorMessage,
      usedFallback: !!previousValidConfig,
    };
  }
}

/**
 * Load and merge Wave configuration with graceful fallback for live reload
 * Provides error recovery by falling back to previous valid configuration
 */
export function loadMergedWaveConfigWithFallback(
  workdir: string,
  previousValidConfig?: WaveConfiguration | null,
): {
  config: WaveConfiguration | null;
  errors: string[];
  usedFallback: boolean;
} {
  const errors: string[] = [];
  let usedFallback = false;

  // Load user config with fallback
  const userResult = loadWaveConfigFromFileWithFallback(
    getUserHooksConfigPath(),
    previousValidConfig,
  );
  if (userResult.error) {
    errors.push(`User config: ${userResult.error}`);
  }
  if (userResult.usedFallback) {
    usedFallback = true;
  }

  // Load project config with fallback
  const projectResult = loadWaveConfigFromFileWithFallback(
    getProjectHooksConfigPath(workdir),
    previousValidConfig,
  );
  if (projectResult.error) {
    errors.push(`Project config: ${projectResult.error}`);
  }
  if (projectResult.usedFallback) {
    usedFallback = true;
  }

  const userConfig = userResult.config;
  const projectConfig = projectResult.config;

  // If both configs failed and no fallback available
  if (!userConfig && !projectConfig && errors.length > 0) {
    return {
      config: previousValidConfig || null,
      errors,
      usedFallback: !!previousValidConfig,
    };
  }

  // No configuration found at all
  if (!userConfig && !projectConfig) {
    return { config: null, errors, usedFallback };
  }

  // Only one configuration found
  if (!userConfig) return { config: projectConfig, errors, usedFallback };
  if (!projectConfig) return { config: userConfig, errors, usedFallback };

  // Merge configurations (project overrides user)
  try {
    const mergedHooks: PartialHookConfiguration = {};

    // Merge environment variables using the new mergeEnvironmentConfig function
    const environmentContext = mergeEnvironmentConfig(
      userConfig.env,
      projectConfig.env,
      { includeConflictWarnings: true },
    );

    // Merge hooks (combine arrays, project configs come after user configs)
    const allEvents = new Set([
      ...Object.keys(userConfig.hooks || {}),
      ...Object.keys(projectConfig.hooks || {}),
    ]);

    for (const event of allEvents) {
      if (!isValidHookEvent(event)) continue;

      const userEventConfigs = userConfig.hooks?.[event] || [];
      const projectEventConfigs = projectConfig.hooks?.[event] || [];

      // Project configurations take precedence
      mergedHooks[event] = [...userEventConfigs, ...projectEventConfigs];
    }

    const mergedConfig = {
      hooks: Object.keys(mergedHooks).length > 0 ? mergedHooks : undefined,
      env:
        Object.keys(environmentContext.mergedVars).length > 0
          ? environmentContext.mergedVars
          : undefined,
    };

    return { config: mergedConfig, errors, usedFallback };
  } catch (error) {
    errors.push(`Merge error: ${(error as Error).message}`);
    return {
      config: previousValidConfig || null,
      errors,
      usedFallback: !!previousValidConfig,
    };
  }
}

/**
 * Load Wave configuration from a JSON file
 * Supports both hooks and environment variables with proper validation
 */
export function loadWaveConfigFromFile(
  filePath: string,
): WaveConfiguration | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const config = JSON.parse(content) as WaveConfiguration;

    // Validate basic structure
    if (!config || typeof config !== "object") {
      throw new Error(`Invalid configuration structure in ${filePath}`);
    }

    // Validate environment variables if present
    if (config.env !== undefined) {
      const envValidation = validateEnvironmentConfig(config.env, filePath);

      if (!envValidation.isValid) {
        throw new Error(
          `Environment variable validation failed in ${filePath}: ${envValidation.errors.join(", ")}`,
        );
      }

      // Log warnings if any
      if (envValidation.warnings.length > 0) {
        console.warn(
          `Environment variable warnings in ${filePath}:\n- ${envValidation.warnings.join("\n- ")}`,
        );
      }
    }

    return {
      hooks: config.hooks || undefined,
      env: config.env || undefined,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON syntax in ${filePath}: ${error.message}`);
    }

    // Re-throw validation errors and other errors as-is
    throw error;
  }
}

/**
 * Load hooks configuration from a JSON file (legacy function)
 */
export function loadHooksConfigFromFile(
  filePath: string,
): PartialHookConfiguration | null {
  const waveConfig = loadWaveConfigFromFile(filePath);
  if (!waveConfig) {
    return null;
  }

  return waveConfig.hooks || null;
}

/**
 * Load user-specific Wave configuration
 */
export function loadUserWaveConfig(): WaveConfiguration | null {
  return loadWaveConfigFromFile(getUserHooksConfigPath());
}

/**
 * Load project-specific Wave configuration
 */
export function loadProjectWaveConfig(
  workdir: string,
): WaveConfiguration | null {
  return loadWaveConfigFromFile(getProjectHooksConfigPath(workdir));
}

/**
 * Load user-specific hooks configuration (legacy function)
 */
export function loadUserHooksConfig(): PartialHookConfiguration | null {
  const waveConfig = loadUserWaveConfig();
  return waveConfig?.hooks || null;
}

/**
 * Load project-specific hooks configuration (legacy function)
 */
export function loadProjectHooksConfig(
  workdir: string,
): PartialHookConfiguration | null {
  const waveConfig = loadProjectWaveConfig(workdir);
  return waveConfig?.hooks || null;
}

/**
 * Load and merge Wave configuration from both user and project sources
 * Project configuration takes precedence over user configuration
 */
export function loadMergedWaveConfig(
  workdir: string,
): WaveConfiguration | null {
  const userConfig = loadUserWaveConfig();
  const projectConfig = loadProjectWaveConfig(workdir);

  // No configuration found
  if (!userConfig && !projectConfig) {
    return null;
  }

  // Only one configuration found
  if (!userConfig) return projectConfig;
  if (!projectConfig) return userConfig;

  // Merge configurations (project overrides user)
  const mergedHooks: PartialHookConfiguration = {};

  // Merge environment variables using the new mergeEnvironmentConfig function
  const environmentContext = mergeEnvironmentConfig(
    userConfig.env,
    projectConfig.env,
    { includeConflictWarnings: true },
  );

  // Log environment variable conflicts if any
  if (environmentContext.conflicts.length > 0) {
    console.warn(
      `Environment variable conflicts detected (project values take precedence):\n${environmentContext.conflicts
        .map(
          (conflict) =>
            `- ${conflict.key}: "${conflict.userValue}" → "${conflict.projectValue}"`,
        )
        .join("\n")}`,
    );
  }

  // Merge hooks (combine arrays, project configs come after user configs)
  const allEvents = new Set([
    ...Object.keys(userConfig.hooks || {}),
    ...Object.keys(projectConfig.hooks || {}),
  ]);

  for (const event of allEvents) {
    if (!isValidHookEvent(event)) continue;

    const userEventConfigs = userConfig.hooks?.[event] || [];
    const projectEventConfigs = projectConfig.hooks?.[event] || [];

    // Project configurations take precedence
    mergedHooks[event] = [...userEventConfigs, ...projectEventConfigs];
  }

  return {
    hooks: Object.keys(mergedHooks).length > 0 ? mergedHooks : undefined,
    env:
      Object.keys(environmentContext.mergedVars).length > 0
        ? environmentContext.mergedVars
        : undefined,
  };
}

/**
 * Load and merge hooks configuration from both user and project sources (legacy function)
 */
export function loadMergedHooksConfig(
  workdir: string,
): PartialHookConfiguration | null {
  const waveConfig = loadMergedWaveConfig(workdir);
  return waveConfig?.hooks || null;
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
