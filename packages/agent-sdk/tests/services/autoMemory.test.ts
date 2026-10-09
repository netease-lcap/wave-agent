import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryService } from "@/services/memory.js";
import { Container } from "@/utils/container.js";
import fsPromises from "node:fs/promises";
import { getGitCommonDir } from "@/utils/gitUtils.js";
import { pathEncoder } from "@/utils/pathEncoder.js";
import * as path from "node:path";

// Mock fs operations
vi.mock("node:fs/promises");

// Memory writes route through the atomic writer. Forward it to the mocked
// node:fs/promises so the existing write-call assertions keep working; the
// atomic temp-file+rename mechanics are covered by atomicWrite.test.ts.
vi.mock("@/utils/atomicWrite.js", async () => {
  const fsp = await import("node:fs/promises");
  return {
    atomicWriteFile: vi.fn((filePath: string, data: string) =>
      fsp.writeFile(filePath, data, "utf-8"),
    ),
  };
});

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
      expect(result).toBe(
        path.join(
          "/home/user",
          ".wave",
          "projects",
          "repo-root-hash",
          "memory",
        ),
      );
    });
  });

  describe("ensureAutoMemoryDirectory", () => {
    it("should backfill MEMORY.md from the topic files when the index is missing", async () => {
      vi.mocked(getGitCommonDir).mockReturnValue("/repo/root/.git");
      vi.mocked(pathEncoder.encodeSync).mockReturnValue("repo-root-hash");
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockRejectedValue({ code: "ENOENT" });
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
      vi.mocked(fsPromises.readdir).mockResolvedValue([
        "feedback_testing.md",
      ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "---\nname: testing\ndescription: Integration tests hit a real database\ntype: feedback\n---\n\nbody",
      );
      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: 0,
      } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

      await memoryService.ensureAutoMemoryDirectory("/repo/root/worktree");

      const expectedDir = path.join(
        "/home/user",
        ".wave",
        "projects",
        "repo-root-hash",
        "memory",
      );

      expect(fsPromises.mkdir).toHaveBeenCalledWith(expectedDir, {
        recursive: true,
      });
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        path.join(expectedDir, "MEMORY.md"),
        "- [feedback_testing](feedback_testing.md) — Integration tests hit a real database\n",
        "utf-8",
      );
    });

    it("should not create an empty MEMORY.md when there are no topic files", async () => {
      vi.mocked(getGitCommonDir).mockReturnValue("/repo/root/.git");
      vi.mocked(pathEncoder.encodeSync).mockReturnValue("repo-root-hash");
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockRejectedValue({ code: "ENOENT" });
      vi.mocked(fsPromises.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>,
      );

      await memoryService.ensureAutoMemoryDirectory("/repo/root/worktree");

      expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });

    it("should not touch MEMORY.md if it already exists", async () => {
      vi.mocked(getGitCommonDir).mockReturnValue("/repo/root/.git");
      vi.mocked(pathEncoder.encodeSync).mockReturnValue("repo-root-hash");
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);

      await memoryService.ensureAutoMemoryDirectory("/repo/root/worktree");

      expect(fsPromises.readdir).not.toHaveBeenCalled();
      expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("getAutoMemoryContent", () => {
    it("should bound MEMORY.md by the line cap and warn about it", async () => {
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

      const body = result.split("\n\n> WARNING:")[0];
      expect(body).toContain("Line 1\n");
      expect(body).toContain("Line 200");
      expect(body).not.toContain("Line 201");
      expect(result).toContain(
        '100 of 300 lines were cut off, starting at line 201 ("Line 201")',
      );
    });

    it("should leave a MEMORY.md under both caps untouched", async () => {
      vi.mocked(getGitCommonDir).mockReturnValue("/repo/root/.git");
      vi.mocked(pathEncoder.encodeSync).mockReturnValue("repo-root-hash");
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "# Project Memory\n\n- [a](a.md) — one line\n",
      );

      const result = await memoryService.getAutoMemoryContent(
        "/repo/root/worktree",
      );

      expect(result).toBe("# Project Memory\n\n- [a](a.md) — one line");
      expect(result).not.toContain("WARNING");
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
