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
    // Validate API key if provided
    if (config.apiKey !== undefined) {
      if (typeof config.apiKey !== "string") {
        throw new ConfigurationError(
          "API key must be a string if provided.",
          "apiKey",
          config.apiKey,
        );
      }
    }

    // Validate base URL if provided
    if (config.baseURL) {
      if (typeof config.baseURL !== "string") {
        throw new ConfigurationError(
          "Base URL must be a string if provided.",
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
  }

  /**
   * Validates a context window value (a positive integer, in tokens)
   * @param contextWindow - Context window to validate
   * @throws ConfigurationError if invalid
   */
  static validateContextWindow(contextWindow: number): void {
    if (typeof contextWindow !== "number") {
      throw new ConfigurationError(
        CONFIG_ERRORS.INVALID_WAVE_CONTEXT_WINDOW,
        "contextWindow",
        contextWindow,
      );
    }

    if (!Number.isInteger(contextWindow)) {
      throw new ConfigurationError(
        CONFIG_ERRORS.INVALID_WAVE_CONTEXT_WINDOW,
        "contextWindow",
        contextWindow,
      );
    }

    if (contextWindow <= 0) {
      throw new ConfigurationError(
        CONFIG_ERRORS.INVALID_WAVE_CONTEXT_WINDOW,
        "contextWindow",
        contextWindow,
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
  validateContextWindow: ConfigValidator.validateContextWindow,
};
