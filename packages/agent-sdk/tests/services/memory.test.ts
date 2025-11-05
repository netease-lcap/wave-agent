import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as memory from "@/services/memory.js";

// Mock the logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the constants
vi.mock("@/utils/constants", () => ({
  USER_MEMORY_FILE: "/mock/user/memory.md",
  DATA_DIRECTORY: "/mock/data",
}));

describe("Memory Module", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Restore all mocks
    vi.restoreAllMocks();
  });

  describe("isMemoryMessage", () => {
    it("should return true for messages starting with #", () => {
      expect(memory.isMemoryMessage("#remember this info")).toBe(true);
      expect(memory.isMemoryMessage("#record this")).toBe(true);
      expect(memory.isMemoryMessage("#save to memory")).toBe(true);
      expect(memory.isMemoryMessage("# add to memory")).toBe(true);
      expect(memory.isMemoryMessage("#remember this")).toBe(true);
    });

    it("should return false for regular messages", () => {
      expect(memory.isMemoryMessage("hello world")).toBe(false);
      expect(memory.isMemoryMessage("remember this info")).toBe(false);
      expect(memory.isMemoryMessage("")).toBe(false);
      expect(memory.isMemoryMessage("not # at start")).toBe(false);
    });
  });

  describe("addMemory", () => {
    it("should add memory to AGENTS.md file for messages starting with #", async () => {
      const message = "#Test memory message";
      await memory.addMemory(message, tempDir);

      const memoryFilePath = path.join(tempDir, "AGENTS.md");
      const content = await fs.readFile(memoryFilePath, "utf-8");

      expect(content).toContain("# Memory");
      expect(content).toContain("- Test memory message");
    });

    it("should not add memory for messages not starting with #", async () => {
      const message = "Regular message";
      await memory.addMemory(message, tempDir);

      const memoryFilePath = path.join(tempDir, "AGENTS.md");

      // File should not exist
      await expect(fs.access(memoryFilePath)).rejects.toThrow();
    });
  });

  describe("addUserMemory", () => {
    it("should add user memory to user memory file", async () => {
      // Mock fs.mkdir and fs.writeFile to avoid actual file operations
      const mockMkdir = vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
      const mockWriteFile = vi.spyOn(fs, "writeFile").mockResolvedValue();
      vi.spyOn(fs, "readFile").mockResolvedValue(
        "# User Memory\n\nThis is a user-level memory file, recording important information and context across projects.\n\n",
      );

      // Mock fs.access to simulate file doesn't exist initially
      vi.spyOn(fs, "access").mockRejectedValue({ code: "ENOENT" });

      const message = "#Test user memory message";
      await memory.addUserMemory(message);

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/mock/user/memory.md",
        expect.stringContaining("- Test user memory message"),
        "utf-8",
      );
    });
  });

  describe("getUserMemoryContent", () => {
    it("should return user memory content", async () => {
      // Mock fs operations
      const mockMkdir = vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
      vi.spyOn(fs, "access").mockResolvedValue();
      const mockReadFile = vi
        .spyOn(fs, "readFile")
        .mockResolvedValue("User memory content");

      const result = await memory.getUserMemoryContent();

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockReadFile).toHaveBeenCalledWith(
        "/mock/user/memory.md",
        "utf-8",
      );
      expect(result).toBe("User memory content");
    });
  });

  describe("ensureUserMemoryFile", () => {
    it("should create user memory file if it doesn't exist", async () => {
      // Mock fs operations
      const mockMkdir = vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
      vi.spyOn(fs, "access").mockRejectedValue({ code: "ENOENT" });
      const mockWriteFile = vi.spyOn(fs, "writeFile").mockResolvedValue();

      await memory.ensureUserMemoryFile();

      expect(mockMkdir).toHaveBeenCalledWith("/mock/data", { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/mock/user/memory.md",
        expect.stringContaining("# User Memory"),
        "utf-8",
      );
    });

    it("should not create file if it already exists", async () => {
      // Mock fs operations
      const mockMkdir = vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
      vi.spyOn(fs, "access").mockResolvedValue();
      const mockWriteFile = vi.spyOn(fs, "writeFile").mockResolvedValue();

      await memory.ensureUserMemoryFile();

      expect(mockMkdir).toHaveBeenCalledWith("/mock/data", { recursive: true });
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });
});
