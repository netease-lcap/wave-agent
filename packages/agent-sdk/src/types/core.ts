/**
 * Core foundational types used across multiple domains
 * Dependencies: None (foundation layer)
 */

import type { CompletionUsage } from "openai/resources";

/**
 * Logger interface definition
 * Compatible with OpenAI package Logger interface
 */
export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * Usage statistics for AI operations
 * Extends OpenAI's Usage format with additional tracking fields
 */
export interface Usage {
  prompt_tokens: number; // Tokens used in prompts
  completion_tokens: number; // Tokens generated in completions
  total_tokens: number; // Sum of prompt + completion tokens
  model?: string; // Model used for the operation (e.g., "gpt-4", "gpt-3.5-turbo")
  operation_type?: "agent" | "compress"; // Type of operation that generated usage

  // Cache-related tokens (Claude models only)
  cache_read_input_tokens?: number; // Tokens read from cache
  cache_creation_input_tokens?: number; // Tokens used to create cache entries
  cache_creation?: {
    ephemeral_5m_input_tokens: number; // Tokens cached for 5 minutes
    ephemeral_1h_input_tokens: number; // Tokens cached for 1 hour
  };
}

/**
 * Enhanced usage metrics including Claude cache information
 * Backward compatible with standard OpenAI CompletionUsage
 */
export interface ClaudeUsage extends CompletionUsage {
  // Standard OpenAI usage fields (inherited)
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;

  // Claude-specific cache extensions
  /**
   * Number of tokens read from existing cache
   * Indicates cost savings from cache hits
   */
  cache_read_input_tokens?: number;

  /**
   * Number of tokens used to create new cache entries
   * Investment in future cache hits
   */
  cache_creation_input_tokens?: number;

  /**
   * Detailed breakdown of cache creation by duration
   */
  cache_creation?: {
    /** Tokens cached for 5 minute duration */
    ephemeral_5m_input_tokens: number;
    /** Tokens cached for 1 hour duration */
    ephemeral_1h_input_tokens: number;
  };
}

export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly provided?: unknown,
  ) {
    super(message);
    this.name = "ConfigurationError";
  }
}

// Standard error messages
export const CONFIG_ERRORS = {
  MISSING_API_KEY:
    "Gateway configuration requires apiKey. Provide via constructor or AIGW_TOKEN environment variable.",
  MISSING_BASE_URL:
    "Gateway configuration requires baseURL. Provide via constructor or AIGW_URL environment variable.",
  INVALID_TOKEN_LIMIT: "Token limit must be a positive integer.",
  EMPTY_API_KEY: "API key cannot be empty string.",
  EMPTY_BASE_URL: "Base URL cannot be empty string.",
} as const;
