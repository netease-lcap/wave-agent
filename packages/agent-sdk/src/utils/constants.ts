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
 * Prompt history file path
 */
export const PROMPT_HISTORY_FILE = path.join(DATA_DIRECTORY, "history.jsonl");

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
export const DEFAULT_WAVE_MAX_INPUT_TOKENS = 96000; // Default token limit
export const DEFAULT_WAVE_MAX_OUTPUT_TOKENS = 8192; // Default output token limit

/**
 * Default number of messages to keep uncompressed
 */
export const DEFAULT_KEEP_LAST_MESSAGES_COUNT = 7;
