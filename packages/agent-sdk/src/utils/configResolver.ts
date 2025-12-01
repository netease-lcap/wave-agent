/**
 * Configuration resolver utilities for Agent Constructor Configuration
 * Resolves configuration from constructor arguments with environment fallbacks
 * Supports live configuration updates and cache invalidation
 */

import {
  GatewayConfig,
  ModelConfig,
  ConfigurationError,
  CONFIG_ERRORS,
} from "../types/index.js";
import { DEFAULT_TOKEN_LIMIT } from "./constants.js";
import { loadMergedWaveConfig } from "../services/hook.js";
import { getGlobalLogger } from "./globalLogger.js";

/**
 * Live configuration cache and invalidation support
 */
interface ConfigurationCache {
  workdir?: string;
  lastUpdated: number;
  environmentVars: Record<string, string>;
  isValid: boolean;
}

let configCache: ConfigurationCache | null = null;

/**
 * Initialize configuration cache with current environment variables from settings.json
 */
function initializeConfigurationCache(workdir?: string): void {
  try {
    const waveConfig = workdir ? loadMergedWaveConfig(workdir) : null;
    const envVars = waveConfig?.env || {};

    configCache = {
      workdir,
      lastUpdated: Date.now(),
      environmentVars: envVars,
      isValid: true,
    };

    const logger = getGlobalLogger();
    logger?.debug(
      `Live Config: Configuration cache initialized with ${Object.keys(envVars).length} environment variables`,
    );
  } catch (error) {
    const logger = getGlobalLogger();
    logger?.error(
      `Live Config: Failed to initialize configuration cache: ${(error as Error).message}`,
    );
    configCache = {
      workdir,
      lastUpdated: Date.now(),
      environmentVars: {},
      isValid: false,
    };
  }
}

/**
 * Get current environment variable value with live configuration support
 */
function getCurrentEnvironmentValue(
  key: string,
  workdir?: string,
): string | undefined {
  // Initialize cache if not present or workdir changed
  if (!configCache || configCache.workdir !== workdir) {
    initializeConfigurationCache(workdir);
  }

  // Use cached environment variables if available and valid
  if (configCache && configCache.isValid) {
    const cachedValue = configCache.environmentVars[key];
    if (cachedValue !== undefined) {
      const logger = getGlobalLogger();
      logger?.debug(
        `Live Config: Using cached environment variable ${key}=${cachedValue}`,
      );
      return cachedValue;
    }
  }

  // Fallback to process environment
  return process.env[key];
}

export class ConfigResolver {
  /**
   * Resolves gateway configuration from constructor args and environment with live config support
   * @param apiKey - API key from constructor (optional)
   * @param baseURL - Base URL from constructor (optional)
   * @param workdir - Working directory for loading live configuration (optional)
   * @returns Resolved gateway configuration
   * @throws ConfigurationError if required configuration is missing after fallbacks
   */
  static resolveGatewayConfig(
    apiKey?: string,
    baseURL?: string,
    workdir?: string,
  ): GatewayConfig {
    // Resolve API key: constructor > live configuration > environment variable
    // Note: Explicitly provided empty strings should be treated as invalid, not fall back to env
    let resolvedApiKey: string;
    if (apiKey !== undefined) {
      resolvedApiKey = apiKey;
    } else {
      resolvedApiKey = getCurrentEnvironmentValue("AIGW_TOKEN", workdir) || "";
    }

    if (!resolvedApiKey && apiKey === undefined) {
      const envValue = getCurrentEnvironmentValue("AIGW_TOKEN", workdir);
      throw new ConfigurationError(CONFIG_ERRORS.MISSING_API_KEY, "apiKey", {
        constructor: apiKey,
        environment: envValue,
      });
    }

    if (resolvedApiKey.trim() === "") {
      throw new ConfigurationError(
        CONFIG_ERRORS.EMPTY_API_KEY,
        "apiKey",
        resolvedApiKey,
      );
    }

    // Resolve base URL: constructor > live configuration > environment variable
    // Note: Explicitly provided empty strings should be treated as invalid, not fall back to env
    let resolvedBaseURL: string;
    if (baseURL !== undefined) {
      resolvedBaseURL = baseURL;
    } else {
      resolvedBaseURL = getCurrentEnvironmentValue("AIGW_URL", workdir) || "";
    }

    if (!resolvedBaseURL && baseURL === undefined) {
      const envValue = getCurrentEnvironmentValue("AIGW_URL", workdir);
      throw new ConfigurationError(CONFIG_ERRORS.MISSING_BASE_URL, "baseURL", {
        constructor: baseURL,
        environment: envValue,
      });
    }

    if (resolvedBaseURL.trim() === "") {
      throw new ConfigurationError(
        CONFIG_ERRORS.EMPTY_BASE_URL,
        "baseURL",
        resolvedBaseURL,
      );
    }

    return {
      apiKey: resolvedApiKey,
      baseURL: resolvedBaseURL,
    };
  }

  /**
   * Resolves model configuration with fallbacks and live config support
   * @param agentModel - Agent model from constructor (optional)
   * @param fastModel - Fast model from constructor (optional)
   * @param workdir - Working directory for loading live configuration (optional)
   * @returns Resolved model configuration with defaults
   */
  static resolveModelConfig(
    agentModel?: string,
    fastModel?: string,
    workdir?: string,
  ): ModelConfig {
    // Default values as per data-model.md
    const DEFAULT_AGENT_MODEL = "claude-sonnet-4-20250514";
    const DEFAULT_FAST_MODEL = "gemini-2.5-flash";

    // Resolve agent model: constructor > live configuration > environment > default
    const resolvedAgentModel =
      agentModel ||
      getCurrentEnvironmentValue("AIGW_MODEL", workdir) ||
      DEFAULT_AGENT_MODEL;

    // Resolve fast model: constructor > live configuration > environment > default
    const resolvedFastModel =
      fastModel ||
      getCurrentEnvironmentValue("AIGW_FAST_MODEL", workdir) ||
      DEFAULT_FAST_MODEL;

    const logger = getGlobalLogger();
    logger?.debug(
      `Live Config: Resolved models - agent: ${resolvedAgentModel}, fast: ${resolvedFastModel}`,
    );

    return {
      agentModel: resolvedAgentModel,
      fastModel: resolvedFastModel,
    };
  }

  /**
   * Resolves token limit with fallbacks and live config support
   * @param constructorLimit - Token limit from constructor (optional)
   * @param workdir - Working directory for loading live configuration (optional)
   * @returns Resolved token limit
   */
  static resolveTokenLimit(
    constructorLimit?: number,
    workdir?: string,
  ): number {
    // If constructor value provided, use it
    if (constructorLimit !== undefined) {
      return constructorLimit;
    }

    // Try live configuration then environment variable
    const envTokenLimit = getCurrentEnvironmentValue("TOKEN_LIMIT", workdir);
    if (envTokenLimit) {
      const parsed = parseInt(envTokenLimit, 10);
      if (!isNaN(parsed)) {
        const logger = getGlobalLogger();
        logger?.debug(
          `Live Config: Resolved token limit from configuration: ${parsed}`,
        );
        return parsed;
      }
    }

    // Use default
    return DEFAULT_TOKEN_LIMIT;
  }

  /**
   * Invalidate configuration cache to force reload from settings.json
   * @param workdir - Working directory to invalidate cache for (optional)
   */
  static invalidateCache(workdir?: string): void {
    if (
      configCache &&
      (workdir === undefined || configCache.workdir === workdir)
    ) {
      const logger = getGlobalLogger();
      logger?.info(
        `Live Config: Configuration cache invalidated for workdir: ${workdir || "global"}`,
      );
      configCache = null;
    }
  }

  /**
   * Refresh configuration cache by reloading from settings.json
   * @param workdir - Working directory to refresh cache for (optional)
   */
  static refreshCache(workdir?: string): void {
    const logger = getGlobalLogger();
    logger?.info(
      `Live Config: Refreshing configuration cache for workdir: ${workdir || "global"}`,
    );
    initializeConfigurationCache(workdir);
  }

  /**
   * Get current cache status for monitoring
   * @returns Cache information or null if no cache
   */
  static getCacheStatus(): {
    workdir?: string;
    lastUpdated: number;
    envVarCount: number;
    isValid: boolean;
  } | null {
    if (!configCache) {
      return null;
    }

    return {
      workdir: configCache.workdir,
      lastUpdated: configCache.lastUpdated,
      envVarCount: Object.keys(configCache.environmentVars).length,
      isValid: configCache.isValid,
    };
  }
}

/**
 * Static configuration resolver instance
 * Implements ConfigurationResolver interface from types.ts with backward compatibility
 */
export const configResolver = {
  resolveGatewayConfig: (apiKey?: string, baseURL?: string, workdir?: string) =>
    ConfigResolver.resolveGatewayConfig(apiKey, baseURL, workdir),
  resolveModelConfig: (
    agentModel?: string,
    fastModel?: string,
    workdir?: string,
  ) => ConfigResolver.resolveModelConfig(agentModel, fastModel, workdir),
  resolveTokenLimit: (constructorLimit?: number, workdir?: string) =>
    ConfigResolver.resolveTokenLimit(constructorLimit, workdir),

  // Live configuration management methods
  invalidateCache: ConfigResolver.invalidateCache,
  refreshCache: ConfigResolver.refreshCache,
  getCacheStatus: ConfigResolver.getCacheStatus,
};
