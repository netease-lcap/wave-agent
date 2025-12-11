/**
 * Configuration resolver utilities for Agent Constructor Configuration
 * Resolves configuration from constructor arguments with environment fallbacks
 */

import {
  GatewayConfig,
  ModelConfig,
  ConfigurationError,
  CONFIG_ERRORS,
} from "../types/index.js";
import { DEFAULT_TOKEN_LIMIT } from "./constants.js";

export class ConfigResolver {
  /**
   * Resolves gateway configuration from constructor args and environment
   * @param apiKey - API key from constructor (optional)
   * @param baseURL - Base URL from constructor (optional)
   * @param defaultHeaders - HTTP headers from constructor (optional)
   * @returns Resolved gateway configuration
   * @throws ConfigurationError if required configuration is missing after fallbacks
   */
  static resolveGatewayConfig(
    apiKey?: string,
    baseURL?: string,
    defaultHeaders?: Record<string, string>,
  ): GatewayConfig {
    // Resolve API key: constructor > environment variable
    // Note: Explicitly provided empty strings should be treated as invalid, not fall back to env
    let resolvedApiKey: string;
    if (apiKey !== undefined) {
      resolvedApiKey = apiKey;
    } else {
      resolvedApiKey = process.env.AIGW_TOKEN || "";
    }

    if (!resolvedApiKey && apiKey === undefined) {
      throw new ConfigurationError(CONFIG_ERRORS.MISSING_API_KEY, "apiKey", {
        constructor: apiKey,
        environment: process.env.AIGW_TOKEN,
      });
    }

    if (resolvedApiKey.trim() === "") {
      throw new ConfigurationError(
        CONFIG_ERRORS.EMPTY_API_KEY,
        "apiKey",
        resolvedApiKey,
      );
    }

    // Resolve base URL: constructor > environment variable
    // Note: Explicitly provided empty strings should be treated as invalid, not fall back to env
    let resolvedBaseURL: string;
    if (baseURL !== undefined) {
      resolvedBaseURL = baseURL;
    } else {
      resolvedBaseURL = process.env.AIGW_URL || "";
    }

    if (!resolvedBaseURL && baseURL === undefined) {
      throw new ConfigurationError(CONFIG_ERRORS.MISSING_BASE_URL, "baseURL", {
        constructor: baseURL,
        environment: process.env.AIGW_URL,
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
      defaultHeaders,
    };
  }

  /**
   * Resolves model configuration with fallbacks
   * @param agentModel - Agent model from constructor (optional)
   * @param fastModel - Fast model from constructor (optional)
   * @returns Resolved model configuration with defaults
   */
  static resolveModelConfig(
    agentModel?: string,
    fastModel?: string,
  ): ModelConfig {
    // Default values as per data-model.md
    const DEFAULT_AGENT_MODEL = "claude-sonnet-4-20250514";
    const DEFAULT_FAST_MODEL = "gemini-2.5-flash";

    // Resolve agent model: constructor > environment > default
    const resolvedAgentModel =
      agentModel || process.env.AIGW_MODEL || DEFAULT_AGENT_MODEL;

    // Resolve fast model: constructor > environment > default
    const resolvedFastModel =
      fastModel || process.env.AIGW_FAST_MODEL || DEFAULT_FAST_MODEL;

    return {
      agentModel: resolvedAgentModel,
      fastModel: resolvedFastModel,
    };
  }

  /**
   * Resolves token limit with fallbacks
   * @param constructorLimit - Token limit from constructor (optional)
   * @returns Resolved token limit
   */
  static resolveTokenLimit(constructorLimit?: number): number {
    // If constructor value provided, use it
    if (constructorLimit !== undefined) {
      return constructorLimit;
    }

    // Try environment variable
    const envTokenLimit = process.env.TOKEN_LIMIT;
    if (envTokenLimit) {
      const parsed = parseInt(envTokenLimit, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }

    // Use default
    return DEFAULT_TOKEN_LIMIT;
  }
}

/**
 * Static configuration resolver instance
 * Implements ConfigurationResolver interface from types.ts
 */
export const configResolver = {
  resolveGatewayConfig: (
    apiKey?: string,
    baseURL?: string,
    defaultHeaders?: Record<string, string>,
  ) => ConfigResolver.resolveGatewayConfig(apiKey, baseURL, defaultHeaders),
  resolveModelConfig: ConfigResolver.resolveModelConfig,
  resolveTokenLimit: ConfigResolver.resolveTokenLimit,
};
