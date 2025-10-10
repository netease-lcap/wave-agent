import { promises as fs } from "fs";
import path from "path";
import { USER_MEMORY_FILE, DATA_DIRECTORY } from "../utils/constants.js";

// 项目内存相关方法
export const isMemoryMessage = (message: string): boolean => {
  return message.trim().startsWith("#");
};

export const addMemory = async (message: string): Promise<void> => {
  if (!isMemoryMessage(message)) {
    return;
  }

  try {
    const memoryFilePath = path.join(process.cwd(), "WAVE.md");

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
          "# Memory\n\n这是AI助手的记忆文件，记录重要信息和上下文。\n\n";
      } else {
        throw error;
      }
    }

    // 追加新的记忆条目到文件末尾
    const updatedContent = existingContent + memoryEntry;

    // 写入文件
    await fs.writeFile(memoryFilePath, updatedContent, "utf-8");

    // logger.info(`Memory added to ${memoryFilePath}:`, message);
  } catch (error) {
    // logger.error("Failed to add memory:", error);
    throw new Error(`Failed to add memory: ${(error as Error).message}`);
  }
};

// 用户内存相关方法
export const ensureUserMemoryFile = async (): Promise<void> => {
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
        // logger.info(`Created user memory file: ${USER_MEMORY_FILE}`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    // logger.error("Failed to ensure user memory file:", error);
    throw new Error(
      `Failed to ensure user memory file: ${(error as Error).message}`,
    );
  }
};

export const addUserMemory = async (message: string): Promise<void> => {
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

    // logger.info(`User memory added to ${USER_MEMORY_FILE}:`, message);
  } catch (error) {
    // logger.error("Failed to add user memory:", error);
    throw new Error(`Failed to add user memory: ${(error as Error).message}`);
  }
};

export const getUserMemoryContent = async (): Promise<string> => {
  try {
    await ensureUserMemoryFile();
    return await fs.readFile(USER_MEMORY_FILE, "utf-8");
  } catch {
    // logger.error("Failed to read user memory:", error);
    return "";
  }
};

// 读取项目记忆文件内容
export const readMemoryFile = async (): Promise<string> => {
  try {
    const memoryFilePath = path.join(process.cwd(), "WAVE.md");
    return await fs.readFile(memoryFilePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
};

// 获取合并的记忆内容（项目记忆 + 用户记忆）
export const getCombinedMemoryContent = async (): Promise<string> => {
  // 读取记忆文件内容
  const memoryContent = await readMemoryFile();

  // 读取用户级记忆内容
  const userMemoryContent = await getUserMemoryContent();

  // 合并项目记忆和用户记忆
  let combinedMemory = "";
  if (memoryContent.trim()) {
    combinedMemory += memoryContent;
  }
  if (userMemoryContent.trim()) {
    if (combinedMemory) {
      combinedMemory += "\n\n";
    }
    combinedMemory += userMemoryContent;
  }

  return combinedMemory;
};
