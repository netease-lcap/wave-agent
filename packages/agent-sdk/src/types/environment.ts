/**
 * Environment Variable System Types
 *
 * Provides comprehensive TypeScript types for environment variable validation,
 * merging, and conflict resolution in the Wave Agent SDK.
 */

/**
 * Result of environment variable validation
 */
export interface EnvironmentValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Context containing merged environment variables and conflict information
 */
export interface MergedEnvironmentContext {
  userVars: Record<string, string>;
  projectVars: Record<string, string>;
  mergedVars: Record<string, string>;
  conflicts: Array<{
    key: string;
    userValue: string;
    projectValue: string;
    resolvedValue: string;
  }>;
}

/**
 * Type guard to check if a value is a valid environment variables object
 */
export function isValidEnvironmentVars(
  env: unknown,
): env is Record<string, string> {
  if (typeof env !== "object" || env === null) {
    return false;
  }

  // Check if all keys and values are strings
  for (const [key, value] of Object.entries(env)) {
    if (typeof key !== "string" || typeof value !== "string") {
      return false;
    }
  }

  return true;
}

/**
 * Configuration options for environment merging
 */
export interface EnvironmentMergeOptions {
  /** Whether to include warnings for conflicting variables */
  includeConflictWarnings?: boolean;
  /** Whether to validate variable names for common patterns */
  validateVariableNames?: boolean;
}

/**
 * Result of environment variable processing operations
 */
export interface EnvironmentProcessResult {
  /** The processed environment variables */
  processedVars: Record<string, string>;
  /** Any conflicts that occurred during processing */
  conflicts: EnvironmentConflict[];
  /** Non-critical warnings during processing */
  warnings: string[];
  /** Whether the variables were successfully applied to process.env */
  applied: boolean;
}

/**
 * Enhanced environment merge context with conflict details
 */
export interface EnvironmentMergeContext {
  /** User-provided environment variables */
  userVars: Record<string, string>;
  /** Project-provided environment variables */
  projectVars: Record<string, string>;
  /** Final merged environment variables */
  mergedVars: Record<string, string>;
  /** Detailed conflict information */
  conflicts: EnvironmentConflict[];
}

/**
 * Detailed information about an environment variable conflict
 */
export interface EnvironmentConflict {
  /** The environment variable key */
  key: string;
  /** Value from user configuration */
  userValue: string;
  /** Value from project configuration */
  projectValue: string;
  /** Final resolved value (which source won) */
  resolvedValue: string;
  /** Which source provided the final value */
  source: "user" | "project";
}
