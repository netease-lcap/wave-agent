import { promises as fs } from "fs";
import path from "path";
import {
  USER_MEMORY_FILE,
  DATA_DIRECTORY,
  PROJECTS_DIRECTORY,
} from "../utils/constants.js";
import { logger } from "../utils/globalLogger.js";
import { getGitRepoRoot } from "../utils/gitUtils.js";
import { pathEncoder } from "../utils/pathEncoder.js";

// Project memory related methods
/**
 * Get the auto-memory directory for a given working directory
 * @param workdir - Working directory to find the auto-memory directory for
 * @returns Promise resolving to the auto-memory directory path
 */
const getAutoMemoryDir = async (workdir: string): Promise<string> => {
  const repoRoot = getGitRepoRoot(workdir);
  const rootToEncode = repoRoot || workdir;
  const encodedPath = await pathEncoder.encode(rootToEncode);
  return path.join(PROJECTS_DIRECTORY, encodedPath, "memory");
};

/**
 * Get the auto-memory content from the memory directory
 * @param memoryDir - Auto-memory directory path
 * @returns Promise resolving to the first 200 lines of MEMORY.md
 */
const getAutoMemoryContent = async (memoryDir: string): Promise<string> => {
  const memoryFilePath = path.join(memoryDir, "MEMORY.md");
  try {
    const content = await fs.readFile(memoryFilePath, "utf-8");
    const lines = content.split("\n");
    if (lines.length > 200) {
      return lines.slice(0, 200).join("\n");
    }
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    logger.error("Failed to read auto-memory file", { memoryFilePath, error });
    return "";
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
/**
 * @deprecated Use MemoryService.combinedMemoryContent instead
 */
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

export class MemoryService {
  private _autoMemoryDir: string = "";
  private _autoMemoryContent: string = "";
  private _projectMemoryContent: string = "";
  private _userMemoryContent: string = "";
  private _autoMemoryEnabled: boolean = false;

  async initialize(workdir: string, autoMemoryEnabled: boolean): Promise<void> {
    this._autoMemoryEnabled = autoMemoryEnabled;
    this._projectMemoryContent = await readMemoryFile(workdir);
    this._userMemoryContent = await getUserMemoryContent();

    if (autoMemoryEnabled) {
      this._autoMemoryDir = await getAutoMemoryDir(workdir);
      this._autoMemoryContent = await getAutoMemoryContent(this._autoMemoryDir);
    }
  }

  get autoMemoryDir(): string {
    return this._autoMemoryDir;
  }

  get autoMemoryContent(): string {
    return this._autoMemoryContent;
  }

  get projectMemoryContent(): string {
    return this._projectMemoryContent;
  }

  get userMemoryContent(): string {
    return this._userMemoryContent;
  }

  get autoMemoryEnabled(): boolean {
    return this._autoMemoryEnabled;
  }

  get combinedMemoryContent(): string {
    let combined = "";
    if (this._projectMemoryContent.trim()) {
      combined += this._projectMemoryContent;
    }
    if (this._userMemoryContent.trim()) {
      if (combined) {
        combined += "\n\n";
      }
      combined += this._userMemoryContent;
    }
    return combined;
  }
}
