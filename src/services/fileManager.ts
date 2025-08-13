import { isBinary } from "../types/common";
import type { FileTreeNode } from "../types/common";
import * as fs from "fs";
import * as path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { createFileFilter } from "../utils/fileFilter";
import { flattenFiles } from "../utils/flattenFiles";
import { scanDirectory } from "../utils/scanDirectory";
import { mcpToolManager } from "../utils/mcpToolManager";
import { logger } from "../utils/logger";

export interface FileManagerCallbacks {
  onFlatFilesChange: (files: FileTreeNode[]) => void;
}

export interface FileManagerState {
  flatFiles: FileTreeNode[];
  workdir: string;
}

export class FileManager {
  private state: FileManagerState;
  private callbacks: FileManagerCallbacks;
  private watcher: FSWatcher | null = null;
  private fileFilter: ReturnType<typeof createFileFilter>;
  private ignorePatterns?: string[];

  constructor(
    workdir: string,
    callbacks: FileManagerCallbacks,
    ignorePatterns?: string[],
  ) {
    this.state = {
      flatFiles: [],
      workdir,
    };
    this.callbacks = callbacks;
    this.ignorePatterns = ignorePatterns;
    this.fileFilter = createFileFilter(workdir, ignorePatterns);
  }

  public getState(): FileManagerState {
    return { ...this.state };
  }

  public getFlatFiles(): FileTreeNode[] {
    return [...this.state.flatFiles];
  }

  public setFlatFiles(files: FileTreeNode[]): void {
    this.state.flatFiles = files;
    this.callbacks.onFlatFilesChange(files);
  }

  public updateFlatFiles(
    updater: (files: FileTreeNode[]) => FileTreeNode[],
  ): void {
    const newFiles = updater(this.state.flatFiles);
    this.setFlatFiles(newFiles);
  }

  public updateFileFilter(workdir?: string, ignorePatterns?: string[]): void {
    if (workdir) {
      this.state.workdir = workdir;
    }
    if (ignorePatterns !== undefined) {
      this.ignorePatterns = ignorePatterns;
    }
    this.fileFilter = createFileFilter(this.state.workdir, this.ignorePatterns);
  }

  public async syncFilesFromDisk(): Promise<void> {
    try {
      const fileTree = await scanDirectory(this.state.workdir, this.fileFilter);
      const flatFilesResult = flattenFiles(fileTree);
      this.setFlatFiles(flatFilesResult);
    } catch (error) {
      logger.error("Error syncing files from disk:", error);
      this.setFlatFiles([]);
    }
  }

  // 写入文件内容到内存中的文件树（不会写入磁盘）
  public writeFileToMemory(filePath: string, content: string): void {
    this.updateFlatFiles((prevFlatFiles) => {
      return prevFlatFiles.map((file) =>
        file.path === filePath ? { ...file, code: content } : file,
      );
    });
  }

  // 添加文件到树中
  public createFileInMemory(
    targetPath: string,
    isDirectory: boolean,
    content?: string,
  ): void {
    try {
      const fullPath = path.join(this.state.workdir, targetPath);

      // Check if should be ignored
      if (this.fileFilter.shouldIgnore(fullPath, isDirectory)) {
        return;
      }

      if (!isDirectory) {
        // 对于二进制文件，不设置内容，只添加文件节点
        const fileContent = isBinary(targetPath) ? "" : content || "";

        // 直接添加到flatFiles中
        this.updateFlatFiles((prevFlatFiles) => {
          // 检查文件是否已存在，如果存在则更新，否则添加
          const existingIndex = prevFlatFiles.findIndex(
            (f) => f.path === targetPath,
          );
          if (existingIndex >= 0) {
            const newFlatFiles = [...prevFlatFiles];
            newFlatFiles[existingIndex] = {
              ...newFlatFiles[existingIndex],
              code: fileContent,
              isBinary: isBinary(targetPath),
            };
            return newFlatFiles;
          } else {
            return [
              ...prevFlatFiles,
              {
                label: path.basename(targetPath),
                path: targetPath,
                code: fileContent,
                children: [],
                isBinary: isBinary(targetPath),
              },
            ];
          }
        });
      }
      // 目录不需要添加到flatFiles中
    } catch (error) {
      logger.error("Error adding file to tree:", error);
    }
  }

  // 从内存中的文件树删除文件（不会删除磁盘文件）
  public deleteFileFromMemory(filePath: string): void {
    this.updateFlatFiles((prevFlatFiles) => {
      return prevFlatFiles.filter(
        (file) =>
          !file.path.startsWith(filePath + "/") && file.path !== filePath,
      );
    });
  }

  // 从内存中的文件树读取文件内容（不会访问磁盘）
  public readFileFromMemory(path: string): string | null {
    const file = this.state.flatFiles.find((f) => f.path === path);
    return file ? file.code : null;
  }

  public async initialize(): Promise<void> {
    await this.syncFilesFromDisk();

    // Initialize MCP tools
    try {
      await mcpToolManager.initialize(this.state.workdir);
    } catch (error) {
      logger.warn(
        "Failed to initialize MCP tools:",
        error instanceof Error ? error.name : "Unknown error",
      );
    }
  }

  public startWatching(): void {
    if (this.watcher) {
      this.stopWatching();
    }

    const watcher = chokidar.watch(this.state.workdir, {
      ignored: (filePath) => {
        return this.fileFilter.shouldIgnore(
          filePath,
          fs.existsSync(filePath) && fs.statSync(filePath).isDirectory(),
        );
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher = watcher;

    watcher
      .on("add", async (filePath) => {
        const relativePath = path.relative(this.state.workdir, filePath);
        logger.debug(`File ${relativePath} has been added`);

        try {
          if (isBinary(relativePath)) {
            // 对于二进制文件，不读取内容，只添加节点
            this.createFileInMemory(relativePath, false, "");
          } else {
            // 对于文本文件，读取内容
            const content = await fs.promises.readFile(filePath, "utf-8");
            this.createFileInMemory(relativePath, false, content);
          }
        } catch (error) {
          logger.error("Error reading added file:", error);
        }
      })
      .on("change", async (filePath) => {
        const relativePath = path.relative(this.state.workdir, filePath);
        logger.debug(`File ${relativePath} has been changed`);

        try {
          if (isBinary(relativePath)) {
            // 对于二进制文件，不读取内容，只更新节点（但内容保持为空）
            this.writeFileToMemory(relativePath, "");
          } else {
            // 对于文本文件，读取内容
            const content = await fs.promises.readFile(filePath, "utf-8");
            this.writeFileToMemory(relativePath, content);
          }
        } catch (error) {
          logger.error("Error reading changed file:", error);
        }
      })
      .on("unlink", (filePath) => {
        const relativePath = path.relative(this.state.workdir, filePath);
        logger.debug(`File ${relativePath} has been removed`);
        this.deleteFileFromMemory(relativePath);
      })
      .on("addDir", (dirPath) => {
        const relativePath = path.relative(this.state.workdir, dirPath);
        logger.debug(`Directory ${relativePath} has been added`);
        this.createFileInMemory(relativePath, true);
      })
      .on("unlinkDir", (dirPath) => {
        const relativePath = path.relative(this.state.workdir, dirPath);
        logger.debug(`Directory ${relativePath} has been removed`);
        this.deleteFileFromMemory(relativePath);
      })
      .on("error", (error) => {
        logger.error(`Watcher error: ${error}`);
      });

    this.watcher = watcher;
  }

  public stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  public async cleanup(): Promise<void> {
    this.stopWatching();

    // Cleanup MCP connections
    try {
      await mcpToolManager.disconnect();
    } catch (error) {
      logger.error("Error disconnecting MCP tools:", error);
    }
  }
}
