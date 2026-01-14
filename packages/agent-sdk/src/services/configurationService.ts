/**
 * Configuration Service
 *
 * Centralized service for loading, validating, and managing Wave configuration files.
 * Replaces distributed configuration logic previously embedded in hook.ts.
 */

import { readFileSync, existsSync, promises as fs } from "fs";
import * as path from "path";
import type { WaveConfiguration } from "../types/hooks.js";
import { isValidHookEvent } from "../types/hooks.js";
import type {
  ConfigurationLoadResult,
  ValidationResult,
  ConfigurationPaths,
} from "../types/configuration.js";
import {
  getAllConfigPaths,
  getExistingConfigPaths,
  getUserConfigPaths,
  getProjectConfigPaths,
} from "../utils/configPaths.js";
import {
  type EnvironmentValidationResult,
  type MergedEnvironmentContext,
  type EnvironmentMergeOptions,
  isValidEnvironmentVars,
} from "../types/environment.js";
import {
  GatewayConfig,
  ModelConfig,
  ConfigurationError,
  CONFIG_ERRORS,
} from "../types/index.js";
import {
  DEFAULT_WAVE_MAX_INPUT_TOKENS,
  DEFAULT_WAVE_MAX_OUTPUT_TOKENS,
} from "../utils/constants.js";
import { ClientOptions } from "openai";
import { parseCustomHeaders } from "../utils/stringUtils.js";

/**
 * Default ConfigurationService implementation
 *
 * Provides centralized configuration loading, validation, and management.
 * Extracted from distributed logic in hook.ts with improved error handling.
 */
export class ConfigurationService {
  private currentConfiguration: WaveConfiguration | null = null;
  private env: Record<string, string> = {};

  // Core loading operations

  /**
   * Load and merge configuration with comprehensive validation
   */
  async loadMergedConfiguration(
    workdir: string,
  ): Promise<ConfigurationLoadResult> {
    try {
      const userConfigPaths = getUserConfigPaths();
      const projectConfigPaths = getProjectConfigPaths(workdir);

      // Use the merged configuration function (this loads user and project configs internally)
      const mergedConfig = loadMergedWaveConfig(workdir);

      // Track loading context for better error messages by checking which files exist
      const loadingContext: string[] = [];
      const userPath = userConfigPaths.find((path) => existsSync(path));
      if (userPath) {
        loadingContext.push(`user config from ${userPath}`);
      }

      const projectPath = projectConfigPaths.find((path) => existsSync(path));
      if (projectPath) {
        loadingContext.push(`project config from ${projectPath}`);
      }

      if (!mergedConfig) {
        const message =
          loadingContext.length > 0
            ? `No valid configuration found despite attempting to load: ${loadingContext.join(", ")}`
            : "No configuration files found in user or project directories";

        return {
          configuration: null,
          success: true, // No config is valid
          warnings: [message],
        };
      }

      // Comprehensive validation
      const validation = this.validateConfiguration(mergedConfig);

      if (!validation.isValid) {
        const sourcePaths = loadingContext.join(" and ");
        return {
          configuration: null,
          success: false,
          error: `Merged configuration validation failed (sources: ${sourcePaths}): ${validation.errors.join(", ")}`,
          warnings: validation.warnings,
        };
      }

      // Success case
      this.currentConfiguration = mergedConfig;

      // Set environment variables if present in the merged config
      if (mergedConfig.env) {
        this.setEnvironmentVars(mergedConfig.env);
      }

      const sourcePaths = loadingContext.join(" and ");

      return {
        configuration: mergedConfig,
        success: true,
        sourcePath: sourcePaths || "merged configuration",
        warnings: validation.warnings,
      };
    } catch (error) {
      return {
        configuration: null,
        success: false,
        error: `Failed to load merged configuration from ${workdir}: ${(error as Error).message}`,
        warnings: [],
      };
    }
  }

  // Validation operations

  /**
   * Validate configuration object structure and values
   */
  validateConfiguration(config: WaveConfiguration): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    // Validate basic structure
    if (!config || typeof config !== "object") {
      result.isValid = false;
      result.errors.push("Configuration must be a valid object");
      return result;
    }

    // Validate hooks if present
    if (config.hooks !== undefined) {
      if (typeof config.hooks !== "object" || config.hooks === null) {
        result.isValid = false;
        result.errors.push("Hooks configuration must be an object");
      } else {
        for (const [event, eventConfigs] of Object.entries(config.hooks)) {
          if (!isValidHookEvent(event)) {
            result.warnings.push(`Unknown hook event: ${event}`);
            continue;
          }

          if (!Array.isArray(eventConfigs)) {
            result.isValid = false;
            result.errors.push(`Hook event '${event}' must be an array`);
            continue;
          }

          // Validate individual hook configurations
          for (let i = 0; i < eventConfigs.length; i++) {
            const hookConfig = eventConfigs[i];
            if (!hookConfig || typeof hookConfig !== "object") {
              result.isValid = false;
              result.errors.push(
                `Hook configuration ${i} for event '${event}' must be an object`,
              );
            }
          }
        }
      }
    }

    // Validate enabledPlugins if present
    if (config.enabledPlugins !== undefined) {
      if (
        typeof config.enabledPlugins !== "object" ||
        config.enabledPlugins === null
      ) {
        result.isValid = false;
        result.errors.push("enabledPlugins configuration must be an object");
      } else {
        for (const [pluginId, enabled] of Object.entries(
          config.enabledPlugins,
        )) {
          if (typeof enabled !== "boolean") {
            result.isValid = false;
            result.errors.push(
              `Value for plugin '${pluginId}' in enabledPlugins must be a boolean`,
            );
          }
          if (!pluginId.includes("@")) {
            result.warnings.push(
              `Plugin ID '${pluginId}' in enabledPlugins should follow 'name@marketplace' format`,
            );
          }
        }
      }
    }

    // Validate environment variables if present
    if (config.env !== undefined) {
      const envValidation = validateEnvironmentConfig(config.env);
      if (!envValidation.isValid) {
        result.isValid = false;
        result.errors.push(...envValidation.errors);
      }
      result.warnings.push(...envValidation.warnings);
    }

    // Validate defaultMode if present
    if (config.defaultMode !== undefined) {
      if (
        config.defaultMode !== "default" &&
        config.defaultMode !== "bypassPermissions" &&
        config.defaultMode !== "acceptEdits"
      ) {
        result.isValid = false;
        result.errors.push(
          `Invalid defaultMode: "${config.defaultMode}". Must be "default", "bypassPermissions" or "acceptEdits"`,
        );
      }
    }

    // Validate permissions if present
    if (config.permissions !== undefined) {
      if (
        typeof config.permissions !== "object" ||
        config.permissions === null
      ) {
        result.isValid = false;
        result.errors.push("Permissions configuration must be an object");
      } else if (config.permissions.allow !== undefined) {
        if (!Array.isArray(config.permissions.allow)) {
          result.isValid = false;
          result.errors.push("Permissions allow must be an array of strings");
        } else if (
          !config.permissions.allow.every((rule) => typeof rule === "string")
        ) {
          result.isValid = false;
          result.errors.push("All permission rules must be strings");
        }
      }
    }

    return result;
  }

  /**
   * Validate configuration file without loading
   */
  validateConfigurationFile(filePath: string): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    if (!existsSync(filePath)) {
      result.isValid = false;
      result.errors.push(`Configuration file not found: ${filePath}`);
      return result;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const config = JSON.parse(content) as WaveConfiguration;

      // Use the main validation method
      const configValidation = this.validateConfiguration(config);
      result.isValid = configValidation.isValid;
      result.errors = configValidation.errors;
      result.warnings = configValidation.warnings;
    } catch (error) {
      result.isValid = false;
      if (error instanceof SyntaxError) {
        result.errors.push(
          `Invalid JSON syntax in ${filePath}: ${error.message}`,
        );
      } else {
        result.errors.push(
          `Error reading configuration file ${filePath}: ${(error as Error).message}`,
        );
      }
    }

    return result;
  }

  // Utility operations

  /**
   * Get currently loaded configuration
   */
  getCurrentConfiguration(): WaveConfiguration | null {
    return this.currentConfiguration;
  }

  /**
   * Set environment variables from configuration
   * This replaces direct process.env modification
   */
  setEnvironmentVars(env: Record<string, string>): void {
    this.env = { ...env };
  }

  /**
   * Get current environment variables
   */
  getEnvironmentVars(): Record<string, string> {
    return { ...this.env };
  }

  // =============================================================================
  // Configuration Resolution Methods (merged from configResolver.ts)
  // =============================================================================

  /**
   * Resolves gateway configuration from constructor args and environment
   * Resolution priority: options > env (from settings.json) > process.env > error
   * @param apiKey - API key from constructor (optional)
   * @param baseURL - Base URL from constructor (optional)
   * @param defaultHeaders - HTTP headers from constructor (optional)
   * @param fetchOptions - Fetch options from constructor (optional)
   * @param fetch - Custom fetch implementation from constructor (optional)
   * @returns Resolved gateway configuration
   * @throws ConfigurationError if required configuration is missing after fallbacks
   */
  resolveGatewayConfig(
    apiKey?: string,
    baseURL?: string,
    defaultHeaders?: Record<string, string>,
    fetchOptions?: ClientOptions["fetchOptions"],
    fetch?: ClientOptions["fetch"],
  ): GatewayConfig {
    // Resolve API key: constructor > env (settings.json) > process.env
    // Note: Explicitly provided empty strings should be treated as invalid, not fall back to env
    let resolvedApiKey: string | undefined;
    if (apiKey !== undefined) {
      resolvedApiKey = apiKey;
    } else {
      resolvedApiKey = this.env.WAVE_API_KEY || process.env.WAVE_API_KEY;
    }

    // Resolve base URL: constructor > env (settings.json) > process.env
    // Note: Explicitly provided empty strings should be treated as invalid, not fall back to env
    let resolvedBaseURL: string;
    if (baseURL !== undefined) {
      resolvedBaseURL = baseURL;
    } else {
      resolvedBaseURL =
        this.env.WAVE_BASE_URL || process.env.WAVE_BASE_URL || "";
    }

    if (!resolvedBaseURL && baseURL === undefined) {
      throw new ConfigurationError(CONFIG_ERRORS.MISSING_BASE_URL, "baseURL", {
        constructor: baseURL,
        environment: process.env.WAVE_BASE_URL,
        settings: this.env.WAVE_BASE_URL,
      });
    }

    if (resolvedBaseURL.trim() === "") {
      throw new ConfigurationError(
        CONFIG_ERRORS.EMPTY_BASE_URL,
        "baseURL",
        resolvedBaseURL,
      );
    }

    // Resolve custom headers from environment: env (settings.json) > process.env
    const envCustomHeaders =
      this.env.WAVE_CUSTOM_HEADERS || process.env.WAVE_CUSTOM_HEADERS || "";
    const parsedEnvHeaders = parseCustomHeaders(envCustomHeaders);

    // Merge headers: env headers < constructor defaultHeaders
    const resolvedHeaders = {
      ...parsedEnvHeaders,
      ...defaultHeaders,
    };

    return {
      apiKey: resolvedApiKey,
      baseURL: resolvedBaseURL,
      defaultHeaders:
        Object.keys(resolvedHeaders).length > 0 ? resolvedHeaders : undefined,
      fetchOptions,
      fetch,
    };
  }

  /**
   * Resolves model configuration with fallbacks
   * Resolution priority: options > env (from settings.json) > process.env > default
   * @param agentModel - Agent model from constructor (optional)
   * @param fastModel - Fast model from constructor (optional)
   * @param maxTokens - Max output tokens from constructor (optional)
   * @returns Resolved model configuration with defaults
   */
  resolveModelConfig(
    agentModel?: string,
    fastModel?: string,
    maxTokens?: number,
  ): ModelConfig {
    // Default values as per data-model.md
    const DEFAULT_AGENT_MODEL = "gemini-3-flash";
    const DEFAULT_FAST_MODEL = "gemini-2.5-flash";

    // Resolve agent model: constructor > env (settings.json) > process.env > default
    const resolvedAgentModel =
      agentModel ||
      this.env.WAVE_MODEL ||
      process.env.WAVE_MODEL ||
      DEFAULT_AGENT_MODEL;

    // Resolve fast model: constructor > env (settings.json) > process.env > default
    const resolvedFastModel =
      fastModel ||
      this.env.WAVE_FAST_MODEL ||
      process.env.WAVE_FAST_MODEL ||
      DEFAULT_FAST_MODEL;

    // Resolve max output tokens
    const resolvedMaxTokens = this.resolveMaxOutputTokens(maxTokens);

    return {
      agentModel: resolvedAgentModel,
      fastModel: resolvedFastModel,
      maxTokens: resolvedMaxTokens,
    };
  }

  /**
   * Resolves token limit with fallbacks
   * Resolution priority: options > env (from settings.json) > process.env > default
   * @param constructorLimit - Token limit from constructor (optional)
   * @returns Resolved token limit
   */
  resolveMaxInputTokens(constructorLimit?: number): number {
    // If constructor value provided, use it
    if (constructorLimit !== undefined) {
      return constructorLimit;
    }

    // Try env (settings.json) first, then process.env
    const envMaxInputTokens =
      this.env.WAVE_MAX_INPUT_TOKENS || process.env.WAVE_MAX_INPUT_TOKENS;
    if (envMaxInputTokens) {
      const parsed = parseInt(envMaxInputTokens, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }

    // Use default
    return DEFAULT_WAVE_MAX_INPUT_TOKENS;
  }

  /**
   * Resolves max output tokens with fallbacks
   * Resolution priority: options > env (from settings.json) > process.env > default
   * @param constructorLimit - Max output tokens from constructor (optional)
   * @returns Resolved max output tokens
   */
  resolveMaxOutputTokens(constructorLimit?: number): number {
    // If constructor value provided, use it
    if (constructorLimit !== undefined) {
      return constructorLimit;
    }

    // Try env (settings.json) first, then process.env
    const envMaxOutputTokens =
      this.env.WAVE_MAX_OUTPUT_TOKENS || process.env.WAVE_MAX_OUTPUT_TOKENS;
    if (envMaxOutputTokens) {
      const parsed = parseInt(envMaxOutputTokens, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    // Use default
    return DEFAULT_WAVE_MAX_OUTPUT_TOKENS;
  }

  /**
   * Resolve all configuration file paths
   */
  getConfigurationPaths(workdir: string): ConfigurationPaths {
    const allPaths = getAllConfigPaths(workdir);
    const existingPaths = getExistingConfigPaths(workdir);

    return {
      userPaths: allPaths.userPaths,
      projectPaths: allPaths.projectPaths,
      allPaths: allPaths.allPaths,
      existingPaths: existingPaths.existingPaths,
    };
  }

  /**
   * Add a permission rule to the project's settings.local.json
   */
  async addAllowedRule(workdir: string, rule: string): Promise<void> {
    const localConfigPath = path.join(workdir, ".wave", "settings.local.json");

    // Ensure .wave directory exists
    const waveDir = path.join(workdir, ".wave");
    if (!existsSync(waveDir)) {
      await fs.mkdir(waveDir, { recursive: true });
    }

    let config: WaveConfiguration = {};
    if (existsSync(localConfigPath)) {
      try {
        const content = await fs.readFile(localConfigPath, "utf-8");
        config = JSON.parse(content);
      } catch {
        // If file is corrupted, start with empty config
      }
    }

    if (!config.permissions) {
      config.permissions = {};
    }
    if (!config.permissions.allow) {
      config.permissions.allow = [];
    }

    if (!config.permissions.allow.includes(rule)) {
      config.permissions.allow.push(rule);
      await fs.writeFile(
        localConfigPath,
        JSON.stringify(config, null, 2),
        "utf-8",
      );
    }
  }

  /**
   * Update the enabled state of a plugin in the specified scope
   */
  async updateEnabledPlugin(
    workdir: string,
    scope: "user" | "project" | "local",
    pluginId: string,
    enabled: boolean,
  ): Promise<void> {
    if (scope !== "user" && !existsSync(workdir)) {
      throw new Error(`Working directory does not exist: ${workdir}`);
    }

    let configPath: string;
    if (scope === "user") {
      configPath = getUserConfigPaths()[1]; // settings.json
    } else if (scope === "project") {
      configPath = getProjectConfigPaths(workdir)[1]; // settings.json
    } else {
      configPath = getProjectConfigPaths(workdir)[0]; // settings.local.json
    }

    // Ensure directory exists
    const configDir = path.dirname(configPath);
    if (!existsSync(configDir)) {
      await fs.mkdir(configDir, { recursive: true });
    }

    let config: WaveConfiguration = {};
    if (existsSync(configPath)) {
      try {
        const content = await fs.readFile(configPath, "utf-8");
        config = JSON.parse(content);
      } catch {
        // Start with empty config if file is corrupted
      }
    }

    if (!config.enabledPlugins) {
      config.enabledPlugins = {};
    }

    config.enabledPlugins[pluginId] = enabled;

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  /**
   * Get merged enabled plugins from all scopes
   */
  getMergedEnabledPlugins(workdir: string): Record<string, boolean> {
    const mergedConfig = loadMergedWaveConfig(workdir);
    return mergedConfig?.enabledPlugins || {};
  }
}
// =============================================================================
// Extracted Configuration Functions
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
      defaultMode: config.defaultMode,
      permissions: config.permissions || undefined,
      enabledPlugins: config.enabledPlugins || undefined,
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
 * Load Wave configuration from multiple file paths in priority order
 * Returns the first valid configuration found, or null if none exist
 */
export function loadWaveConfigFromFiles(
  filePaths: string[],
): WaveConfiguration | null {
  for (const filePath of filePaths) {
    const config = loadWaveConfigFromFile(filePath);
    if (config !== null) {
      return config;
    }
  }
  return null;
}

/**
 * Load user-specific Wave configuration
 * Checks .local.json first, then falls back to .json
 */
export function loadUserWaveConfig(): WaveConfiguration | null {
  return loadWaveConfigFromFiles(getUserConfigPaths());
}

/**
 * Load project-specific Wave configuration
 * Checks .local.json first, then falls back to .json
 */
export function loadProjectWaveConfig(
  workdir: string,
): WaveConfiguration | null {
  return loadWaveConfigFromFiles(getProjectConfigPaths(workdir));
}

/**
 * Load and merge Wave configuration from both user and project sources
 * Project configuration takes precedence over user configuration
 * Checks .local.json files first, then falls back to .json files
 */
export function loadMergedWaveConfig(
  workdir: string,
): WaveConfiguration | null {
  const userPaths = getUserConfigPaths(); // [local, json]
  const projectPaths = getProjectConfigPaths(workdir); // [local, json]

  // Priority order (lowest to highest):
  // user settings.json -> user settings.local.json -> project settings.json -> project settings.local.json
  const pathsToLoad = [
    userPaths[1], // user settings.json
    userPaths[0], // user settings.local.json
    projectPaths[1], // project settings.json
    projectPaths[0], // project settings.local.json
  ];

  const configs: WaveConfiguration[] = [];
  for (const path of pathsToLoad) {
    const config = loadWaveConfigFromFile(path);
    if (config) {
      configs.push(config);
    }
  }

  if (configs.length === 0) {
    return null;
  }

  // Merge all configurations in order
  const mergedConfig: WaveConfiguration = {};

  for (const config of configs) {
    // Merge hooks
    if (config.hooks) {
      if (!mergedConfig.hooks) mergedConfig.hooks = {};
      for (const [event, eventConfigs] of Object.entries(config.hooks)) {
        if (!isValidHookEvent(event)) continue;
        if (!mergedConfig.hooks[event]) mergedConfig.hooks[event] = [];
        mergedConfig.hooks[event]!.push(...eventConfigs);
      }
    }

    // Merge env
    if (config.env) {
      const environmentContext = mergeEnvironmentConfig(
        mergedConfig.env,
        config.env,
        { includeConflictWarnings: true },
      );
      mergedConfig.env = environmentContext.mergedVars;
    }

    // Merge defaultMode (last one wins)
    if (config.defaultMode !== undefined) {
      mergedConfig.defaultMode = config.defaultMode;
    }

    // Merge permissions
    if (config.permissions?.allow) {
      if (!mergedConfig.permissions) mergedConfig.permissions = {};
      if (!mergedConfig.permissions.allow) mergedConfig.permissions.allow = [];
      mergedConfig.permissions.allow = [
        ...new Set([
          ...mergedConfig.permissions.allow,
          ...config.permissions.allow,
        ]),
      ];
    }

    // Merge enabledPlugins
    if (config.enabledPlugins) {
      if (!mergedConfig.enabledPlugins) mergedConfig.enabledPlugins = {};
      Object.assign(mergedConfig.enabledPlugins, config.enabledPlugins);
    }
  }

  return {
    hooks:
      mergedConfig.hooks && Object.keys(mergedConfig.hooks).length > 0
        ? mergedConfig.hooks
        : undefined,
    env:
      mergedConfig.env && Object.keys(mergedConfig.env).length > 0
        ? mergedConfig.env
        : undefined,
    defaultMode: mergedConfig.defaultMode,
    permissions:
      mergedConfig.permissions &&
      Object.keys(mergedConfig.permissions).length > 0
        ? mergedConfig.permissions
        : undefined,
    enabledPlugins:
      mergedConfig.enabledPlugins &&
      Object.keys(mergedConfig.enabledPlugins).length > 0
        ? mergedConfig.enabledPlugins
        : undefined,
  };
}
