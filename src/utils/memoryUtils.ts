import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";

/**
 * 读取LCAP.md记忆文件内容
 * @returns 记忆文件内容，如果文件不存在则返回空字符串
 */
export async function readMemoryFile(): Promise<string> {
  const memoryFilePath = path.join(process.cwd(), "LCAP.md");

  try {
    const content = await fs.readFile(memoryFilePath, "utf-8");
    return content.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // 文件不存在，返回空字符串
      return "";
    }
    logger.error("Failed to read memory file:", error);
    return "";
  }
}

/**
 * 检查记忆文件是否存在
 * @returns 是否存在记忆文件
 */
export async function hasMemoryFile(): Promise<boolean> {
  const memoryFilePath = path.join(process.cwd(), "LCAP.md");

  try {
    await fs.access(memoryFilePath);
    return true;
  } catch {
    return false;
  }
}
