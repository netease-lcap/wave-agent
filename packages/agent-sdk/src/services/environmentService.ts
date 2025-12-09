/**
 * Environment Service
 *
 * Specialized service for handling environment variable management from Wave configuration.
 * Handles validation, merging, conflict resolution, and application to process.env.
 */

import type {
  EnvironmentProcessResult,
  EnvironmentMergeContext,
  EnvironmentConflict,
  EnvironmentValidationResult,
  EnvironmentServiceOptions,
} from "../types/environment.js";
import { isValidEnvironmentVars } from "../types/environment.js";

/**
 * Default EnvironmentService implementation
 *
 * Handles environment variable management from Wave configuration with comprehensive
 * validation, conflict tracking, and process.env application.
 */
export class EnvironmentService {
  private managedVars: Record<string, string> = {};
  private currentConflicts: EnvironmentConflict[] = [];
  private logger?: EnvironmentServiceOptions["logger"];

  constructor(options: EnvironmentServiceOptions = {}) {
    this.logger = options.logger;
  }

  /**
   * Validate environment configuration structure and values
   * Adapted from validateEnvironmentConfig in hook.ts
   */
  validateEnvironmentConfig(
    env: unknown,
    source?: string,
  ): EnvironmentValidationResult {
    const result: EnvironmentValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    this.logger?.debug(
      `Environment: Validating environment configuration${source ? ` from ${source}` : ""}`,
    );

    // Check if env is defined
    if (env === undefined || env === null) {
      this.logger?.debug(
        "Environment: No environment variables defined (valid)",
      );
      return result; // undefined/null env is valid (means no env vars)
    }

    // Validate that env is a Record<string, string>
    if (!isValidEnvironmentVars(env)) {
      result.isValid = false;
      const error = `Invalid env field format${source ? ` in ${source}` : ""}. Environment variables must be a Record<string, string>.`;
      result.errors.push(error);
      this.logger?.error(`Environment: ${error}`);
      return result;
    }

    // Additional validation for environment variable names
    const envVars = env as Record<string, string>;
    const varCount = Object.keys(envVars).length;
    this.logger?.debug(
      `Environment: Validating ${varCount} environment variables`,
    );

    for (const [key, value] of Object.entries(envVars)) {
      // Check for valid environment variable naming convention
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        const warning = `Environment variable '${key}' does not follow standard naming convention (alphanumeric and underscores only).`;
        result.warnings.push(warning);
        this.logger?.warn(`Environment: ${warning}`);
      }

      // Check for empty values
      if (value === "") {
        const warning = `Environment variable '${key}' has an empty value.`;
        result.warnings.push(warning);
        this.logger?.warn(`Environment: ${warning}`);
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
        const warning = `Environment variable '${key}' overrides a system variable, which may cause unexpected behavior.`;
        result.warnings.push(warning);
        this.logger?.warn(`Environment: ${warning}`);
      }
    }

    if (result.isValid) {
      this.logger?.info(
        `Environment: Validation successful for ${varCount} environment variables`,
      );
    } else {
      this.logger?.error(
        `Environment: Validation failed with ${result.errors.length} errors`,
      );
    }

    return result;
  }

  /**
   * Merge user and project environment configurations
   * Adapted from mergeEnvironmentConfig in hook.ts
   */
  mergeEnvironmentConfigs(
    userEnv?: Record<string, string>,
    projectEnv?: Record<string, string>,
  ): EnvironmentMergeContext {
    const userVars = userEnv || {};
    const projectVars = projectEnv || {};
    const mergedVars: Record<string, string> = {};
    const conflicts: EnvironmentConflict[] = [];

    const userCount = Object.keys(userVars).length;
    const projectCount = Object.keys(projectVars).length;

    this.logger?.debug(
      `Environment: Merging ${userCount} user variables with ${projectCount} project variables`,
    );

    // Start with user environment variables
    Object.assign(mergedVars, userVars);
    if (userCount > 0) {
      this.logger?.debug(
        `Environment: Added ${userCount} user environment variables`,
      );
    }

    // Override with project environment variables and track conflicts
    for (const [key, projectValue] of Object.entries(projectVars)) {
      const userValue = userVars[key];

      if (userValue !== undefined && userValue !== projectValue) {
        // Conflict detected - project value takes precedence
        conflicts.push({
          key,
          userValue,
          projectValue,
          resolvedValue: projectValue,
          source: "project",
        });
        this.logger?.info(
          `Environment: Conflict resolved for '${key}': user="${userValue}" -> project="${projectValue}"`,
        );
      }

      mergedVars[key] = projectValue;
    }

    const mergedCount = Object.keys(mergedVars).length;
    this.logger?.info(
      `Environment: Merge completed - ${mergedCount} total variables, ${conflicts.length} conflicts resolved`,
    );

    // Store conflicts for later retrieval
    this.currentConflicts = conflicts;

    return {
      userVars,
      projectVars,
      mergedVars,
      conflicts,
    };
  }

  /**
   * Process environment configuration from Wave settings
   */
  processEnvironmentConfig(
    env: Record<string, string> | undefined,
  ): EnvironmentProcessResult {
    const result: EnvironmentProcessResult = {
      processedVars: {},
      conflicts: [],
      warnings: [],
      applied: false,
    };

    this.logger?.debug(
      "Environment: Processing environment configuration from Wave settings",
    );

    // Handle undefined/null env
    if (!env) {
      this.logger?.debug("Environment: No environment configuration provided");
      result.applied = true; // Nothing to apply is considered successful
      return result;
    }

    const varCount = Object.keys(env).length;
    this.logger?.info(
      `Environment: Processing ${varCount} environment variables`,
    );

    // Validate the environment configuration
    const validation = this.validateEnvironmentConfig(env, "configuration");
    if (!validation.isValid) {
      this.logger?.error(
        `Environment: Validation failed with ${validation.errors.length} errors`,
      );
      validation.errors.forEach((error) =>
        this.logger?.error(`Environment: ${error}`),
      );
      return result; // Return with applied: false
    }

    // Add validation warnings to result
    result.warnings.push(...validation.warnings);

    // Check for conflicts with existing process.env
    const processConflicts: EnvironmentConflict[] = [];
    for (const [key, value] of Object.entries(env)) {
      const existingValue = process.env[key];
      if (existingValue !== undefined && existingValue !== value) {
        processConflicts.push({
          key,
          userValue: existingValue,
          projectValue: value,
          resolvedValue: value, // We always override
          source: "project",
        });
        this.logger?.info(
          `Environment: Will override process.env.${key}: "${existingValue}" -> "${value}"`,
        );
      } else if (existingValue === undefined) {
        this.logger?.debug(
          `Environment: Will set new process.env.${key}="${value}"`,
        );
      } else {
        this.logger?.debug(
          `Environment: process.env.${key} unchanged (same value)`,
        );
      }
    }

    if (processConflicts.length > 0) {
      this.logger?.warn(
        `Environment: ${processConflicts.length} environment variable conflicts detected`,
      );
    }

    result.conflicts = processConflicts;
    result.processedVars = { ...env };

    // Apply environment variables to process.env
    try {
      this.logger?.info(
        "Environment: Applying environment variables to process.env",
      );
      this.applyEnvironmentVariables(env);
      result.applied = true;
      this.logger?.info(
        `Environment: Successfully applied ${varCount} environment variables`,
      );
    } catch (error) {
      this.logger?.error(
        `Environment: Failed to apply environment variables: ${(error as Error).message}`,
      );
      result.applied = false;
    }

    return result;
  }

  /**
   * Apply environment variables to process.env
   */
  applyEnvironmentVariables(env: Record<string, string>): void {
    const varCount = Object.keys(env).length;
    this.logger?.debug(
      `Environment: Applying ${varCount} environment variables to process.env`,
    );

    let appliedCount = 0;
    const failedVars: string[] = [];

    for (const [key, value] of Object.entries(env)) {
      try {
        const previousValue = process.env[key];
        process.env[key] = value;
        this.managedVars[key] = value;
        appliedCount++;

        if (previousValue !== undefined && previousValue !== value) {
          this.logger?.debug(
            `Environment: Updated process.env.${key} from "${previousValue}" to "${value}"`,
          );
        } else if (previousValue === undefined) {
          this.logger?.debug(
            `Environment: Set new process.env.${key}="${value}"`,
          );
        }
      } catch (error) {
        const errorMsg = `Failed to set environment variable ${key}: ${(error as Error).message}`;
        this.logger?.error(`Environment: ${errorMsg}`);
        failedVars.push(key);
      }
    }

    if (failedVars.length > 0) {
      const errorMessage = `Failed to set ${failedVars.length} environment variables: ${failedVars.join(", ")}`;
      this.logger?.error(`Environment: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    this.logger?.info(
      `Environment: Successfully applied ${appliedCount}/${varCount} environment variables`,
    );
  }

  /**
   * Get currently managed environment variables
   */
  getCurrentEnvironmentVars(): Record<string, string> {
    return { ...this.managedVars };
  }

  /**
   * Get current environment variable conflicts
   */
  getEnvironmentConflicts(): EnvironmentConflict[] {
    return [...this.currentConflicts];
  }
}
