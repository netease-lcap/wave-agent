import { vi } from "vitest";
import type { FileTreeNode } from "../../src/types/common";

/**
 * FileManager Mock
 *
 * 这个 mock 提供了完整的 FileManager 接口实现，但不执行真实的文件操作。
 * 用于测试中避免文件系统 I/O 开销，提升测试性能。
 *
 * 使用方法：
 *
 * 推荐使用 vi.hoisted 和动态导入：
 * ```typescript
 * await vi.hoisted(async () => {
 *   const { setupFileManagerMock } = await import("../mocks/fileManagerMock");
 *   setupFileManagerMock();
 * });
 * ```
 *
 * 或者使用预制的工厂函数：
 * ```typescript
 * import { createFileManagerMock } from "../mocks/fileManagerMock";
 * vi.mock("../../src/services/fileManager", () => createFileManagerMock());
 * ```
 */

/**
 * FileManager 回调接口
 */
export interface FileManagerCallbacks {
  onFlatFilesChange: (files: FileTreeNode[]) => void;
}

/**
 * 安全配置接口
 */
export interface SafetyConfig {
  maxFileCount: number;
  maxFileSize: number;
}

/**
 * Mock FileManager 类
 * 提供完整的 FileManager 接口实现，但不执行真实的文件操作
 */
export class MockFileManager {
  private state = {
    flatFiles: [] as FileTreeNode[],
    workdir: "",
  };
  private callbacks: FileManagerCallbacks;

  constructor(workdir: string, callbacks: FileManagerCallbacks) {
    this.state.workdir = workdir;
    this.callbacks = callbacks;
  }

  getState() {
    return { ...this.state };
  }

  getSafetyConfig(): SafetyConfig {
    return {
      maxFileCount: 10000,
      maxFileSize: 1024 * 1024,
    };
  }

  getFlatFiles() {
    return [...this.state.flatFiles];
  }

  setFlatFiles(files: FileTreeNode[]) {
    this.state.flatFiles = files;
    this.callbacks.onFlatFilesChange(files);
  }

  updateFlatFiles(updater: (files: FileTreeNode[]) => FileTreeNode[]) {
    const newFiles = updater(this.state.flatFiles);
    this.setFlatFiles(newFiles);
  }

  updateFileFilter() {
    // Mock implementation - do nothing
  }

  async syncFilesFromDisk() {
    // Mock implementation - don't actually read files
    this.setFlatFiles([]);
  }

  writeFileToMemory() {
    // Mock implementation
  }

  createFileInMemory() {
    // Mock implementation
  }

  deleteFileFromMemory() {
    // Mock implementation
  }

  readFileFromMemory() {
    return null;
  }

  async initialize() {
    // Mock implementation - don't actually initialize
    await this.syncFilesFromDisk();
  }

  startWatching() {
    // Mock implementation - don't actually watch files
  }

  stopWatching() {
    // Mock implementation
  }

  async cleanup() {
    // Mock implementation
  }
}

/**
 * 默认的安全配置
 */
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  maxFileCount: 10000,
  maxFileSize: 1024 * 1024,
};

/**
 * 创建 fileManager mock
 * 返回可以直接用于 vi.mock() 的对象
 *
 * 使用示例：
 * vi.mock("../../src/services/fileManager", () => createFileManagerMock());
 */
export const createFileManagerMock = () => ({
  FileManager: MockFileManager,
  isDangerousDirectory: vi.fn(() => false),
  DEFAULT_SAFETY_CONFIG,
  DANGEROUS_PATHS: {
    unix: [],
    windows: [],
  },
});

/**
 * 设置 fileManager mock
 * 使用 vi.doMock 来设置 mock，适用于 vi.hoisted 场景
 */
export const setupFileManagerMock = () => {
  vi.doMock("../../src/services/fileManager", () => createFileManagerMock());
};
