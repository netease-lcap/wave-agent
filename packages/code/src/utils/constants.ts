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
 * Log directory — one file per surface (cli/desktop/vscode/jetbrains).
 */
export const LOGS_DIRECTORY = path.join(DATA_DIRECTORY, "logs");

/**
 * CLI log file path
 */
export const LOG_FILE = path.join(LOGS_DIRECTORY, "cli.log");

/**
 * Pagination related constants
 */
export const MESSAGES_PER_PAGE = 15; // Number of messages displayed per page
