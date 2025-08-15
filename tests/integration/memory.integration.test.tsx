import { describe, it, expect, vi, beforeEach } from "vitest";
import { readMemoryFile } from "../../src/utils/memoryUtils";
import { createMemoryManager } from "../../src/utils/memoryManager";
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
vi.mock("../../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockFs = vi.mocked(fs);

describe("Memory Integration", () => {
  const testWorkdir = "/test/workdir";
  const memoryFilePath = path.join(testWorkdir, "LCAP.md");

  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      expect.stringContaining("# LCAP Memory"),
      "utf-8",
    );
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      memoryFilePath,
      expect.stringContaining("这是一个重要的项目设置"),
      "utf-8",
    );

    // Simulate reading memory back
    const memoryContent =
      "# LCAP Memory\n\n这是AI助手的记忆文件，记录重要信息和上下文。\n\n## 2024-01-01 10:00:00\n这是一个重要的项目设置\n";
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
      "# LCAP Memory\n\n这是AI助手的记忆文件，记录重要信息和上下文。\n";
    mockFs.readFile.mockResolvedValueOnce(firstContent);
    mockFs.writeFile.mockResolvedValueOnce(undefined);

    await memoryManager.addMemory("#第一个记忆");

    // Second memory entry
    const secondContent =
      firstContent + "\n## 2024-01-01 10:00:00\n第一个记忆\n";
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

  it("should ignore non-memory messages", async () => {
    const memoryManager = createMemoryManager(testWorkdir);

    await memoryManager.addMemory("这不是记忆消息");
    await memoryManager.addMemory("!这是命令");
    await memoryManager.addMemory("普通聊天消息");

    // Should not have called file operations
    expect(mockFs.readFile).not.toHaveBeenCalled();
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it("should handle memory file read errors gracefully", async () => {
    // Simulate file doesn't exist
    mockFs.readFile.mockRejectedValue({ code: "ENOENT" });

    const result = await readMemoryFile(testWorkdir);

    expect(result).toBe("");
    expect(mockFs.readFile).toHaveBeenCalledWith(memoryFilePath, "utf-8");
  });

  it("should handle memory file read permission errors", async () => {
    // Simulate permission error
    mockFs.readFile.mockRejectedValue(new Error("Permission denied"));

    const result = await readMemoryFile(testWorkdir);

    expect(result).toBe("");
  });
});
