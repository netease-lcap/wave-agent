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
  });
});
