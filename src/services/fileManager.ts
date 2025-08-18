import { isBinary } from "../types/common";
import type { FileTreeNode } from "../types/common";
import * as fs from "fs";
import * as path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { createFileFilter } from "../utils/fileFilter";
import { flattenFiles } from "../utils/flattenFiles";
import { scanDirectory } from "../utils/scanDirectory";
import { mcpToolManager } from "./mcpToolManager";
import { logger } from "../utils/logger";

// ===== Safety Configuration =====

/**
 * 安全配置接口
 */
export interface SafetyConfig {
  maxFileCount: number; // 最大文件数量，默认 10000
  maxFileSize: number; // 单个文件最大大小（字节），默认 1MB
}

/**
 * 默认安全配置
 */
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  maxFileCount: 10000,
  maxFileSize: 1024 * 1024, // 1MB
};

/**
 * 危险目录列表
 */
export const DANGEROUS_PATHS = {
  // Unix/Linux 系统目录
  unix: [
    "/", // 根目录
    "/home", // 用户目录
    "/Users", // macOS 用户目录
    "/usr", // Unix 系统资源
    "/var", // 变量数据
    "/etc", // 系统配置
    "/bin", // 系统二进制文件
    "/sbin", // 系统管理二进制文件
    "/lib", // 系统库
    "/opt", // 可选软件包
    "/boot", // 启动文件
    "/dev", // 设备文件
    "/proc", // 进程信息
    "/sys", // 系统信息
    "/tmp", // 临时文件
    "/root", // root 用户目录
  ],
  // Windows 系统目录
  windows: [
    "C:\\", // C盘根目录
    "D:\\", // D盘根目录
    "E:\\", // E盘根目录
    "F:\\", // F盘根目录
    "C:\\Windows", // Windows 系统目录
    "C:\\Program Files", // 程序文件目录
    "C:\\Program Files (x86)", // 32位程序文件目录
    "C:\\Users", // 用户目录
    "C:\\ProgramData", // 程序数据目录
    "C:\\System Volume Information", // 系统卷信息
  ],
};

/**
 * 检测是否为危险目录
 * @param dirPath 目录路径
 * @returns 如果是危险目录返回 true
 */
export function isDangerousDirectory(dirPath: string): boolean {
  const normalizedPath = path.resolve(dirPath);
  const isWindows = process.platform === "win32";

  if (isWindows) {
    // Windows 路径检查
    const windowsPath = normalizedPath.replace(/\//g, "\\");
    return DANGEROUS_PATHS.windows.some((dangerousPath) => {
      return (
        windowsPath === dangerousPath ||
        windowsPath === dangerousPath.toLowerCase() ||
        windowsPath === dangerousPath.toUpperCase()
      );
    });
  } else {
    // Unix/Linux/macOS 路径检查
    return DANGEROUS_PATHS.unix.some((dangerousPath) => {
      return normalizedPath === dangerousPath;
    });
  }
}

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
  private safetyConfig: SafetyConfig;

  constructor(
    workdir: string,
    callbacks: FileManagerCallbacks,
    ignorePatterns?: string[],
    safetyConfig?: Partial<SafetyConfig>,
  ) {
    // 危险目录检测 - 最高优先级
    if (isDangerousDirectory(workdir)) {
      throw new Error(
        `DANGEROUS_DIRECTORY: Cannot open directory "${workdir}" for security reasons. Please select a project directory instead.`,
      );
    }

    this.state = {
      flatFiles: [],
      workdir,
    };
    this.callbacks = callbacks;
    this.ignorePatterns = ignorePatterns;
    this.safetyConfig = { ...DEFAULT_SAFETY_CONFIG, ...safetyConfig };
    this.fileFilter = createFileFilter(workdir, ignorePatterns);
  }

  public getState(): FileManagerState {
    return { ...this.state };
  }

  public getSafetyConfig(): SafetyConfig {
    return { ...this.safetyConfig };
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
      const context = {
        fileCount: 0,
        maxFileCount: this.safetyConfig.maxFileCount,
        maxFileSize: this.safetyConfig.maxFileSize,
      };
      const fileTree = await scanDirectory(
        this.state.workdir,
        this.fileFilter,
        "",
        context,
      );
      const flatFilesResult = flattenFiles(fileTree);
      this.setFlatFiles(flatFilesResult);
    } catch (error) {
      logger.error("Error syncing files from disk:", error);
      this.setFlatFiles([]);
      // FILE_SIZE_LIMIT错误不再重新抛出，只记录日志
      // FILE_COUNT_LIMIT错误仍然需要重新抛出，因为这是严重的限制
      if (
        error instanceof Error &&
        error.message.startsWith("FILE_COUNT_LIMIT:")
      ) {
        throw error;
      }
      // FILE_SIZE_LIMIT错误已经在scanDirectory中处理，不再需要重新抛出
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
        // 检查文件数量限制
        if (this.state.flatFiles.length >= this.safetyConfig.maxFileCount) {
          throw new Error(
            `FILE_COUNT_LIMIT: Cannot add file "${targetPath}". Maximum file count of ${this.safetyConfig.maxFileCount} reached.`,
          );
        }

        // 对于二进制文件，不设置内容，只添加文件节点
        let fileContent = isBinary(targetPath) ? "" : content || "";
        let oversized = false;

        // 检查文件大小限制（基于内容长度估算）
        let estimatedSize = Buffer.byteLength(fileContent, "utf8");
        if (estimatedSize > this.safetyConfig.maxFileSize) {
          const fileSizeMB = (estimatedSize / (1024 * 1024)).toFixed(2);
          const limitSizeMB = (
            this.safetyConfig.maxFileSize /
            (1024 * 1024)
          ).toFixed(2);

          // 记录警告而非抛出错误
          logger.warn(
            `FILE_SIZE_LIMIT: File "${targetPath}" (${fileSizeMB}MB) exceeds size limit of ${limitSizeMB}MB. Content will be empty.`,
          );

          // 将大文件的内容设置为空
          fileContent = "";
          oversized = true;
          estimatedSize = 0; // 重新计算大小
        }

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
              fileSize: estimatedSize,
              oversized,
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
                fileSize: estimatedSize,
                oversized,
              },
            ];
          }
        });
      }
      // 目录不需要添加到flatFiles中
    } catch (error) {
      logger.error("Error adding file to tree:", error);
      // FILE_COUNT_LIMIT错误仍然需要重新抛出
      if (
        error instanceof Error &&
        error.message.startsWith("FILE_COUNT_LIMIT:")
      ) {
        throw error;
      }
      // FILE_SIZE_LIMIT错误不再重新抛出，已经在上面处理
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
    if (!file) {
      return null;
    }

    // 检查文件是否被标记为超限
    if (file.oversized) {
      throw new Error(
        `FILE_SIZE_LIMIT: File "${path}" is oversized and content cannot be read.`,
      );
    }

    return file.code;
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
    // 在测试环境中跳过文件监听，避免 EventEmitter 内存泄漏警告
    if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
      logger.debug("Skipping file watching in test environment");
      return;
    }

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
