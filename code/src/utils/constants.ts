/**
 * 应用常量定义
 */

import path from "path";
import os from "os";

/**
 * 应用数据存储目录
 * 用于存储调试日志、命令历史等数据
 */
export const DATA_DIRECTORY = path.join(os.homedir(), ".wave-code");

/**
 * 应用日志文件路径
 */
export const LOG_FILE = path.join(DATA_DIRECTORY, "app.log");

/**
 * 分页相关常量
 */
export const MESSAGES_PER_PAGE = 20; // 每页显示的消息数量
