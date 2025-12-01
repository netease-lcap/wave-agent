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
