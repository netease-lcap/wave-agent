/**
 * Configuration validator utilities for Agent Constructor Configuration
 * Validates configuration values for correctness and security
 */

import {
  GatewayConfig,
  ConfigurationError,
  CONFIG_ERRORS,
} from "../types/index.js";

export class ConfigValidator {
  /**
   * Validates gateway configuration
   * @param config - Configuration to validate
   * @throws ConfigurationError with descriptive message if invalid
   */
  static validateGatewayConfig(config: GatewayConfig): void {
    // Validate API key
    if (!config.apiKey || typeof config.apiKey !== "string") {
      throw new ConfigurationError(
        CONFIG_ERRORS.EMPTY_API_KEY,
        "apiKey",
        config.apiKey,
      );
    }

    if (config.apiKey.trim() === "") {
      throw new ConfigurationError(
        CONFIG_ERRORS.EMPTY_API_KEY,
        "apiKey",
        config.apiKey,
      );
    }

    // Validate base URL
    if (!config.baseURL || typeof config.baseURL !== "string") {
      throw new ConfigurationError(
        CONFIG_ERRORS.EMPTY_BASE_URL,
        "baseURL",
        config.baseURL,
      );
    }

    if (config.baseURL.trim() === "") {
      throw new ConfigurationError(
        CONFIG_ERRORS.EMPTY_BASE_URL,
        "baseURL",
        config.baseURL,
      );
    }

    // Basic URL format validation
    try {
      new URL(config.baseURL);
    } catch {
      throw new ConfigurationError(
        `Base URL must be a valid URL format. Received: ${config.baseURL}`,
        "baseURL",
        config.baseURL,
      );
    }
  }

  /**
   * Validates token limit value
   * @param tokenLimit - Token limit to validate
   * @throws ConfigurationError if invalid
   */
  static validateTokenLimit(tokenLimit: number): void {
    if (typeof tokenLimit !== "number") {
      throw new ConfigurationError(
        CONFIG_ERRORS.INVALID_TOKEN_LIMIT,
        "tokenLimit",
        tokenLimit,
      );
    }

    if (!Number.isInteger(tokenLimit)) {
      throw new ConfigurationError(
        CONFIG_ERRORS.INVALID_TOKEN_LIMIT,
        "tokenLimit",
        tokenLimit,
      );
    }

    if (tokenLimit <= 0) {
      throw new ConfigurationError(
        CONFIG_ERRORS.INVALID_TOKEN_LIMIT,
        "tokenLimit",
        tokenLimit,
      );
    }
  }

  /**
   * Validates model configuration (basic validation)
   * @param agentModel - Agent model string
   * @param fastModel - Fast model string
   * @throws ConfigurationError if invalid
   */
  static validateModelConfig(agentModel: string, fastModel: string): void {
    if (
      !agentModel ||
      typeof agentModel !== "string" ||
      agentModel.trim() === ""
    ) {
      throw new ConfigurationError(
        "Agent model must be a non-empty string.",
        "agentModel",
        agentModel,
      );
    }

    if (
      !fastModel ||
      typeof fastModel !== "string" ||
      fastModel.trim() === ""
    ) {
      throw new ConfigurationError(
        "Fast model must be a non-empty string.",
        "fastModel",
        fastModel,
      );
    }
  }
}

/**
 * Static configuration validator instance
 * Implements ConfigurationValidator interface from types.ts
 */
export const configValidator = {
  validateGatewayConfig: ConfigValidator.validateGatewayConfig,
  validateTokenLimit: ConfigValidator.validateTokenLimit,
  validateModelConfig: ConfigValidator.validateModelConfig,
};
