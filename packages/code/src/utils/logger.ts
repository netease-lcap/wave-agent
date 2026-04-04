/**
 * Logger utility module
 * Supports filtering by log level and keywords
 * Logs are written to files instead of terminal to avoid being cleared by Ink app
 *
 * Performance optimization:
 * - In test environment, you can disable all file and console I/O operations by setting environment variable DISABLE_LOGGER_IO=true
 * - This can significantly improve test execution performance by avoiding unnecessary disk writes
 */

import * as fs from "fs";
import { Chalk } from "chalk";
import { getLastLines } from "wave-agent-sdk";
import { LOG_FILE, DATA_DIRECTORY } from "./constants.js";

const chalk = new Chalk({ level: 3 });

const logFile = process.env.LOG_FILE || LOG_FILE;

/**
 * Log level enumeration
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Log level name mapping
 */
const LOG_LEVEL_NAMES = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

/**
 * Log level color mapping
 */
const LEVEL_COLORS = {
  [LogLevel.DEBUG]: chalk.gray,
  [LogLevel.INFO]: chalk.blue,
  [LogLevel.WARN]: chalk.yellow,
  [LogLevel.ERROR]: chalk.red,
};

/**
 * Log configuration interface
 */
interface LogConfig {
  readonly level: LogLevel;
  readonly keywords: string[];
}

/**
 * Parse log level from environment variable
 */
const parseLogLevel = (levelStr: string | undefined): LogLevel => {
  if (!levelStr) return LogLevel.INFO;

  const upperLevel = levelStr.toUpperCase();
  switch (upperLevel) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
};

/**
 * Parse keyword filter from environment variable
 */
const parseKeywords = (keywordsStr: string | undefined): string[] => {
  if (!keywordsStr) return [];
  return keywordsStr
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
};

/**
 * Load log configuration from environment variables
 *
 * Supported environment variables:
 * - LOG_LEVEL: Log level (DEBUG, INFO, WARN, ERROR), default INFO
 * - LOG_KEYWORDS: Keyword filter, comma-separated, default no filter
 */
const logConfig: LogConfig = {
  level: parseLogLevel(process.env.LOG_LEVEL),
  keywords: parseKeywords(process.env.LOG_KEYWORDS),
};

/**
 * Check if log should be recorded
 */
const shouldLog = (level: LogLevel, message: string): boolean => {
  // Check log level
  if (level < logConfig.level) {
    return false;
  }

  // If no keyword filter is set, record all logs that meet the level requirement
  if (logConfig.keywords.length === 0) {
    return true;
  }

  // Check keyword filter
  const lowerMessage = message.toLowerCase();
  return logConfig.keywords.some((keyword) => lowerMessage.includes(keyword));
};

/**
 * Format log arguments
 */
const formatArg = (arg: unknown): string => {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";

  let result: string;
  if (arg instanceof Error) {
    // Special handling for Error objects, display stack or message
    result = arg.stack || arg.message || String(arg);
  } else if (typeof arg === "object") {
    try {
      result = JSON.stringify(arg);
    } catch {
      // If JSON.stringify fails, fallback to String()
      result = String(arg);
    }
  } else {
    result = String(arg);
  }

  // Ensure no newlines in the result to keep log entries single-line
  return result.replace(/[\n\r]+/g, " ");
};

/**
 * Generic log output function
 */
const logMessage = (level: LogLevel, ...args: unknown[]): void => {
  const messageText = args.map(formatArg).join(" ");

  // Check if this log should be recorded
  if (!shouldLog(level, messageText)) {
    return;
  }

  // If logger I/O operations are disabled, return directly to save performance
  if (process.env.DISABLE_LOGGER_IO === "true") {
    return;
  }

  const levelName = LOG_LEVEL_NAMES[level];
  const timestamp = new Date().toISOString();
  const color = LEVEL_COLORS[level] || ((s: string) => s);
  const formattedMessage = `[${chalk.gray(timestamp)}] [${color(levelName)}] ${messageText}\n`;

  try {
    // Ensure directory exists
    if (!fs.existsSync(DATA_DIRECTORY)) {
      fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
    }

    // Write log to file
    fs.appendFileSync(logFile, formattedMessage);
  } catch (error) {
    // If file write fails, fallback to stderr
    process.stderr.write(
      `[${levelName}] Failed to write to log file: ${error}\n`,
    );
    process.stderr.write(formattedMessage);
  }
};

/**
 * Logger object
 */
export const logger = {
  /**
   * Debug log output function
   */
  debug: (...args: unknown[]): void => {
    logMessage(LogLevel.DEBUG, ...args);
  },

  /**
   * Info log output function
   */
  info: (...args: unknown[]): void => {
    logMessage(LogLevel.INFO, ...args);
  },

  /**
   * Warning log output function
   */
  warn: (...args: unknown[]): void => {
    logMessage(LogLevel.WARN, ...args);
  },

  /**
   * Error log output function
   */
  error: (...args: unknown[]): void => {
    logMessage(LogLevel.ERROR, ...args);
  },
};

/**
 * Get current log configuration
 */
export const getLogConfig = (): LogConfig => {
  return logConfig;
};

/**
 * Get log file path
 */
export const getLogFile = (): string => {
  return logFile;
};

/**
 * Log cleanup configuration
 */
interface LogCleanupConfig {
  /** Maximum size of current log file (bytes), default 10MB */
  maxFileSize: number;
  /** Number of lines to keep when truncating, default 1000 lines */
  keepLines: number;
}

/**
 * Get log cleanup configuration
 * Can override default configuration with environment variables
 */
const getCleanupConfig = (): LogCleanupConfig => {
  return {
    maxFileSize: parseInt(process.env.LOG_MAX_FILE_SIZE || "10485760", 10), // 10MB
    keepLines: parseInt(process.env.LOG_KEEP_LINES || "1000", 10),
  };
};

/**
 * Truncate current log file if too large
 * Keep the last specified number of lines
 */
const truncateLogFileIfNeeded = (config: LogCleanupConfig): void => {
  // If logger I/O operations are disabled, return directly to save performance
  if (process.env.DISABLE_LOGGER_IO === "true") {
    return;
  }

  try {
    if (!fs.existsSync(logFile)) {
      return;
    }

    const stats = fs.statSync(logFile);

    // If file size exceeds limit, truncate file
    if (stats.size > config.maxFileSize) {
      const content = fs.readFileSync(logFile, "utf8");
      const truncatedContent = getLastLines(content, config.keepLines);

      // Write truncated content
      fs.writeFileSync(logFile, truncatedContent);

      // Record truncation operation
      logger.debug(
        `Log file truncated: file size ${stats.size} exceeded limit ${config.maxFileSize}, kept last ${config.keepLines} lines`,
      );
    }
  } catch (error) {
    logger.warn("Failed to truncate log file:", error);
  }
};

/**
 * Execute log cleanup
 * Truncate current log file (if needed)
 *
 * @param customConfig Custom cleanup configuration, if not provided uses default configuration
 */
export const cleanupLogs = async (
  customConfig?: Partial<LogCleanupConfig>,
): Promise<void> => {
  // If logger I/O operations are disabled, return directly to save performance
  if (process.env.DISABLE_LOGGER_IO === "true") {
    return;
  }

  const config = { ...getCleanupConfig(), ...customConfig };

  logger.debug("Starting log cleanup...", {
    maxFileSize: config.maxFileSize,
    keepLines: config.keepLines,
  });

  // Truncate current log file (if needed)
  truncateLogFileIfNeeded(config);

  logger.debug("Log cleanup completed");
};
