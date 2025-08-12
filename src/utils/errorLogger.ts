import * as fs from "fs";
import path from "path";
import { logger } from "./logger";
import { ERROR_LOG_DIRECTORY } from "./constants";
import { ChatCompletionMessageParam } from "../types/common";

/**
 * 错误日志数据结构
 */
interface ErrorLogData {
  timestamp: string;
  sessionId: string;
  error: {
    message: string;
    stack?: string;
    name?: string;
  };
  recursionDepth: number;
  context: {
    sentMessages: ChatCompletionMessageParam[]; // 发送给AI的ChatCompletionMessageParam[]
  };
  environment: {
    nodeVersion: string;
    platform: string;
    workdir: string;
  };
}

/**
 * 保存AI服务错误时发送给AI的参数到JSON文件
 * @param error 错误对象
 * @param sessionId 会话ID
 * @param workdir 工作目录
 * @param sentMessages 发送给AI的消息列表
 * @param recursionDepth 递归深度
 */
export async function saveErrorLog(
  error: Error | unknown,
  sessionId: string,
  workdir: string,
  sentMessages: ChatCompletionMessageParam[], // 发送给AI的ChatCompletionMessageParam[]
  recursionDepth: number = 0,
): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    // 构建错误日志数据 - 保存发送给AI的原始参数
    const errorLogData: ErrorLogData = {
      timestamp,
      sessionId,
      error: {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      },
      recursionDepth,
      context: {
        sentMessages: sentMessages, // 直接保存发送给AI的消息
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        workdir,
      },
    };

    // 保存到应用数据目录下的error-logs子目录
    const errorLogDir = ERROR_LOG_DIRECTORY;
    await fs.promises.mkdir(errorLogDir, { recursive: true });

    const errorLogPath = path.join(
      errorLogDir,
      `error-${timestamp.replace(/[:.]/g, "-")}.json`,
    );
    await fs.promises.writeFile(
      errorLogPath,
      JSON.stringify(errorLogData, null, 2),
      "utf-8",
    );

    logger.info(`Error log saved to: ${errorLogPath}`);
  } catch (saveError) {
    logger.error("Failed to save error log:", saveError);
  }
}
