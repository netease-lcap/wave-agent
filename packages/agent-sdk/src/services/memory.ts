import { promises as fs } from "fs";
import path from "path";
import { USER_MEMORY_FILE, DATA_DIRECTORY } from "../utils/constants.js";
import { logger } from "../utils/globalLogger.js";

// Project memory related methods
// User memory related methods
export const ensureUserMemoryFile = async (): Promise<void> => {
  try {
    // Ensure data directory exists
    await fs.mkdir(DATA_DIRECTORY, { recursive: true });

    // Check if user memory file exists
    try {
      await fs.access(USER_MEMORY_FILE);
    } catch (error) {
      // File does not exist, create new file
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.info("Creating new user memory file", {
          userMemoryFile: USER_MEMORY_FILE,
        });
        const initialContent =
          "# User Memory\n\nThis is the user-level memory file, recording important information and context across projects.\n\n";
        await fs.writeFile(USER_MEMORY_FILE, initialContent, "utf-8");
        logger.debug(`Created user memory file: ${USER_MEMORY_FILE}`);
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

export const getUserMemoryContent = async (): Promise<string> => {
  try {
    await ensureUserMemoryFile();
    const content = await fs.readFile(USER_MEMORY_FILE, "utf-8");
    logger.debug("User memory content read successfully", {
      userMemoryFile: USER_MEMORY_FILE,
      contentLength: content.length,
    });
    return content;
  } catch (error) {
    logger.error("Failed to read user memory:", error);
    return "";
  }
};

// Read project memory file content
export const readMemoryFile = async (workdir: string): Promise<string> => {
  const memoryFilePath = path.join(workdir, "AGENTS.md");

  // Direct file access
  try {
    const content = await fs.readFile(memoryFilePath, "utf-8");
    logger.debug("Memory file read successfully via direct file access", {
      memoryFilePath,
      contentLength: content.length,
    });
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.debug("Memory file does not exist, returning empty content", {
        memoryFilePath,
      });
      return "";
    }
    logger.error("Failed to read memory file", { memoryFilePath, error });
    return "";
  }
};

// Get merged memory content (project memory + user memory)
export const getCombinedMemoryContent = async (
  workdir: string,
): Promise<string> => {
  // Read memory file content
  const memoryContent = await readMemoryFile(workdir);

  // Read user-level memory content
  const userMemoryContent = await getUserMemoryContent();

  // Merge project memory and user memory
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
