import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MAX_MEMORY_INCLUDE_BYTES,
  MAX_MEMORY_INCLUDE_DEPTH,
  MAX_MEMORY_INCLUDE_TOTAL_BYTES,
  MemoryService,
} from "@/services/memory.js";
import { Container } from "@/utils/container.js";
import fsPromises from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";

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
import { atomicWriteFile } from "@/utils/atomicWrite.js";

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

const WORKDIR = path.resolve("/mock/project");
const AGENTS = path.join(WORKDIR, "AGENTS.md");
const LOCAL = path.join(WORKDIR, "AGENTS.local.md");
const USER_MEMORY = "/mock/user/AGENTS.md";

type MockEntry = {
  content: string;
  /** Overrides the byte size reported by `stat` (for the size cap). */
  size?: number;
  directory?: boolean;
  /** Simulated symlink target: what `realpath` reports for this path. */
  realPath?: string;
  /** Simulated read failure (e.g. `EACCES`). */
  readError?: string;
};

function errnoError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * Install an in-memory file system behind the mocked `node:fs/promises`.
 * Keys are resolved with `path.resolve` so expectations stay cross-platform;
 * `writeFile` feeds back into the map so an atomic write is visible to the
 * next read.
 */
function mockFileSystem(
  initial: Record<string, MockEntry | string>,
): Map<string, MockEntry> {
  const entries = new Map<string, MockEntry>();
  for (const [filePath, value] of Object.entries(initial)) {
    entries.set(
      path.resolve(filePath),
      typeof value === "string" ? { content: value } : value,
    );
  }

  // `fs.realpath` succeeds on directories too, and both the workdir boundary
  // check and the cycle guard canonicalize directories; register the parent
  // chain of every fixture file so those calls resolve like the real thing.
  for (const filePath of [...entries.keys()]) {
    let directory = path.dirname(filePath);
    while (directory !== path.dirname(directory) && !entries.has(directory)) {
      entries.set(directory, { content: "", directory: true });
      directory = path.dirname(directory);
    }
  }

  const realpath = vi.mocked(
    fsPromises.realpath as unknown as (target: string) => Promise<string>,
  );
  realpath.mockImplementation(async (target) => {
    const resolved = path.resolve(String(target));
    const entry = entries.get(resolved);
    if (!entry) throw errnoError("ENOENT");
    return entry.realPath ? path.resolve(entry.realPath) : resolved;
  });

  const stat = vi.mocked(
    fsPromises.stat as unknown as (
      target: string,
    ) => Promise<{ size: number; isDirectory: () => boolean }>,
  );
  stat.mockImplementation(async (target) => {
    const entry = entries.get(path.resolve(String(target)));
    if (!entry) throw errnoError("ENOENT");
    return {
      size: entry.size ?? Buffer.byteLength(entry.content),
      isDirectory: () => entry.directory === true,
    };
  });

  const readFile = vi.mocked(
    fsPromises.readFile as unknown as (target: string) => Promise<string>,
  );
  readFile.mockImplementation(async (target) => {
    const entry = entries.get(path.resolve(String(target)));
    if (!entry || entry.directory) throw errnoError("ENOENT");
    if (entry.readError) throw errnoError(entry.readError);
    return entry.content;
  });

  const writeFile = vi.mocked(
    fsPromises.writeFile as unknown as (
      target: string,
      data: string,
    ) => Promise<void>,
  );
  writeFile.mockImplementation(async (target, data) => {
    entries.set(path.resolve(String(target)), { content: String(data) });
  });

  return entries;
}

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
    // afterEach's restoreAllMocks wipes the factory implementation.
    vi.mocked(atomicWriteFile).mockImplementation(
      (filePath: string, data: string) =>
        fsPromises.writeFile(filePath, data, "utf-8"),
    );

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
    const expectedDir = path.join(
      homedir(),
      ".wave",
      "projects",
      Buffer.from("/mock/workdir").toString("base64"),
      "memory",
    );
    const expectedFile = path.join(expectedDir, "MEMORY.md");

    it("should backfill MEMORY.md from the topic files when the index is missing", async () => {
      const workdir = "/mock/workdir";
      vi.mocked(fsPromises.access).mockRejectedValue({ code: "ENOENT" });
      vi.mocked(fsPromises.readdir).mockResolvedValue([
        "user_role.md",
      ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "---\nname: role\ndescription: The user's role on the team\ntype: user\n---\n\nbody",
      );
      vi.mocked(fsPromises.stat).mockResolvedValue({
        mtimeMs: 0,
      } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

      await memoryService.ensureAutoMemoryDirectory(workdir);

      expect(fsPromises.mkdir).toHaveBeenCalledWith(expectedDir, {
        recursive: true,
      });
      // Written through the atomic writer (temp file + rename).
      expect(atomicWriteFile).toHaveBeenCalledWith(
        expectedFile,
        "- [user_role](user_role.md) — The user's role on the team\n",
      );
    });

    it("should not create an empty index when there are no topic files", async () => {
      vi.mocked(fsPromises.access).mockRejectedValue({ code: "ENOENT" });
      vi.mocked(fsPromises.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>,
      );

      await memoryService.ensureAutoMemoryDirectory("/mock/workdir");

      expect(fsPromises.mkdir).toHaveBeenCalled();
      expect(atomicWriteFile).not.toHaveBeenCalled();
    });

    it("should not touch MEMORY.md when it already exists", async () => {
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(fsPromises.readdir).mockResolvedValue([
        "user_role.md",
      ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);

      await memoryService.ensureAutoMemoryDirectory("/mock/workdir");

      expect(fsPromises.readdir).not.toHaveBeenCalled();
      expect(atomicWriteFile).not.toHaveBeenCalled();
    });
  });

  describe("getAutoMemoryContent", () => {
    it("should bound MEMORY.md by the line cap and warn about it", async () => {
      const workdir = "/mock/workdir";
      const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join(
        "\n",
      );
      vi.mocked(fsPromises.readFile).mockResolvedValue(lines);

      const result = await memoryService.getAutoMemoryContent(workdir);
      const resultLines = result.split("\n");

      expect(resultLines[0]).toBe("line 1");
      expect(resultLines[199]).toBe("line 200");
      expect(resultLines[200]).toBe("");
      expect(resultLines[201]).toBe(
        '> WARNING: MEMORY.md is 300 lines (limit: 200). Only part of it was loaded: 100 of 300 lines were cut off, starting at line 201 ("line 201"). Keep index entries to one line under ~150 chars; move detail into topic files.',
      );
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
      // Written through the atomic writer (temp file + rename).
      expect(atomicWriteFile).toHaveBeenCalledWith(
        "/mock/user/AGENTS.md",
        expect.stringContaining("# User Memory"),
      );
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
      // Project file, user file, then the personal-project layer probe.
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(3);
    });

    it("should append the personal project memory last, so it outranks both other layers", async () => {
      vi.mocked(fsPromises.readFile).mockImplementation((filePath) => {
        const target = String(filePath);
        if (target === path.join("/mock/workdir", "AGENTS.md")) {
          return Promise.resolve("# Project Memory\n\nProject content");
        }
        if (target === "/mock/user/AGENTS.md") {
          return Promise.resolve("# User Memory\n\nUser content");
        }
        if (target === path.join("/mock/workdir", "AGENTS.local.md")) {
          return Promise.resolve("# Personal Memory\n\nPersonal content");
        }
        return Promise.reject({ code: "ENOENT" });
      });

      const result =
        await memoryService.getCombinedMemoryContent("/mock/workdir");

      expect(result.indexOf("Project content")).toBeLessThan(
        result.indexOf("User content"),
      );
      expect(result.indexOf("User content")).toBeLessThan(
        result.indexOf("Personal content"),
      );
    });

    it("should cache combined content and not read from disk on second call", async () => {
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce("# Project Memory\n\nProject content")
        .mockResolvedValueOnce("# User Memory\n\nUser content");

      await memoryService.getCombinedMemoryContent("/mock/workdir");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(3);

      await memoryService.getCombinedMemoryContent("/mock/workdir");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(3);
    });
  });

  describe("readLocalMemoryFile", () => {
    it("should return AGENTS.local.md content", async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "# Personal Memory\n\nPersonal content",
      );

      const result = await memoryService.readLocalMemoryFile("/mock/workdir");

      expect(result).toBe("# Personal Memory\n\nPersonal content");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        path.join("/mock/workdir", "AGENTS.local.md"),
        "utf-8",
      );
    });

    it("should fallback to CLAUDE.local.md when AGENTS.local.md does not exist", async () => {
      vi.mocked(fsPromises.readFile)
        .mockRejectedValueOnce({ code: "ENOENT" })
        .mockResolvedValueOnce("# Personal Memory\n\nClaude personal content");

      const result = await memoryService.readLocalMemoryFile("/mock/workdir");

      expect(result).toBe("# Personal Memory\n\nClaude personal content");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
        path.join("/mock/workdir", "CLAUDE.local.md"),
        "utf-8",
      );
    });

    it("should keep AGENTS.local.md isolated from the project memory file", async () => {
      await memoryService.readMemoryFile("/mock/workdir");

      expect(vi.mocked(fsPromises.readFile)).not.toHaveBeenCalledWith(
        path.join("/mock/workdir", "AGENTS.local.md"),
        "utf-8",
      );
    });

    it("should return empty string when neither local file exists", async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValue({ code: "ENOENT" });

      const result = await memoryService.readLocalMemoryFile("/mock/workdir");

      expect(result).toBe("");
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(2);
    });

    it("should re-read from disk after clearCache() invalidates the cache", async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue("first content");
      await memoryService.readLocalMemoryFile("/mock/workdir");

      memoryService.clearCache();

      vi.mocked(fsPromises.readFile).mockResolvedValue("second content");
      expect(await memoryService.readLocalMemoryFile("/mock/workdir")).toBe(
        "second content",
      );
    });
  });

  describe("memory content writes (settings-page editor)", () => {
    it("should write user memory through the atomic writer", async () => {
      await memoryService.writeUserMemoryContent("new user memory");

      expect(atomicWriteFile).toHaveBeenCalledWith(
        "/mock/user/AGENTS.md",
        "new user memory",
      );
    });

    it("should write project memory through the atomic writer", async () => {
      await memoryService.writeProjectMemoryContent(
        "/mock/workdir",
        "new project memory",
      );

      expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith(
        "/mock/workdir",
        { recursive: true },
      );
      expect(atomicWriteFile).toHaveBeenCalledWith(
        path.join("/mock/workdir", "AGENTS.md"),
        "new project memory",
      );
    });

    it("should invalidate the read cache so the next read sees the new content", async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue("old content");
      await memoryService.readMemoryFile("/mock/workdir");

      await memoryService.writeProjectMemoryContent(
        "/mock/workdir",
        "new content",
      );

      vi.mocked(fsPromises.readFile).mockResolvedValue("new content");
      expect(await memoryService.readMemoryFile("/mock/workdir")).toBe(
        "new content",
      );
    });

    it("should write personal memory to AGENTS.local.md and drop the local cache", async () => {
      mockFileSystem({ [LOCAL]: "old personal" });
      await memoryService.readLocalMemoryFile(WORKDIR);

      await memoryService.writeLocalMemoryContent(WORKDIR, "new personal");

      expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith(WORKDIR, {
        recursive: true,
      });
      expect(atomicWriteFile).toHaveBeenCalledWith(LOCAL, "new personal");
      expect(atomicWriteFile).not.toHaveBeenCalledWith(
        path.join(WORKDIR, "CLAUDE.local.md"),
        expect.anything(),
      );
      // The cache would still hold "old personal" had the write not cleared it.
      expect(await memoryService.readLocalMemoryFile(WORKDIR)).toBe(
        "new personal",
      );
    });

    it("should invalidate the combined cache when personal memory is written", async () => {
      mockFileSystem({ [AGENTS]: "project", [LOCAL]: "old personal" });
      expect(await memoryService.getCombinedMemoryContent(WORKDIR)).toContain(
        "old personal",
      );

      await memoryService.writeLocalMemoryContent(
        WORKDIR,
        "rewritten personal",
      );

      expect(await memoryService.getCombinedMemoryContent(WORKDIR)).toContain(
        "rewritten personal",
      );
    });
  });

  describe("@include references", () => {
    it("appends the referenced file as its own block with a source marker", async () => {
      mockFileSystem({
        [AGENTS]: "# Project\n\nRead @./docs/build.md for the build rules.",
        [path.join(WORKDIR, "docs/build.md")]: "# Build rules\n\nAlways pnpm.",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      // The `@path` text stays in place — the content is appended, not substituted.
      expect(result.startsWith("# Project\n\nRead @./docs/build.md")).toBe(
        true,
      );
      expect(result).toContain("<!-- @include: docs/build.md -->");
      expect(result.indexOf("# Build rules")).toBeGreaterThan(
        result.indexOf("@./docs/build.md"),
      );
    });

    it("accepts @path, @./path, @~/path and @/absolute/path", async () => {
      const homeFile = path.join(homedir(), "wave-include-fixture.md");
      const absoluteFile = path.join(WORKDIR, "absolute.md");
      mockFileSystem({
        // Personal memory may reference outside the workdir (`~/…` below).
        [LOCAL]: [
          "@bare.md",
          "@./dotted.md",
          "@~/wave-include-fixture.md",
          `@${absoluteFile}`,
        ].join("\n"),
        [path.join(WORKDIR, "bare.md")]: "BARE CONTENT",
        [path.join(WORKDIR, "dotted.md")]: "DOTTED CONTENT",
        [homeFile]: "HOME CONTENT",
        [absoluteFile]: "ABSOLUTE CONTENT",
      });

      const result = await memoryService.readLocalMemoryFile(WORKDIR);

      expect(result).toContain("BARE CONTENT");
      expect(result).toContain("DOTTED CONTENT");
      expect(result).toContain("HOME CONTENT");
      expect(result).toContain("ABSOLUTE CONTENT");
      expect(result).toContain("<!-- @include: ~/wave-include-fixture.md -->");
    });

    it("unescapes \\  in the path and drops a #anchor fragment", async () => {
      mockFileSystem({
        [AGENTS]: "see @./docs/my\\ guide.md#setup please",
        [path.join(WORKDIR, "docs/my guide.md")]: "GUIDE CONTENT",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain("GUIDE CONTENT");
      expect(result).toContain("<!-- @include: docs/my guide.md -->");
    });

    it("does not expand @ inside fenced code, inline code or HTML comments", async () => {
      mockFileSystem({
        [AGENTS]: [
          "```md",
          "@./docs/fenced.md",
          "```",
          "",
          "inline `@./docs/inline.md` stays",
          "",
          "<!-- @./docs/comment.md -->",
          "",
          "real @./docs/real.md",
        ].join("\n"),
        [path.join(WORKDIR, "docs/fenced.md")]: "FENCED CONTENT",
        [path.join(WORKDIR, "docs/inline.md")]: "INLINE CONTENT",
        [path.join(WORKDIR, "docs/comment.md")]: "COMMENT CONTENT",
        [path.join(WORKDIR, "docs/real.md")]: "REAL CONTENT",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain("REAL CONTENT");
      expect(result).not.toContain("FENCED CONTENT");
      expect(result).not.toContain("INLINE CONTENT");
      expect(result).not.toContain("COMMENT CONTENT");
      expect(result.match(/@include/g)).toHaveLength(1);
    });

    it("does not treat an email address as a reference", async () => {
      const content = "# Project\n\nContact foo@bar.com for access.\n";
      mockFileSystem({ [AGENTS]: content });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toBe(content);
      // Only the memory file itself was read: no reference was resolved.
      expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledTimes(1);
    });

    it("skips targets outside the text extension whitelist", async () => {
      mockFileSystem({
        [AGENTS]: "logo @./assets/logo.png\nbuild @./Makefile",
        [path.join(WORKDIR, "assets/logo.png")]: "PNG BYTES",
        [path.join(WORKDIR, "Makefile")]: "all: build",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain(
        "@include skipped: assets/logo.png — not a text file",
      );
      expect(result).toContain("@include skipped: Makefile — not a text file");
      expect(result).not.toContain("PNG BYTES");
    });

    it("leaves an in-place note when the target is missing, a directory or unreadable", async () => {
      mockFileSystem({
        [AGENTS]: "a @./missing.md\nb @./somedir.md\nc @./locked.md",
        [path.join(WORKDIR, "somedir.md")]: { content: "", directory: true },
        [path.join(WORKDIR, "locked.md")]: {
          content: "LOCKED CONTENT",
          readError: "EACCES",
        },
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      // The note replaces the `@path` token itself, and the rest of the file survives.
      expect(
        result.startsWith(
          "a <!-- @include skipped: missing.md — not found -->\nb ",
        ),
      ).toBe(true);
      expect(result).toContain("skipped: somedir.md — not a file");
      expect(result).toContain("skipped: locked.md — read failed");
      expect(result).not.toContain("LOCKED CONTENT");
    });

    it("skips a target larger than the size cap", async () => {
      mockFileSystem({
        [AGENTS]: "@./package-lock.json",
        [path.join(WORKDIR, "package-lock.json")]: {
          content: "{}",
          size: MAX_MEMORY_INCLUDE_BYTES + 1,
        },
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain(
        "@include skipped: package-lock.json — too large",
      );
    });

    it("expands a cyclic reference chain once per file without looping", async () => {
      mockFileSystem({
        [AGENTS]: "@./a.md",
        [path.join(WORKDIR, "a.md")]: "A CONTENT\n@./b.md",
        [path.join(WORKDIR, "b.md")]: "B CONTENT\n@./a.md",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result.split("<!-- @include: a.md -->")).toHaveLength(2);
      expect(result.split("<!-- @include: b.md -->")).toHaveLength(2);
      expect(result).toContain("A CONTENT");
      expect(result).toContain("B CONTENT");
    });

    it("stops expanding past the recursion depth cap", async () => {
      const files: Record<string, string> = { [AGENTS]: "@./level1.md" };
      for (let level = 1; level <= MAX_MEMORY_INCLUDE_DEPTH; level += 1) {
        files[path.join(WORKDIR, `level${level}.md`)] =
          `LEVEL${level} CONTENT\n@./level${level + 1}.md`;
      }
      const beyondCap = MAX_MEMORY_INCLUDE_DEPTH + 1;
      files[path.join(WORKDIR, `level${beyondCap}.md`)] =
        `LEVEL${beyondCap} CONTENT`;
      mockFileSystem(files);

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain(`LEVEL${MAX_MEMORY_INCLUDE_DEPTH} CONTENT`);
      expect(result).not.toContain(`LEVEL${beyondCap} CONTENT`);
      expect(result).toContain("max depth reached");
    });

    it("rejects references outside the workdir for the project tier", async () => {
      const privateFile = path.join(homedir(), "wave-private-notes.md");
      const outsideAbsolute = path.resolve("/mock/elsewhere/notes.md");
      mockFileSystem({
        [AGENTS]: `@~/wave-private-notes.md\n@${outsideAbsolute}`,
        [privateFile]: "PRIVATE CONTENT",
        [outsideAbsolute]: "OUTSIDE CONTENT",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain(
        "skipped: ~/wave-private-notes.md — outside workdir",
      );
      expect(result).not.toContain("PRIVATE CONTENT");
      expect(result).not.toContain("OUTSIDE CONTENT");
    });

    it("does not let a symlink smuggle the project tier out of the workdir", async () => {
      const secret = path.join(homedir(), "wave-secret.md");
      mockFileSystem({
        [AGENTS]: "@./link.md",
        [path.join(WORKDIR, "link.md")]: { content: "", realPath: secret },
        [secret]: "SECRET CONTENT",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain("skipped: link.md — outside workdir");
      expect(result).not.toContain("SECRET CONTENT");
    });

    it("allows references outside the workdir for the user and local tiers", async () => {
      const shared = path.join(homedir(), "wave-shared-rules.md");
      mockFileSystem({
        [LOCAL]: "personal\n@~/wave-shared-rules.md",
        [USER_MEMORY]: "user\n@~/wave-shared-rules.md",
        [shared]: "SHARED RULES CONTENT",
      });

      const local = await memoryService.readLocalMemoryFile(WORKDIR);
      expect(local).toContain("SHARED RULES CONTENT");
      expect(local).toContain("<!-- @include: ~/wave-shared-rules.md -->");

      memoryService.clearCache();
      const user = await memoryService.getUserMemoryContent();
      expect(user).toContain("SHARED RULES CONTENT");
    });

    it("caches the expansion until clearCache() invalidates it", async () => {
      const entries = mockFileSystem({
        [AGENTS]: "@./extra.md",
        [path.join(WORKDIR, "extra.md")]: "FIRST VERSION",
      });

      expect(await memoryService.readMemoryFile(WORKDIR)).toContain(
        "FIRST VERSION",
      );

      entries.set(path.join(WORKDIR, "extra.md"), {
        content: "SECOND VERSION",
      });
      // No hot reload: the expanded result stays cached.
      expect(await memoryService.readMemoryFile(WORKDIR)).toContain(
        "FIRST VERSION",
      );

      memoryService.clearCache();
      const reread = await memoryService.readMemoryFile(WORKDIR);
      expect(reread).toContain("SECOND VERSION");
      expect(reread).not.toContain("FIRST VERSION");
    });

    it("does not expand a reference after an unclosed fence", async () => {
      mockFileSystem({
        // The fence never closes, so the rest of the file stays masked.
        [AGENTS]: ["# Project", "", "```sh", "@./docs/inside.md"].join("\n"),
        [path.join(WORKDIR, "docs/inside.md")]: "INSIDE CONTENT",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).not.toContain("INSIDE CONTENT");
    });

    it("does not expand @ inside an indented code block", async () => {
      mockFileSystem({
        [AGENTS]: [
          "# Project",
          "",
          "    @./docs/indented.md",
          "",
          "real @./docs/real.md",
        ].join("\n"),
        [path.join(WORKDIR, "docs/indented.md")]: "INDENTED CONTENT",
        [path.join(WORKDIR, "docs/real.md")]: "REAL CONTENT",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain("REAL CONTENT");
      expect(result).not.toContain("INDENTED CONTENT");
    });

    it("does not expand @ inside a fenced block in a blockquote", async () => {
      mockFileSystem({
        [AGENTS]: [
          "> ```md",
          "> @./docs/quoted.md",
          "> ```",
          "",
          "> > ```",
          "> > @./docs/nested.md",
          "> > ```",
          "",
          "quoted prose @./docs/real.md",
        ].join("\n"),
        [path.join(WORKDIR, "docs/quoted.md")]: "QUOTED CONTENT",
        [path.join(WORKDIR, "docs/nested.md")]: "NESTED QUOTE CONTENT",
        [path.join(WORKDIR, "docs/real.md")]: "REAL CONTENT",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain("REAL CONTENT");
      expect(result).not.toContain("QUOTED CONTENT");
      expect(result).not.toContain("NESTED QUOTE CONTENT");
    });

    it("still expands a @path on a list item's 4-space continuation line", async () => {
      mockFileSystem({
        // Indented, but the previous line is a list item — prose, not code.
        [AGENTS]: ["- step one", "    @./docs/list.md", "", "- step two"].join(
          "\n",
        ),
        [path.join(WORKDIR, "docs/list.md")]: "LIST CONTENT",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain("LIST CONTENT");
    });

    it("leaves a note when a reference has nothing but an anchor", async () => {
      mockFileSystem({ [AGENTS]: "jump to @#setup please" });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toBe(
        "jump to <!-- @include skipped: @#setup — empty path --> please",
      );
    });

    it("notes every occurrence of a reference that cannot be expanded", async () => {
      mockFileSystem({
        [AGENTS]: "a @./logo.png b @./logo.png",
        [path.join(WORKDIR, "logo.png")]: "PNG BYTES",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(
        result.match(/skipped: logo\.png — not a text file/g),
      ).toHaveLength(2);
    });

    it("expands one file referenced three ways only once", async () => {
      const target = path.join(WORKDIR, "docs/x.md");
      mockFileSystem({
        [AGENTS]: ["@./docs/x.md", "@docs/x.md", `@${target}`].join("\n"),
        [target]: "X CONTENT",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result.match(/<!-- @include: /g)).toHaveLength(1);
      expect(result.split("X CONTENT")).toHaveLength(2);
    });

    it("appends a nested include after the file that references it", async () => {
      mockFileSystem({
        [AGENTS]: "@./a.md",
        [path.join(WORKDIR, "a.md")]: "A CONTENT\n@./b.md",
        [path.join(WORKDIR, "b.md")]: "B CONTENT",
      });

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result.indexOf("<!-- @include: a.md -->")).toBeLessThan(
        result.indexOf("A CONTENT"),
      );
      expect(result.indexOf("A CONTENT")).toBeLessThan(
        result.indexOf("<!-- @include: b.md -->"),
      );
      expect(result.indexOf("<!-- @include: b.md -->")).toBeLessThan(
        result.indexOf("B CONTENT"),
      );
    });

    it("shares the expansion scope across the three memory layers", async () => {
      const shared = path.join(WORKDIR, "shared.md");
      mockFileSystem({
        [AGENTS]: "@./shared.md",
        // The user layer points at the same file by absolute path.
        [USER_MEMORY]: `@${shared}`,
        [shared]: "SHARED ONCE",
      });

      const result = await memoryService.getCombinedMemoryContent(WORKDIR);

      // One block for the whole combined load, not one per layer.
      expect(result.match(/<!-- @include: /g)).toHaveLength(1);
      expect(result.split("SHARED ONCE")).toHaveLength(2);
    });

    it("stops expanding once the whole load exceeds the total budget", async () => {
      const perFile = MAX_MEMORY_INCLUDE_BYTES;
      const fitting = Math.floor(MAX_MEMORY_INCLUDE_TOTAL_BYTES / perFile);
      const files: Record<string, MockEntry | string> = {};
      const references: string[] = [];
      for (let index = 1; index <= fitting + 2; index += 1) {
        references.push(`@./big${index}.md`);
        files[path.join(WORKDIR, `big${index}.md`)] = {
          content: `BIG${index} CONTENT`,
          size: perFile,
        };
      }
      files[AGENTS] = references.join("\n");
      mockFileSystem(files);

      const result = await memoryService.readMemoryFile(WORKDIR);

      expect(result).toContain(`BIG${fitting} CONTENT`);
      expect(result).not.toContain(`BIG${fitting + 1} CONTENT`);
      expect(result).toContain(
        `skipped: big${fitting + 1}.md — total size limit reached`,
      );
    });
  });
});
