import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryService } from "@/services/memory.js";
import { Container } from "@/utils/container.js";
import fsPromises from "node:fs/promises";
import { getGitCommonDir } from "@/utils/gitUtils.js";
import { pathEncoder } from "@/utils/pathEncoder.js";
import * as path from "node:path";

// Mock fs operations
vi.mock("node:fs/promises");

// Mock gitUtils
vi.mock("@/utils/gitUtils.js", () => ({
  getGitCommonDir: vi.fn(),
}));

// Mock pathEncoder
vi.mock("@/utils/pathEncoder.js", () => ({
  pathEncoder: {
    encodeSync: vi.fn(),
  },
}));

// Mock os
vi.mock("node:os", () => ({
  default: {
    homedir: vi.fn(() => "/home/user"),
    platform: vi.fn(() => "linux"),
    type: vi.fn(() => "Linux"),
    release: vi.fn(() => "6.8.0"),
  },
  homedir: vi.fn(() => "/home/user"),
  platform: vi.fn(() => "linux"),
  type: vi.fn(() => "Linux"),
  release: vi.fn(() => "6.8.0"),
}));

describe("MemoryService Auto-Memory", () => {
  let memoryService: MemoryService;
  let container: Container;

  beforeEach(async () => {
    vi.clearAllMocks();
    container = new Container();
    memoryService = new MemoryService(container);
  });

  describe("getAutoMemoryDirectory", () => {
    it("should return the correct auto-memory directory", () => {
      vi.mocked(getGitCommonDir).mockReturnValue("/repo/root/.git");
      vi.mocked(pathEncoder.encodeSync).mockReturnValue("repo-root-hash");

      const result = memoryService.getAutoMemoryDirectory(
        "/repo/root/worktree",
      );

      expect(getGitCommonDir).toHaveBeenCalledWith("/repo/root/worktree");
      expect(pathEncoder.encodeSync).toHaveBeenCalledWith("/repo/root");
      expect(result).toBe("/home/user/.wave/projects/repo-root-hash/memory");
    });
  });

  describe("ensureAutoMemoryDirectory", () => {
    it("should create the directory and MEMORY.md if they don't exist", async () => {
      vi.mocked(getGitCommonDir).mockReturnValue("/repo/root/.git");
      vi.mocked(pathEncoder.encodeSync).mockReturnValue("repo-root-hash");
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockRejectedValue({ code: "ENOENT" });
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      await memoryService.ensureAutoMemoryDirectory("/repo/root/worktree");

      const expectedDir = "/home/user/.wave/projects/repo-root-hash/memory";
      const expectedFile = path.join(expectedDir, "MEMORY.md");

      expect(fsPromises.mkdir).toHaveBeenCalledWith(expectedDir, {
        recursive: true,
      });
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        expectedFile,
        expect.stringContaining("# Project Memory"),
        "utf-8",
      );
    });

    it("should not create MEMORY.md if it already exists", async () => {
      vi.mocked(getGitCommonDir).mockReturnValue("/repo/root/.git");
      vi.mocked(pathEncoder.encodeSync).mockReturnValue("repo-root-hash");
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);

      await memoryService.ensureAutoMemoryDirectory("/repo/root/worktree");

      expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("getAutoMemoryContent", () => {
    it("should return the first 200 lines of MEMORY.md", async () => {
      vi.mocked(getGitCommonDir).mockReturnValue("/repo/root/.git");
      vi.mocked(pathEncoder.encodeSync).mockReturnValue("repo-root-hash");

      const manyLines = Array.from(
        { length: 300 },
        (_, i) => `Line ${i + 1}`,
      ).join("\n");
      vi.mocked(fsPromises.readFile).mockResolvedValue(manyLines);

      const result = await memoryService.getAutoMemoryContent(
        "/repo/root/worktree",
      );

      const lines = result.split("\n");
      expect(lines.length).toBe(200);
      expect(lines[0]).toBe("Line 1");
      expect(lines[199]).toBe("Line 200");
    });

    it("should return empty string if MEMORY.md doesn't exist", async () => {
      vi.mocked(getGitCommonDir).mockReturnValue("/repo/root/.git");
      vi.mocked(pathEncoder.encodeSync).mockReturnValue("repo-root-hash");
      vi.mocked(fsPromises.readFile).mockRejectedValue({ code: "ENOENT" });

      const result = await memoryService.getAutoMemoryContent(
        "/repo/root/worktree",
      );

      expect(result).toBe("");
    });
  });
});
