/**
 * 日志工具模块
 * 支持按照日志级别和关键词进行过滤
 * 日志会写入文件而不是终端，避免被 Ink 应用清空
 *
 * 性能优化：
 * - 在测试环境中，可以通过设置环境变量 DISABLE_LOGGER_IO=true 来禁用所有文件和控制台 I/O 操作
 * - 这样可以显著提升测试执行性能，避免不必要的磁盘写入
 */

import * as fs from "fs";
import { LOG_FILE, DATA_DIRECTORY } from "./constants";

const logFile = process.env.LOG_FILE || LOG_FILE;

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * 日志级别名称映射
 */
const LOG_LEVEL_NAMES = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

/**
 * 日志配置接口
 */
interface LogConfig {
  readonly level: LogLevel;
  readonly keywords: string[];
}

/**
 * 解析环境变量中的日志级别
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
 * 解析环境变量中的关键词过滤
 */
const parseKeywords = (keywordsStr: string | undefined): string[] => {
  if (!keywordsStr) return [];
  return keywordsStr
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
};

/**
 * 从环境变量加载日志配置
 *
 * 支持的环境变量：
 * - LOG_LEVEL: 日志级别 (DEBUG, INFO, WARN, ERROR)，默认 INFO
 * - LOG_KEYWORDS: 关键词过滤，用逗号分隔，默认无过滤
 */
const logConfig: LogConfig = {
  level: parseLogLevel(process.env.LOG_LEVEL),
  keywords: parseKeywords(process.env.LOG_KEYWORDS),
};

/**
 * 检查是否应该记录日志
 */
const shouldLog = (level: LogLevel, message: string): boolean => {
  // 检查日志级别
  if (level < logConfig.level) {
    return false;
  }

  // 如果没有设置关键词过滤，则记录所有符合级别的日志
  if (logConfig.keywords.length === 0) {
    return true;
  }

  // 检查关键词过滤
  const lowerMessage = message.toLowerCase();
  return logConfig.keywords.some((keyword) => lowerMessage.includes(keyword));
};

/**
 * 格式化日志参数
 */
const formatArg = (arg: unknown): string => {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";

  if (arg instanceof Error) {
    // 特殊处理 Error 对象，显示 stack 或 message
    return arg.stack || arg.message || String(arg);
  }

  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      // 如果 JSON.stringify 失败，fallback 到 String()
      return String(arg);
    }
  }

  return String(arg);
};

/**
 * 通用日志输出函数
 */
const logMessage = (level: LogLevel, ...args: unknown[]): void => {
  const messageText = args.map(formatArg).join(" ");

  // 检查是否应该记录这条日志
  if (!shouldLog(level, messageText)) {
    return;
  }

  // 如果禁用了 logger I/O 操作，直接返回以节约性能
  if (process.env.DISABLE_LOGGER_IO === "true") {
    return;
  }

  const levelName = LOG_LEVEL_NAMES[level];
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] [${levelName}] ${messageText}\n`;

  try {
    // 确保目录存在
    if (!fs.existsSync(DATA_DIRECTORY)) {
      fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
    }

    // 将日志写入文件
    fs.appendFileSync(logFile, formattedMessage);
  } catch (error) {
    // 如果文件写入失败，fallback 到 stderr
    process.stderr.write(
      `[${levelName}] Failed to write to log file: ${error}\n`,
    );
    process.stderr.write(formattedMessage);
  }
};

/**
 * 日志器对象
 */
export const logger = {
  /**
   * 调试日志输出函数
   */
  debug: (...args: unknown[]): void => {
    logMessage(LogLevel.DEBUG, ...args);
  },

  /**
   * 信息日志输出函数
   */
  info: (...args: unknown[]): void => {
    logMessage(LogLevel.INFO, ...args);
  },

  /**
   * 警告日志输出函数
   */
  warn: (...args: unknown[]): void => {
    logMessage(LogLevel.WARN, ...args);
  },

  /**
   * 错误日志输出函数
   */
  error: (...args: unknown[]): void => {
    logMessage(LogLevel.ERROR, ...args);
  },
};

/**
 * 获取当前日志配置
 */
export const getLogConfig = (): LogConfig => {
  return logConfig;
};

/**
 * 获取日志文件路径
 */
export const getLogFile = (): string => {
  return logFile;
};

/**
 * 日志清理配置
 */
interface LogCleanupConfig {
  /** 当前日志文件最大大小（字节），默认10MB */
  maxFileSize: number;
  /** 截断时保留的行数，默认1000行 */
  keepLines: number;
}

/**
 * 获取日志清理配置
 * 可以通过环境变量覆盖默认配置
 */
const getCleanupConfig = (): LogCleanupConfig => {
  return {
    maxFileSize: parseInt(process.env.LOG_MAX_FILE_SIZE || "10485760", 10), // 10MB
    keepLines: parseInt(process.env.LOG_KEEP_LINES || "1000", 10),
  };
};

/**
 * 截断当前日志文件如果太大
 * 保留最后指定行数的日志
 */
const truncateLogFileIfNeeded = (config: LogCleanupConfig): void => {
  // 如果禁用了 logger I/O 操作，直接返回以节约性能
  if (process.env.DISABLE_LOGGER_IO === "true") {
    return;
  }

  try {
    if (!fs.existsSync(logFile)) {
      return;
    }

    const stats = fs.statSync(logFile);

    // 如果文件大小超过限制，截断文件
    if (stats.size > config.maxFileSize) {
      const content = fs.readFileSync(logFile, "utf8");
      const lines = content.split("\n");

      // 保留最后指定行数的日志
      const keepLines = Math.min(config.keepLines, lines.length);
      const truncatedContent = lines.slice(-keepLines).join("\n");

      // 写入截断后的内容
      fs.writeFileSync(logFile, truncatedContent);

      // 记录截断操作
      const removedLines = lines.length - keepLines;
      logger.info(
        `Log file truncated: removed ${removedLines} lines, kept last ${keepLines} lines`,
      );
    }
  } catch (error) {
    logger.warn("Failed to truncate log file:", error);
  }
};

/**
 * 执行日志清理
 * 截断当前日志文件（如果需要）
 *
 * @param customConfig 自定义清理配置，如果不提供则使用默认配置
 */
export const cleanupLogs = async (
  customConfig?: Partial<LogCleanupConfig>,
): Promise<void> => {
  // 如果禁用了 logger I/O 操作，直接返回以节约性能
  if (process.env.DISABLE_LOGGER_IO === "true") {
    return;
  }

  const config = { ...getCleanupConfig(), ...customConfig };

  logger.info("Starting log cleanup...", {
    maxFileSize: config.maxFileSize,
    keepLines: config.keepLines,
  });

  // 截断当前日志文件（如果需要）
  truncateLogFileIfNeeded(config);

  logger.info("Log cleanup completed");
};

/**
 * 清空日志文件
 */
export const clearLog = (): void => {
  // 如果禁用了 logger I/O 操作，直接返回以节约性能
  if (process.env.DISABLE_LOGGER_IO === "true") {
    return;
  }

  try {
    fs.writeFileSync(logFile, "");
    logger.info("Log file cleared");
  } catch (error) {
    process.stderr.write(`[LOG] Failed to clear log file: ${error}\n`);
  }
};
