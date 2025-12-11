/**
 * Configuration Service
 *
 * Centralized service for loading, validating, and managing Wave configuration files.
 * Replaces distributed configuration logic previously embedded in hook.ts.
 */

import { readFileSync, existsSync } from "fs";
import type {
  WaveConfiguration,
  PartialHookConfiguration,
} from "../types/hooks.js";
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

/**
 * Default ConfigurationService implementation
 *
 * Provides centralized configuration loading, validation, and management.
 * Extracted from distributed logic in hook.ts with improved error handling.
 */
export class ConfigurationService {
  private currentConfiguration: WaveConfiguration | null = null;

  // Core loading operations

  /**
   * Load and merge configuration from user and project settings
   */
  async loadConfiguration(workdir: string): Promise<ConfigurationLoadResult> {
    try {
      // Use the extracted function to get the merged configuration
      const mergedConfig = loadMergedWaveConfig(workdir);

      if (!mergedConfig) {
        return {
          configuration: null,
          success: true,
          warnings: [],
          error: undefined,
        };
      }

      // Validate the merged configuration
      const validation = this.validateConfiguration(mergedConfig);

      if (!validation.isValid) {
        return {
          configuration: null,
          success: false,
          error: `Configuration validation failed: ${validation.errors.join(", ")}`,
          warnings: validation.warnings,
        };
      }

      this.currentConfiguration = mergedConfig;
      return {
        configuration: mergedConfig,
        success: true,
        sourcePath: "merged configuration",
        warnings: validation.warnings,
      };
    } catch (error) {
      return {
        configuration: null,
        success: false,
        error: `Configuration loading failed: ${(error as Error).message}`,
        warnings: [],
      };
    }
  }

  /**
   * Load configuration from single file
   */
  async loadConfigurationFromFile(
    filePath: string,
  ): Promise<ConfigurationLoadResult> {
    try {
      const config = loadWaveConfigFromFile(filePath);

      if (!config) {
        return {
          configuration: null,
          success: false,
          error: `Configuration file not found: ${filePath}`,
          warnings: [],
        };
      }

      // Validate configuration
      const validation = this.validateConfiguration(config);
      if (!validation.isValid) {
        return {
          configuration: null,
          success: false,
          error: `Configuration validation failed in ${filePath}: ${validation.errors.join(", ")}`,
          warnings: validation.warnings,
        };
      }

      this.currentConfiguration = config;
      return {
        configuration: config,
        success: true,
        sourcePath: filePath,
        warnings: validation.warnings,
      };
    } catch (error) {
      let errorMessage: string;
      if (error instanceof SyntaxError) {
        errorMessage = `Invalid JSON syntax in ${filePath}: ${error.message}`;
      } else {
        errorMessage = `Error loading configuration from ${filePath}: ${(error as Error).message}`;
      }

      return {
        configuration: null,
        success: false,
        error: errorMessage,
        warnings: [],
      };
    }
  }

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
      if (typeof config.defaultMode !== "string") {
        result.isValid = false;
        result.errors.push("defaultMode must be a string");
      } else if (config.defaultMode.length === 0) {
        result.warnings.push("defaultMode is empty");
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

  // Private helper methods

  /**
   * Load configuration from multiple file paths in priority order
   */
  private async loadConfigurationFromFiles(
    filePaths: string[],
  ): Promise<ConfigurationLoadResult> {
    const config = loadWaveConfigFromFiles(filePaths);

    if (!config) {
      // No valid configuration found
      return {
        configuration: null,
        success: true, // This is not an error - just no config files found
        warnings: [],
      };
    }

    // Find which file was actually used
    let sourcePath: string | undefined;
    for (const filePath of filePaths) {
      if (existsSync(filePath)) {
        sourcePath = filePath;
        break;
      }
    }

    // Validate the configuration
    const validation = this.validateConfiguration(config);
    if (!validation.isValid) {
      return {
        configuration: null,
        success: false,
        error: `Configuration validation failed: ${validation.errors.join(", ")}`,
        warnings: validation.warnings,
      };
    }

    return {
      configuration: config,
      success: true,
      sourcePath,
      warnings: validation.warnings,
    };
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
    // Project defaultMode takes precedence over user defaultMode
    defaultMode: projectConfig.defaultMode ?? userConfig.defaultMode,
  };
}
