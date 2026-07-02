import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryService } from "@/services/memory.js";
import { Container } from "@/utils/container.js";
import fsPromises from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";

// Mock fs operations
vi.mock("node:fs/promises");

// Mock the logger
vi.mock("@/utils/globalLogger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the constants
vi.mock("@/utils/constants", () => ({
  USER_MEMORY_FILE: "/mock/user/AGENTS.md",
  DATA_DIRECTORY: "/mock/data",
}));

// Mock gitUtils
vi.mock("@/utils/gitUtils.js", () => ({
  getGitCommonDir: vi.fn((dir) => dir),
}));

// Mock pathEncoder
vi.mock("@/utils/pathEncoder.js", () => ({
  pathEncoder: {
    encodeSync: vi.fn((path) => Buffer.from(path).toString("base64")),
  },
}));

describe("MemoryService", () => {
  let memoryService: MemoryService;
  let container: Container;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup fs mock implementations
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readFile).mockResolvedValue("");
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);

    container = new Container();
    memoryService = new MemoryService(container);
  });

  afterEach(async () => {
    // Restore all mocks
    vi.restoreAllMocks();
  });

  describe("getAutoMemoryDirectory", () => {
    it("should return the correct auto-memory directory", () => {
      const workdir = "/mock/workdir";
      const encoded = Buffer.from(workdir).toString("base64");
      const expected = path.join(
        homedir(),
        ".wave",
        "projects",
        encoded,
        "memory",
      );

      const result = memoryService.getAutoMemoryDirectory(workdir);
      expect(result).toBe(expected);
    });

    it("should remove .git suffix from common directory if present", () => {
      const workdir = "/mock/project/.git";
      const expectedProjectRoot = "/mock/project";
      const encoded = Buffer.from(expectedProjectRoot).toString("base64");
      const expected = path.join(
        homedir(),
        ".wave",
        "projects",
        encoded,
        "memory",
      );

      const result = memoryService.getAutoMemoryDirectory(workdir);
      expect(result).toBe(expected);
    });
  });

  describe("ensureAutoMemoryDirectory", () => {
    it("should create directory and MEMORY.md if they don't exist", async () => {
      const workdir = "/mock/workdir";
      vi.mocked(fsPromises.access).mockRejectedValueOnce({ code: "ENOENT" });

      await memoryService.ensureAutoMemoryDirectory(workdir);

      expect(fsPromises.mkdir).toHaveBeenCalled();
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("MEMORY.md"),
        expect.stringContaining("# Project Memory"),
        "utf-8",
      );
    });
  });

  describe("getAutoMemoryContent", () => {
    it("should return the first 200 lines of MEMORY.md", async () => {
      const workdir = "/mock/workdir";
      const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join(
        "\n",
      );
      vi.mocked(fsPromises.readFile).mockResolvedValue(lines);

      const result = await memoryService.getAutoMemoryContent(workdir);
      const resultLines = result.split("\n");

      expect(resultLines.length).toBe(200);
      expect(resultLines[0]).toBe("line 1");
      expect(resultLines[199]).toBe("line 200");
    });

    it("should return empty string if MEMORY.md doesn't exist", async () => {
      const workdir = "/mock/workdir";
      vi.mocked(fsPromises.readFile).mockRejectedValue({ code: "ENOENT" });

      const result = await memoryService.getAutoMemoryContent(workdir);
      expect(result).toBe("");
    });

    it("should cache content on first call and not read from disk on second call", async () => {
      const workdir = "/mock/workdir";
      vi.mocked(fsPromises.readFile).mockResolvedValue("cached memory content");

      const result1 = await memoryService.getAutoMemoryContent(workdir);
      expect(result1).toBe("cached memory content");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);

      const result2 = await memoryService.getAutoMemoryContent(workdir);
      expect(result2).toBe("cached memory content");
      // readFile should NOT be called again — cached value returned
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);
    });

    it("should re-read from disk after clearCache() invalidates the cache", async () => {
      const workdir = "/mock/workdir";
      vi.mocked(fsPromises.readFile).mockResolvedValue("first content");

      await memoryService.getAutoMemoryContent(workdir);
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);

      memoryService.clearCache();

      vi.mocked(fsPromises.readFile).mockResolvedValue("second content");
      const result = await memoryService.getAutoMemoryContent(workdir);
      expect(result).toBe("second content");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(2);
    });
  });

  describe("getUserMemoryContent", () => {
    it("should return user memory content", async () => {
      // Mock fs operations
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(fsPromises.readFile).mockResolvedValue("User memory content");

      const result = await memoryService.getUserMemoryContent();

      expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith("/mock/data", {
        recursive: true,
      });
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        "/mock/user/AGENTS.md",
        "utf-8",
      );
      expect(result).toBe("User memory content");
    });

    it("should use ~/.claude/AGENTS.md content when ~/.wave/AGENTS.md is the default empty template", async () => {
      const defaultTemplate =
        "# User Memory\n\nThis is the user-level memory file, recording important information and context across projects.\n\n";
      const claudeContent = "# Claude User Memory\n\nCustom claude memory data";

      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      // USER_MEMORY_FILE (~/.wave/AGENTS.md) returns the default template
      const readImpl = async (filePath: unknown): Promise<string> => {
        const p = String(filePath);
        if (p.includes(".claude")) return claudeContent;
        return defaultTemplate;
      };
      vi.mocked(fsPromises.readFile).mockImplementation(
        readImpl as typeof fsPromises.readFile,
      );

      const result = await memoryService.getUserMemoryContent();

      expect(result).toBe(claudeContent);
    });

    it("should cache content on first call and not read from disk on second call", async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue("cached user memory");

      const result1 = await memoryService.getUserMemoryContent();
      expect(result1).toBe("cached user memory");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);

      const result2 = await memoryService.getUserMemoryContent();
      expect(result2).toBe("cached user memory");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);
    });

    it("should re-read from disk after clearCache() invalidates the cache", async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue("first user content");

      await memoryService.getUserMemoryContent();
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);

      memoryService.clearCache();

      vi.mocked(fsPromises.readFile).mockResolvedValue("second user content");
      const result = await memoryService.getUserMemoryContent();
      expect(result).toBe("second user content");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(2);
    });
  });

  describe("ensureUserMemoryFile", () => {
    it("should create user memory file if it doesn't exist", async () => {
      // Mock fs operations
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockRejectedValue({ code: "ENOENT" });
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      await memoryService.ensureUserMemoryFile();

      expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith("/mock/data", {
        recursive: true,
      });
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        "/mock/user/AGENTS.md",
        expect.stringContaining("# User Memory"),
        "utf-8",
      );
    });

    it("should not create file if it already exists", async () => {
      // Mock fs operations
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      await memoryService.ensureUserMemoryFile();

      expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith("/mock/data", {
        recursive: true,
      });
      expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe("readMemoryFile", () => {
    it("should return project memory content", async () => {
      // Mock fs operations
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "# Test Memory Content\n\nProject memory data",
      );

      const result = await memoryService.readMemoryFile("/mock/workdir");

      expect(result).toBe("# Test Memory Content\n\nProject memory data");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        expect.stringContaining("AGENTS.md"),
        "utf-8",
      );
    });

    it("should fallback to CLAUDE.md when AGENTS.md does not exist", async () => {
      // First call for AGENTS.md fails with ENOENT, second call for CLAUDE.md succeeds
      vi.mocked(fsPromises.readFile)
        .mockRejectedValueOnce({ code: "ENOENT" })
        .mockResolvedValueOnce("# Claude Memory\n\nClaude memory data");

      const result = await memoryService.readMemoryFile("/mock/workdir");

      expect(result).toBe("# Claude Memory\n\nClaude memory data");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        path.join("/mock/workdir", "CLAUDE.md"),
        "utf-8",
      );
    });

    it("should prefer AGENTS.md over CLAUDE.md when both exist", async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "# Agents Memory\n\nAgents content",
      );

      const result = await memoryService.readMemoryFile("/mock/workdir");

      expect(result).toBe("# Agents Memory\n\nAgents content");
      // Should only read AGENTS.md, not CLAUDE.md
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        path.join("/mock/workdir", "AGENTS.md"),
        "utf-8",
      );
    });

    it("should return empty string when neither AGENTS.md nor CLAUDE.md exists", async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValue({ code: "ENOENT" });

      const result = await memoryService.readMemoryFile("/mock/workdir");

      expect(result).toBe("");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(2);
    });

    it("should cache content on first call and not read from disk on second call", async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "# Cached Project Memory\n\nProject content",
      );

      const result1 = await memoryService.readMemoryFile("/mock/workdir");
      expect(result1).toBe("# Cached Project Memory\n\nProject content");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);

      const result2 = await memoryService.readMemoryFile("/mock/workdir");
      expect(result2).toBe("# Cached Project Memory\n\nProject content");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);
    });

    it("should re-read from disk after clearCache() invalidates the cache", async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue("first content");

      await memoryService.readMemoryFile("/mock/workdir");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);

      memoryService.clearCache();

      vi.mocked(fsPromises.readFile).mockResolvedValue("second content");
      const result = await memoryService.readMemoryFile("/mock/workdir");
      expect(result).toBe("second content");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(2);
    });
  });

  describe("getCombinedMemoryContent", () => {
    it("should return combined memory content", async () => {
      // Mock fs operations
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce("# Project Memory\n\nProject content")
        .mockResolvedValueOnce("# User Memory\n\nUser content");

      const result =
        await memoryService.getCombinedMemoryContent("/mock/workdir");

      expect(result).toContain("Project content");
      expect(result).toContain("User content");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(2);
    });

    it("should cache combined content and not read from disk on second call", async () => {
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce("# Project Memory\n\nProject content")
        .mockResolvedValueOnce("# User Memory\n\nUser content");

      await memoryService.getCombinedMemoryContent("/mock/workdir");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(2);

      await memoryService.getCombinedMemoryContent("/mock/workdir");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(2);
    });
  });
});
