import type { FileTreeNode } from "../types/common";
import * as fs from "fs";
import * as path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { createFileFilter } from "../utils/fileFilter";
import { flattenFiles } from "../utils/flattenFiles";
import { scanDirectory } from "../utils/scanDirectory";
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
      .on("add", async () => {
        // 文件变更时重新扫描整个目录结构
        logger.debug("File added, rescanning directory...");
        await this.syncFilesFromDisk();
      })
      .on("change", async () => {
        // 文件变更时重新扫描整个目录结构
        logger.debug("File changed, rescanning directory...");
        await this.syncFilesFromDisk();
      })
      .on("unlink", async () => {
        // 文件删除时重新扫描整个目录结构
        logger.debug("File removed, rescanning directory...");
        await this.syncFilesFromDisk();
      })
      .on("addDir", async () => {
        // 目录添加时重新扫描整个目录结构
        logger.debug("Directory added, rescanning directory...");
        await this.syncFilesFromDisk();
      })
      .on("unlinkDir", async () => {
        // 目录删除时重新扫描整个目录结构
        logger.debug("Directory removed, rescanning directory...");
        await this.syncFilesFromDisk();
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
}
