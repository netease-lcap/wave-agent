import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryManager } from "@/services/memoryManager";
import { readMemoryFile } from "@/utils/memoryUtils";
import { promises as fs } from "fs";
import path from "path";

// Mock fs module
vi.mock("fs", () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
  },
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
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

  describe("Memory Integration", () => {
    it("should complete memory workflow: add memory and read it back", async () => {
      const memoryManager = createMemoryManager(testWorkdir);

      // Simulate adding memory to empty file
      mockFs.readFile.mockRejectedValueOnce({ code: "ENOENT" }); // File doesn't exist
      mockFs.writeFile.mockResolvedValueOnce(undefined);

      // Add memory
      await memoryManager.addMemory("#这是一个重要的项目设置");

      // Verify file was written with correct content
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        memoryFilePath,
        expect.stringContaining("# Memory"),
        "utf-8",
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        memoryFilePath,
        expect.stringContaining("这是一个重要的项目设置"),
        "utf-8",
      );

      // Simulate reading memory back
      const memoryContent =
        "# Memory\n\n这是AI助手的记忆文件，记录重要信息和上下文。\n\n- 这是一个重要的项目设置\n";
      mockFs.readFile.mockResolvedValueOnce(memoryContent);

      // Read memory
      const result = await readMemoryFile(testWorkdir);

      expect(result).toBe(memoryContent.trim()); // trim to handle any whitespace differences
      expect(mockFs.readFile).toHaveBeenCalledWith(memoryFilePath, "utf-8");
    });

    it("should handle multiple memory entries", async () => {
      const memoryManager = createMemoryManager(testWorkdir);

      // First memory entry
      const firstContent =
        "# Memory\n\n这是AI助手的记忆文件，记录重要信息和上下文。\n";
      mockFs.readFile.mockResolvedValueOnce(firstContent);
      mockFs.writeFile.mockResolvedValueOnce(undefined);

      await memoryManager.addMemory("#第一个记忆");

      // Second memory entry
      const secondContent = firstContent + "\n- 第一个记忆\n";
      mockFs.readFile.mockResolvedValueOnce(secondContent);
      mockFs.writeFile.mockResolvedValueOnce(undefined);

      await memoryManager.addMemory("#第二个记忆");

      // Verify both writes happened
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
      expect(mockFs.writeFile).toHaveBeenNthCalledWith(
        1,
        memoryFilePath,
        expect.stringContaining("第一个记忆"),
        "utf-8",
      );
      expect(mockFs.writeFile).toHaveBeenNthCalledWith(
        2,
        memoryFilePath,
        expect.stringContaining("第二个记忆"),
        "utf-8",
      );
    });

    it("should ignore non-memory messages in integration workflow", async () => {
      const memoryManager = createMemoryManager(testWorkdir);

      await memoryManager.addMemory("这不是记忆消息");
      await memoryManager.addMemory("!这是命令");
      await memoryManager.addMemory("普通聊天消息");

      // Should not have called file operations
      expect(mockFs.readFile).not.toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should handle memory file read errors gracefully in readMemoryFile", async () => {
      // Simulate file doesn't exist
      mockFs.readFile.mockRejectedValue({ code: "ENOENT" });

      const result = await readMemoryFile(testWorkdir);

      expect(result).toBe("");
      expect(mockFs.readFile).toHaveBeenCalledWith(memoryFilePath, "utf-8");
    });

    it("should handle memory file read permission errors in readMemoryFile", async () => {
      // Simulate permission error
      mockFs.readFile.mockRejectedValue(new Error("Permission denied"));

      const result = await readMemoryFile(testWorkdir);

      expect(result).toBe("");
    });
  });
});
