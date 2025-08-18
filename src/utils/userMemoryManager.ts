import { promises as fs } from "fs";
import { logger } from "../utils/logger";
import { USER_MEMORY_FILE, DATA_DIRECTORY } from "../utils/constants";

export interface UserMemoryManager {
  addUserMemory: (message: string) => Promise<void>;
  getUserMemoryContent: () => Promise<string>;
  ensureUserMemoryFile: () => Promise<void>;
}

/**
 * 创建用户级记忆管理器
 */
export function createUserMemoryManager(): UserMemoryManager {
  const ensureUserMemoryFile = async (): Promise<void> => {
    try {
      // 确保数据目录存在
      await fs.mkdir(DATA_DIRECTORY, { recursive: true });

      // 检查用户记忆文件是否存在
      try {
        await fs.access(USER_MEMORY_FILE);
      } catch (error) {
        // 文件不存在，创建新文件
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          const initialContent =
            "# User Memory\n\n这是用户级记忆文件，记录跨项目的重要信息和上下文。\n\n";
          await fs.writeFile(USER_MEMORY_FILE, initialContent, "utf-8");
          logger.info(`Created user memory file: ${USER_MEMORY_FILE}`);
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error("Failed to ensure user memory file:", error);
      throw new Error(
        `Failed to ensure user memory file: ${(error as Error).message}`,
      );
    }
  };

  const addUserMemory = async (message: string): Promise<void> => {
    try {
      // 确保用户记忆文件存在
      await ensureUserMemoryFile();

      // 格式化记忆条目，使用 - 开头
      const memoryEntry = `- ${message.substring(1).trim()}\n`;

      // 读取现有内容
      const existingContent = await fs.readFile(USER_MEMORY_FILE, "utf-8");

      // 追加新的记忆条目到文件末尾
      const updatedContent = existingContent + memoryEntry;

      // 写入文件
      await fs.writeFile(USER_MEMORY_FILE, updatedContent, "utf-8");

      logger.info(`User memory added to ${USER_MEMORY_FILE}:`, message);
    } catch (error) {
      logger.error("Failed to add user memory:", error);
      throw new Error(`Failed to add user memory: ${(error as Error).message}`);
    }
  };

  const getUserMemoryContent = async (): Promise<string> => {
    try {
      await ensureUserMemoryFile();
      return await fs.readFile(USER_MEMORY_FILE, "utf-8");
    } catch (error) {
      logger.error("Failed to read user memory:", error);
      return "";
    }
  };

  return {
    addUserMemory,
    getUserMemoryContent,
    ensureUserMemoryFile,
  };
}
