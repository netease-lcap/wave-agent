import { promises as fs } from "fs";
import path from "path";
import { USER_MEMORY_FILE, DATA_DIRECTORY } from "../utils/constants.js";
import { MemoryStoreService } from "./memoryStore.js";

// Global memory store instance for project memory files
let globalMemoryStore: MemoryStoreService | null = null;

/**
 * Initialize global memory store
 */
export const initializeMemoryStore = (
  memoryStore: MemoryStoreService,
): void => {
  globalMemoryStore = memoryStore;
};

/**
 * Get current memory store instance
 */
export const getMemoryStore = (): MemoryStoreService | null => {
  return globalMemoryStore;
};

// Project memory related methods
export const isMemoryMessage = (message: string): boolean => {
  return message.trim().startsWith("#");
};

export const addMemory = async (
  message: string,
  workdir: string,
): Promise<void> => {
  if (!isMemoryMessage(message)) {
    return;
  }

  try {
    const memoryFilePath = path.join(workdir, "AGENTS.md");

    // Format memory entry, starting with -, no timestamp
    const memoryEntry = `- ${message.substring(1).trim()}\n`;

    // Check if file exists
    let existingContent = "";
    try {
      existingContent = await fs.readFile(memoryFilePath, "utf-8");
    } catch (error) {
      // File does not exist, create new file
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        existingContent =
          "# Memory\n\nThis is the AI assistant's memory file, recording important information and context.\n\n";
      } else {
        throw error;
      }
    }

    // Append new memory entry to the end of the file
    const updatedContent = existingContent + memoryEntry;

    // Write file
    await fs.writeFile(memoryFilePath, updatedContent, "utf-8");

    // Update memory store if available
    if (globalMemoryStore) {
      try {
        await globalMemoryStore.updateContent(memoryFilePath);
      } catch (error) {
        console.warn(
          `Failed to update memory store for ${memoryFilePath}:`,
          error,
        );
      }
    }

    // logger.debug(`Memory added to ${memoryFilePath}:`, message);
  } catch (error) {
    // logger.error("Failed to add memory:", error);
    throw new Error(`Failed to add memory: ${(error as Error).message}`);
  }
};

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
        const initialContent =
          "# User Memory\n\nThis is the user-level memory file, recording important information and context across projects.\n\n";
        await fs.writeFile(USER_MEMORY_FILE, initialContent, "utf-8");
        // logger.debug(`Created user memory file: ${USER_MEMORY_FILE}`);
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
    // Ensure user memory file exists
    await ensureUserMemoryFile();

    // Format memory entry, starting with -
    const memoryEntry = `- ${message.substring(1).trim()}\n`;

    // Read existing content
    const existingContent = await fs.readFile(USER_MEMORY_FILE, "utf-8");

    // Append new memory entry to the end of the file
    const updatedContent = existingContent + memoryEntry;

    // Write file
    await fs.writeFile(USER_MEMORY_FILE, updatedContent, "utf-8");

    // logger.debug(`User memory added to ${USER_MEMORY_FILE}:`, message);
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

// Read project memory file content with memory store optimization
export const readMemoryFile = async (workdir: string): Promise<string> => {
  const memoryFilePath = path.join(workdir, "AGENTS.md");

  // Use memory store if available for optimized access
  if (globalMemoryStore) {
    try {
      return await globalMemoryStore.getContent(memoryFilePath);
    } catch (error) {
      // Fallback to direct file access on memory store error
      console.warn(
        `Memory store access failed for ${memoryFilePath}, falling back to file system:`,
        error,
      );
    }
  }

  // Fallback to direct file access (original behavior)
  try {
    return await fs.readFile(memoryFilePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
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
