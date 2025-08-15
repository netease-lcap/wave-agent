import { promises as fs } from "fs";
import path from "path";
import { logger } from "../utils/logger";

export interface MemoryManager {
  addMemory: (message: string) => Promise<void>;
  isMemoryMessage: (message: string) => boolean;
}

/**
 * 创建记忆管理器
 * @param workdir 工作目录
 * @returns 记忆管理器实例
 */
export function createMemoryManager(workdir: string): MemoryManager {
  const memoryFilePath = path.join(workdir, "LCAP.md");

  const isMemoryMessage = (message: string): boolean => {
    return message.trim().startsWith("#");
  };

  const addMemory = async (message: string): Promise<void> => {
    if (!isMemoryMessage(message)) {
      return;
    }

    try {
      // 格式化记忆条目，使用 - 开头，不添加时间戳
      const memoryEntry = `- ${message.substring(1).trim()}\n`;

      // 检查文件是否存在
      let existingContent = "";
      try {
        existingContent = await fs.readFile(memoryFilePath, "utf-8");
      } catch (error) {
        // 文件不存在，创建新文件
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          existingContent =
            "# LCAP Memory\n\n这是AI助手的记忆文件，记录重要信息和上下文。\n\n";
        } else {
          throw error;
        }
      }

      // 追加新的记忆条目到文件末尾
      const updatedContent = existingContent + memoryEntry;

      // 写入文件
      await fs.writeFile(memoryFilePath, updatedContent, "utf-8");

      logger.info(`Memory added to ${memoryFilePath}:`, message);
    } catch (error) {
      logger.error("Failed to add memory:", error);
      throw new Error(`Failed to add memory: ${(error as Error).message}`);
    }
  };

  return {
    addMemory,
    isMemoryMessage,
  };
}
