/**
 * Core foundational types used across multiple domains
 * Dependencies: None (foundation layer)
 */

/**
 * Agent callbacks interface - aggregates all callback interfaces
 * Re-exported from agent.ts for backward compatibility
 */
export type { AgentCallbacks, AgentOptions } from "../agent.js";

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
