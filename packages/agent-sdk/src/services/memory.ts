import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { USER_MEMORY_FILE, DATA_DIRECTORY } from "../utils/constants.js";
import { logger } from "../utils/globalLogger.js";
import { Container } from "../utils/container.js";
import { getGitCommonDir } from "../utils/gitUtils.js";
import { pathEncoder } from "../utils/pathEncoder.js";

export class MemoryService {
  private _cachedProjectMemory: string = "";
  private _cachedUserMemory: string = "";
  private _cachedCombinedMemory: string | null = null;

  constructor(private container: Container) {}

  public get cachedProjectMemory(): string {
    return this._cachedProjectMemory;
  }

  public get cachedUserMemory(): string {
    return this._cachedUserMemory;
  }

  public clearCache(): void {
    this._cachedProjectMemory = "";
    this._cachedUserMemory = "";
    this._cachedCombinedMemory = null;
  }

  /**
   * Get the project-specific auto-memory directory.
   * Uses the git common directory to ensure worktrees share the same memory.
   */
  getAutoMemoryDirectory(workdir: string): string {
    const commonDir = getGitCommonDir(workdir);
    // If the common directory is a .git directory, use its parent as the project root
    // for a cleaner encoded name while maintaining stability across worktrees.
    const projectRoot =
      path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
    const encodedName = pathEncoder.encodeSync(projectRoot);
    return path.join(homedir(), ".wave", "projects", encodedName, "memory");
  }

  /**
   * Ensure the auto-memory directory and initial MEMORY.md exist.
   */
  async ensureAutoMemoryDirectory(workdir: string): Promise<void> {
    const memoryDir = this.getAutoMemoryDirectory(workdir);
    const memoryFile = path.join(memoryDir, "MEMORY.md");

    try {
      await fs.mkdir(memoryDir, { recursive: true });

      try {
        await fs.access(memoryFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          const initialContent =
            "# Project Memory\n\nThis file serves as an index for the project's auto-memory. Wave uses this to track knowledge across sessions.\n\n";
          await fs.writeFile(memoryFile, initialContent, "utf-8");
          logger.debug(`Created auto-memory file: ${memoryFile}`);
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error("Failed to ensure auto-memory directory:", error);
      throw new Error(
        `Failed to ensure auto-memory directory: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get the first 200 lines of MEMORY.md.
   */
  async getAutoMemoryContent(workdir: string): Promise<string> {
    const memoryDir = this.getAutoMemoryDirectory(workdir);
    const memoryFile = path.join(memoryDir, "MEMORY.md");

    try {
      const content = await fs.readFile(memoryFile, "utf-8");
      const lines = content.split("\n").slice(0, 200);
      return lines.join("\n");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      logger.error("Failed to read auto-memory content:", error);
      return "";
    }
  }

  async ensureUserMemoryFile(): Promise<void> {
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
  }

  async getUserMemoryContent(): Promise<string> {
    try {
      await this.ensureUserMemoryFile();
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
  }

  async readMemoryFile(workdir: string): Promise<string> {
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
  }

  async getCombinedMemoryContent(workdir: string): Promise<string> {
    if (this._cachedCombinedMemory !== null) {
      return this._cachedCombinedMemory;
    }
    this._cachedProjectMemory = await this.readMemoryFile(workdir);
    this._cachedUserMemory = await this.getUserMemoryContent();

    let combined = "";
    if (this._cachedProjectMemory.trim()) combined += this._cachedProjectMemory;
    if (this._cachedUserMemory.trim()) {
      if (combined) combined += "\n\n";
      combined += this._cachedUserMemory;
    }
    this._cachedCombinedMemory = combined;
    return combined;
  }
}
