/**
 * Application constants definition
 */

import path from "path";
import os from "os";

/**
 * Application data storage directory
 * Used to store debug logs, command history and other data
 */
export const DATA_DIRECTORY = path.join(os.homedir(), ".wave");

/**
 * Bash command history file path
 */
export const BASH_HISTORY_FILE = path.join(DATA_DIRECTORY, "bash-history.json");

/**
 * Error log directory path
 */
export const ERROR_LOG_DIRECTORY = path.join(DATA_DIRECTORY, "error-logs");

/**
 * User-level memory file path
 */
export const USER_MEMORY_FILE = path.join(DATA_DIRECTORY, "AGENTS.md");

/**
 * AI related constants
 */
export const DEFAULT_TOKEN_LIMIT = 96000; // Default token limit

/**
 * @deprecated These constants are now legacy. Use ModelConfig through Agent constructor instead.
 * They are maintained for backward compatibility with existing code that might still reference them,
 * but the actual AI services now use configuration injection.
 */
export const FAST_MODEL_ID = process.env.AIGW_FAST_MODEL || "gemini-2.5-flash";

/**
 * @deprecated These constants are now legacy. Use ModelConfig through Agent constructor instead.
 * They are maintained for backward compatibility with existing code that might still reference them,
 * but the actual AI services now use configuration injection.
 */
export const AGENT_MODEL_ID =
  process.env.AIGW_MODEL || "claude-sonnet-4-20250514";
