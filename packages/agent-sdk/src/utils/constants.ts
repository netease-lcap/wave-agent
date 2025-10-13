/**
 * 应用常量定义
 */

import path from "path";
import os from "os";

/**
 * 应用数据存储目录
 * 用于存储调试日志、命令历史等数据
 */
export const DATA_DIRECTORY = path.join(os.homedir(), ".wave");

/**
 * Bash命令历史文件路径
 */
export const BASH_HISTORY_FILE = path.join(DATA_DIRECTORY, "bash-history.json");

/**
 * 错误日志目录路径
 */
export const ERROR_LOG_DIRECTORY = path.join(DATA_DIRECTORY, "error-logs");

/**
 * 用户级记忆文件路径
 */
export const USER_MEMORY_FILE = path.join(DATA_DIRECTORY, "user-memory.md");

/**
 * AI 相关常量
 */
export const DEFAULT_TOKEN_LIMIT = 64000; // 默认 token 限制

export const FAST_MODEL_ID = process.env.AIGW_FAST_MODEL || "gemini-2.5-flash";

export const AGENT_MODEL_ID =
  process.env.AIGW_MODEL || "claude-sonnet-4-20250514";
