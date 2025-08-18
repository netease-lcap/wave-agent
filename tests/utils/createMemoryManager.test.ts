import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryManager } from "../../src/utils/memoryManager";
import { promises as fs } from "fs";
import path from "path";

// Mock fs module
vi.mock("fs", () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

// Mock logger
vi.mock("../../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFs = vi.mocked(fs);

describe("createMemoryManager", () => {
  const testWorkdir = "/test/workdir";
  const memoryFilePath = path.join(testWorkdir, "LCAP.md");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isMemoryMessage", () => {
    it("should return true for messages starting with #", () => {
      const memoryManager = createMemoryManager(testWorkdir);

      expect(memoryManager.isMemoryMessage("#这是一个记忆")).toBe(true);
      expect(memoryManager.isMemoryMessage("# 这是另一个记忆")).toBe(true);
      expect(memoryManager.isMemoryMessage("#记忆")).toBe(true);
    });

    it("should return false for messages not starting with #", () => {
      const memoryManager = createMemoryManager(testWorkdir);

      expect(memoryManager.isMemoryMessage("这不是记忆")).toBe(false);
      expect(memoryManager.isMemoryMessage("!命令")).toBe(false);
      expect(memoryManager.isMemoryMessage("普通消息")).toBe(false);
      expect(memoryManager.isMemoryMessage("")).toBe(false);
    });
  });

  describe("addMemory", () => {
    it("should not process non-memory messages", async () => {
      const memoryManager = createMemoryManager(testWorkdir);

      await memoryManager.addMemory("普通消息");

      expect(mockFs.readFile).not.toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should create new memory file if it doesn't exist", async () => {
      const memoryManager = createMemoryManager(testWorkdir);

      // Mock file not existing
      mockFs.readFile.mockRejectedValue({ code: "ENOENT" });
      mockFs.writeFile.mockResolvedValue(undefined);

      await memoryManager.addMemory("#新的记忆");

      expect(mockFs.readFile).toHaveBeenCalledWith(memoryFilePath, "utf-8");
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        memoryFilePath,
        expect.stringContaining("# Memory"),
        "utf-8",
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        memoryFilePath,
        expect.stringContaining("- 新的记忆"),
        "utf-8",
      );
    });

    it("should append to existing memory file", async () => {
      const memoryManager = createMemoryManager(testWorkdir);

      const existingContent = "# Memory\n\n这是AI助手的记忆文件。\n- 旧记忆\n";
      mockFs.readFile.mockResolvedValue(existingContent);
      mockFs.writeFile.mockResolvedValue(undefined);

      await memoryManager.addMemory("#新记忆");

      expect(mockFs.readFile).toHaveBeenCalledWith(memoryFilePath, "utf-8");
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        memoryFilePath,
        expect.stringContaining(existingContent),
        "utf-8",
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        memoryFilePath,
        expect.stringContaining("- 新记忆"),
        "utf-8",
      );
    });

    it("should handle file read errors", async () => {
      const memoryManager = createMemoryManager(testWorkdir);

      mockFs.readFile.mockRejectedValue(new Error("Permission denied"));

      await expect(memoryManager.addMemory("#新记忆")).rejects.toThrow(
        "Failed to add memory",
      );
    });

    it("should handle file write errors", async () => {
      const memoryManager = createMemoryManager(testWorkdir);

      mockFs.readFile.mockRejectedValue({ code: "ENOENT" });
      mockFs.writeFile.mockRejectedValue(new Error("Disk full"));

      await expect(memoryManager.addMemory("#新记忆")).rejects.toThrow(
        "Failed to add memory",
      );
    });
  });
});
