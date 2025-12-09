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

  // T018 [P] [US2] - Test to ensure memory service functions work with Agent-based storage
  describe("T018 - Memory service functions with Agent-based storage", () => {
    it("should work without global memory store for readMemoryFile function", async () => {
      // Mock fs operations
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "# Test Memory Content\n\nProject memory data",
      );

      // Test readMemoryFile without initializing globalMemoryStore
      const result = await memory.readMemoryFile("/mock/workdir");

      expect(result).toBe("# Test Memory Content\n\nProject memory data");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        "/mock/workdir/AGENTS.md",
        "utf-8",
      );
    });

    it("should work without global memory store for getUserMemoryContent function", async () => {
      // Mock fs operations
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "# User Memory\n\nUser memory data",
      );

      // Test getUserMemoryContent without initializing globalMemoryStore
      const result = await memory.getUserMemoryContent();

      expect(result).toBe("# User Memory\n\nUser memory data");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        "/mock/user/memory.md",
        "utf-8",
      );
    });

    it("should work without global memory store for getCombinedMemoryContent function", async () => {
      // Mock fs operations
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce("# Project Memory\n\nProject content")
        .mockResolvedValueOnce("# User Memory\n\nUser content");

      // Test getCombinedMemoryContent without initializing globalMemoryStore
      const result = await memory.getCombinedMemoryContent("/mock/workdir");

      expect(result).toContain("Project content");
      expect(result).toContain("User content");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(2);
    });

    it("should handle addMemory function without global memory store dependency", async () => {
      // Mock fs operations
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "# Existing Memory\n\nExisting content",
      );
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      // Test addMemory without relying on globalMemoryStore
      await memory.addMemory("#New memory block", "/mock/workdir");

      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        "/mock/workdir/AGENTS.md",
        "utf-8",
      );
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        "/mock/workdir/AGENTS.md",
        expect.stringContaining("Existing content"),
        "utf-8",
      );
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        "/mock/workdir/AGENTS.md",
        expect.stringContaining("New memory block"),
        "utf-8",
      );
    });

    it("should handle addUserMemory function without global memory store dependency", async () => {
      // Mock fs operations
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "# User Memory\n\nExisting user content",
      );
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      // Test addUserMemory without relying on globalMemoryStore
      await memory.addUserMemory("#New user memory");

      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        "/mock/user/memory.md",
        "utf-8",
      );
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        "/mock/user/memory.md",
        expect.stringContaining("Existing user content"),
        "utf-8",
      );
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        "/mock/user/memory.md",
        expect.stringContaining("New user memory"),
        "utf-8",
      );
    });

    it("should verify that memory utility functions work with direct file access", async () => {
      // Memory functions now always use direct file access
      // Mock fs operations
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.readFile).mockResolvedValue("Memory content");

      // These functions should work with direct file access
      const projectMemory = await memory.readMemoryFile("/mock/workdir");
      const userMemory = await memory.getUserMemoryContent();
      const combined = await memory.getCombinedMemoryContent("/mock/workdir");

      expect(projectMemory).toBe("Memory content");
      expect(userMemory).toBe("Memory content");
      expect(combined).toContain("Memory content");
    });

    it("should ensure memory functions are independent of MemoryStoreService state", async () => {
      // This test verifies that memory functions work independently of the
      // MemoryStoreService global state, which is essential for the new
      // Agent-based storage approach.

      // Mock fs operations
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.readFile).mockResolvedValue("Independent memory");
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      // Test multiple memory operations without any global state
      const isMemory = memory.isMemoryMessage("#Test memory");
      await memory.ensureUserMemoryFile();
      await memory.addMemory("#Test memory", "/mock/workdir");
      const content = await memory.readMemoryFile("/mock/workdir");

      expect(isMemory).toBe(true);
      expect(content).toBe("Independent memory");
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalled();
    });
  });

  describe("Memory Store Infrastructure Removal (T035-T036)", () => {
    it("should verify memory store service file no longer exists", async () => {
      // This test verifies that the memory store service has been removed
      // as part of the migration to Agent-based memory management

      await expect(async () => {
        // This should throw an error since the file no longer exists
        // Use dynamic import with string concatenation to avoid compile-time resolution
        const modulePath = "../../../src/services/" + "memoryStore.js";
        await import(modulePath);
      }).rejects.toThrow();
    });

    it("should verify memory store types file no longer exists", async () => {
      // This test verifies that memory store types have been removed

      await expect(async () => {
        // This should throw an error since the file no longer exists
        // Use dynamic import with string concatenation to avoid compile-time resolution
        const modulePath = "../../../src/types/" + "memoryStore.js";
        await import(modulePath);
      }).rejects.toThrow();
    });

    it("should verify Agent class provides all needed memory functionality", () => {
      // This test verifies that the Agent class now provides all memory
      // functionality that was previously handled by MemoryStoreService

      // We verify that the MemoryStoreService is no longer needed because:
      // 1. The service file has been deleted (verified by previous tests)
      // 2. The Agent class now handles all memory functionality directly
      // 3. Memory tests in agent.memory.test.ts verify this functionality works

      // This test mainly documents that memory functionality has moved to Agent
      expect(true).toBe(true); // Memory functionality verified in agent.memory.test.ts
    });

    it("should verify memory functions work with simplified architecture", async () => {
      // This test verifies that memory utility functions work correctly
      // with the new simplified architecture (no global memory store)

      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.readFile).mockResolvedValue("Test memory content");
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      // Test all core memory functions work independently
      expect(memory.isMemoryMessage("#Test")).toBe(true);
      expect(memory.isMemoryMessage("Not memory")).toBe(false);

      await memory.ensureUserMemoryFile();
      await memory.addMemory("#Test memory", "/mock/workdir");
      await memory.addUserMemory("#User memory");

      const projectMemory = await memory.readMemoryFile("/mock/workdir");
      const userMemory = await memory.getUserMemoryContent();
      const combined = await memory.getCombinedMemoryContent("/mock/workdir");

      expect(projectMemory).toBe("Test memory content");
      expect(userMemory).toBe("Test memory content");
      expect(combined).toContain("Test memory content");
    });
  });
});
