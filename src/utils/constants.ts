/**
 * 应用常量定义
 */

import path from "path";
import os from "os";

/**
 * 应用数据存储目录
 * 用于存储调试日志、命令历史等数据
 */
export const DATA_DIRECTORY = path.join(os.homedir(), ".lcap-code");

/**
 * 应用日志文件路径
 */
export const LOG_FILE = path.join(DATA_DIRECTORY, "app.log");

/**
 * Bash命令历史文件路径
 */
export const BASH_HISTORY_FILE = path.join(DATA_DIRECTORY, "bash-history.json");

/**
 * 认证token文件路径
 */
export const AUTH_TOKEN_FILE = path.join(DATA_DIRECTORY, "auth-token.json");

/**
 * 用户凭据文件路径
 */
export const CREDENTIALS_FILE = path.join(DATA_DIRECTORY, "credentials.json");

/**
 * 错误日志目录路径
 */
export const ERROR_LOG_DIRECTORY = path.join(DATA_DIRECTORY, "error-logs");

/**
 * 用户级记忆文件路径
 */
export const USER_MEMORY_FILE = path.join(DATA_DIRECTORY, "user-memory.md");

/**
 * 分页相关常量
 */
export const MESSAGES_PER_PAGE = 20; // 每页显示的消息数量

/**
 * AI 相关常量
 */
export const DEFAULT_TOKEN_LIMIT = 32000; // 默认 token 限制（32k）
