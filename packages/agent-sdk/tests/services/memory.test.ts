import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as memory from "@/services/memory.js";
import path from "path";

// Mock fs operations
vi.mock("fs", () => ({
  promises: {
    rm: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock("path", () => ({
  default: {
    join: vi.fn((...args) => args.join("/")),
  },
  join: vi.fn((...args) => args.join("/")),
}));

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
  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup fs mock implementations
    const { promises: fsPromises } = await import("fs");
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readFile).mockResolvedValue("");
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
  });

  afterEach(async () => {
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
      const mockTempDir = "/mock/temp/dir";
      const mockMemoryPath = "/mock/temp/dir/AGENTS.md";

      // Mock path.join to return expected path
      vi.mocked(path.join).mockReturnValue(mockMemoryPath);

      // Mock file not existing initially
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce({ code: "ENOENT" });

      // Mock writeFile success
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      const message = "#Test memory message";
      await memory.addMemory(message, mockTempDir);

      expect(path.join).toHaveBeenCalledWith(mockTempDir, "AGENTS.md");
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        mockMemoryPath,
        expect.stringContaining("# Memory"),
        "utf-8",
      );
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        mockMemoryPath,
        expect.stringContaining("- Test memory message"),
        "utf-8",
      );
    });

    it("should not add memory for messages not starting with #", async () => {
      const mockTempDir = "/mock/temp/dir";
      const message = "Regular message";

      await memory.addMemory(message, mockTempDir);

      // Should not call any fs operations for non-memory messages
      const { promises: fsPromises } = await import("fs");
      expect(vi.mocked(fsPromises.readFile)).not.toHaveBeenCalled();
      expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe("addUserMemory", () => {
    it("should add user memory to user memory file", async () => {
      // Mock ensureUserMemoryFile behavior - file doesn't exist initially
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockRejectedValueOnce({ code: "ENOENT" });
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      // Mock reading existing content after file creation
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce("") // Initial file creation - readFile returns string/Buffer, not void
        .mockResolvedValue(
          "# User Memory\n\nThis is a user-level memory file, recording important information and context across projects.\n\n",
        );

      const message = "#Test user memory message";
      await memory.addUserMemory(message);

      expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith("/mock/data", {
        recursive: true,
      });
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        "/mock/user/memory.md",
        expect.stringContaining("- Test user memory message"),
        "utf-8",
      );
    });
  });

  describe("getUserMemoryContent", () => {
    it("should return user memory content", async () => {
      // Mock fs operations
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(fsPromises.readFile).mockResolvedValue("User memory content");

      const result = await memory.getUserMemoryContent();

      expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith("/mock/data", {
        recursive: true,
      });
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        "/mock/user/memory.md",
        "utf-8",
      );
      expect(result).toBe("User memory content");
    });
  });

  describe("ensureUserMemoryFile", () => {
    it("should create user memory file if it doesn't exist", async () => {
      // Mock fs operations
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockRejectedValue({ code: "ENOENT" });
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      await memory.ensureUserMemoryFile();

      expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith("/mock/data", {
        recursive: true,
      });
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        "/mock/user/memory.md",
        expect.stringContaining("# User Memory"),
        "utf-8",
      );
    });

    it("should not create file if it already exists", async () => {
      // Mock fs operations
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      await memory.ensureUserMemoryFile();

      expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith("/mock/data", {
        recursive: true,
      });
      expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();
    });
  });
});
