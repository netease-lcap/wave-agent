import type { FileTreeNode } from "../types/common";
import * as fs from "fs";
import * as path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { createFileFilter } from "../utils/fileFilter";
import { flattenFiles } from "../utils/flattenFiles";
import { scanDirectory } from "../utils/scanDirectory";
import { logger } from "../utils/logger";
import { isBinary } from "../types/common";

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
  private safetyConfig: SafetyConfig;

  constructor(
    workdir: string,
    callbacks: FileManagerCallbacks,
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
    this.safetyConfig = { ...DEFAULT_SAFETY_CONFIG, ...safetyConfig };
    this.fileFilter = createFileFilter(workdir);
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

  public updateFileFilter(workdir?: string): void {
    if (workdir) {
      this.state.workdir = workdir;
    }
    this.fileFilter = createFileFilter(this.state.workdir);
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
      // FILE_COUNT_LIMIT错误仍然需要重新抛出，因为这是严重的限制
      if (
        error instanceof Error &&
        error.message.startsWith("FILE_COUNT_LIMIT:")
      ) {
        throw error;
      }
    }
  }

  public async initialize(): Promise<void> {
    await this.syncFilesFromDisk();
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
        logger.debug(`File added: ${filePath}`);
        await this.addFileToFlatFiles(filePath);
      })
      .on("change", async (filePath) => {
        logger.debug(`File changed: ${filePath}`);
        await this.addFileToFlatFiles(filePath); // change 和 add 逻辑相同，都是更新或添加
      })
      .on("unlink", (filePath) => {
        logger.debug(`File removed: ${filePath}`);
        this.removeFileFromFlatFiles(filePath);
      })
      .on("addDir", async (dirPath) => {
        logger.debug(`Directory added: ${dirPath}`);
        await this.addDirToFlatFiles(dirPath);
      })
      .on("unlinkDir", (dirPath) => {
        logger.debug(`Directory removed: ${dirPath}`);
        this.removeDirFromFlatFiles(dirPath);
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
  }

  /**
   * 将绝对路径转换为相对于工作目录的路径
   */
  private getRelativePath(absolutePath: string): string {
    return path.relative(this.state.workdir, absolutePath);
  }

  /**
   * 检查文件是否应该被忽略
   */
  private shouldIgnoreFile(filePath: string, isDirectory: boolean): boolean {
    return this.fileFilter.shouldIgnore(filePath, isDirectory);
  }

  /**
   * 添加单个文件到 flatFiles
   */
  private async addFileToFlatFiles(absolutePath: string): Promise<void> {
    try {
      const relativePath = this.getRelativePath(absolutePath);
      const stats = await fs.promises.stat(absolutePath);

      // 检查是否应该忽略
      if (this.shouldIgnoreFile(absolutePath, stats.isDirectory())) {
        return;
      }

      // 如果是目录，不添加到 flatFiles（只添加文件）
      if (stats.isDirectory()) {
        return;
      }

      // 检查文件大小限制
      if (stats.size > this.safetyConfig.maxFileSize) {
        logger.debug(
          `File ${relativePath} exceeds size limit, marking as oversized`,
        );
      }

      // 检查是否是二进制文件
      const isBinaryFile = isBinary(path.basename(absolutePath));

      const newFile: FileTreeNode = {
        label: path.basename(absolutePath),
        path: relativePath,
        children: [],
        isBinary: isBinaryFile,
        fileSize: stats.size,
        oversized: stats.size > this.safetyConfig.maxFileSize,
      };

      // 检查文件是否已存在
      const existingIndex = this.state.flatFiles.findIndex(
        (file) => file.path === relativePath,
      );

      if (existingIndex >= 0) {
        // 更新现有文件
        this.updateFlatFiles((files) => {
          const updatedFiles = [...files];
          updatedFiles[existingIndex] = newFile;
          return updatedFiles;
        });
      } else {
        // 添加新文件
        this.updateFlatFiles((files) => [...files, newFile]);
      }

      logger.debug(`Added/updated file: ${relativePath}`);
    } catch (error) {
      logger.error(`Error adding file ${absolutePath}:`, error);
    }
  }

  /**
   * 从 flatFiles 中移除文件
   */
  private removeFileFromFlatFiles(absolutePath: string): void {
    const relativePath = this.getRelativePath(absolutePath);

    this.updateFlatFiles((files) => {
      const filteredFiles = files.filter((file) => file.path !== relativePath);
      if (filteredFiles.length !== files.length) {
        logger.debug(`Removed file: ${relativePath}`);
      }
      return filteredFiles;
    });
  }

  /**
   * 移除目录及其所有子文件
   */
  private removeDirFromFlatFiles(absolutePath: string): void {
    const relativePath = this.getRelativePath(absolutePath);
    const dirPrefix = relativePath + path.sep;

    this.updateFlatFiles((files) => {
      const filteredFiles = files.filter((file) => {
        return file.path !== relativePath && !file.path.startsWith(dirPrefix);
      });

      const removedCount = files.length - filteredFiles.length;
      if (removedCount > 0) {
        logger.debug(
          `Removed directory and ${removedCount} files: ${relativePath}`,
        );
      }

      return filteredFiles;
    });
  }

  /**
   * 扫描目录并添加所有文件到 flatFiles
   */
  private async addDirToFlatFiles(absolutePath: string): Promise<void> {
    try {
      // 检查是否应该忽略
      if (this.shouldIgnoreFile(absolutePath, true)) {
        return;
      }

      const context = {
        fileCount: this.state.flatFiles.length,
        maxFileCount: this.safetyConfig.maxFileCount,
        maxFileSize: this.safetyConfig.maxFileSize,
      };

      const relativePath = this.getRelativePath(absolutePath);
      const fileTree = await scanDirectory(
        absolutePath,
        this.fileFilter,
        relativePath,
        context,
      );

      const newFiles = flattenFiles(fileTree);

      this.updateFlatFiles((files) => {
        // 合并新文件，避免重复
        const existingPaths = new Set(files.map((f) => f.path));
        const filesToAdd = newFiles.filter((f) => !existingPaths.has(f.path));

        if (filesToAdd.length > 0) {
          logger.debug(
            `Added directory with ${filesToAdd.length} files: ${relativePath}`,
          );
        }

        return [...files, ...filesToAdd];
      });
    } catch (error) {
      logger.error(`Error adding directory ${absolutePath}:`, error);

      // 如果是文件数量限制错误，重新扫描整个目录
      if (
        error instanceof Error &&
        error.message.startsWith("FILE_COUNT_LIMIT:")
      ) {
        logger.warn("File count limit reached, performing full rescan...");
        await this.syncFilesFromDisk();
      }
    }
  }
}
