import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import {
  getFileIndex,
  queryIndex,
  defaultListing,
  resetFileIndexCache,
  MAX_CACHED_WORKDIRS,
  MAX_INDEXED_ENTRIES,
  REFRESH_TTL_MS,
} from "../../src/utils/fileIndex.js";
import type { FileIndex, ListFiles } from "../../src/utils/fileIndex.js";

const WORKDIR = path.resolve("/fake/project");

/** `getFileIndex` that fails the test instead of returning null. */
async function requireIndex(
  workdir: string,
  list: ListFiles,
): Promise<FileIndex> {
  const index = await getFileIndex(workdir, list);
  if (!index) throw new Error("expected an index");
  return index;
}

/** Build an index from a fixed path list without touching the filesystem. */
async function indexOf(files: string[], workdir = WORKDIR): Promise<FileIndex> {
  const list: ListFiles = () => Promise.resolve(files);
  const index = await getFileIndex(workdir, list);
  if (!index) throw new Error("expected an index");
  return index;
}

describe("fileIndex", () => {
  beforeEach(() => {
    resetFileIndexCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetFileIndexCache();
  });

  describe("queryIndex", () => {
    it("ranks a whole-basename match above a basename prefix above a deeper hit", async () => {
      const index = await indexOf([
        "src/utils/index.ts",
        "src/indexer.ts",
        "index.md",
      ]);

      const results = queryIndex(index, "index", 10);
      expect(results.map((r) => r.path)).toEqual([
        "index.md",
        "src/indexer.ts",
        "src/utils/index.ts",
      ]);
    });

    it("is case-insensitive", async () => {
      const index = await indexOf(["src/App.tsx", "src/app.test.tsx"]);

      expect(queryIndex(index, "APP", 10).map((r) => r.path)).toEqual(
        queryIndex(index, "app", 10).map((r) => r.path),
      );
    });

    it("matches non-ASCII queries instead of masking them away", async () => {
      const index = await indexOf(["src/索引.ts", "src/other.ts"]);

      expect(queryIndex(index, "索引", 10)).toEqual([
        { path: "src/索引.ts", type: "file" },
      ]);
    });

    it("returns directories as well as files", async () => {
      const index = await indexOf(["src/utils/file.ts"]);

      expect(queryIndex(index, "src/utils", 10)).toContainEqual({
        path: "src/utils/",
        type: "directory",
      });
    });

    it("falls back to fuzzy matching when no path contains the query literally", async () => {
      const index = await indexOf(["src/utils/fileSearch.ts"]);

      // "fsh" is not a substring, but the letters appear in order.
      const results = queryIndex(index, "fsh", 10);
      expect(results.some((r) => r.path === "src/utils/fileSearch.ts")).toBe(
        true,
      );
    });

    it("respects maxResults", async () => {
      const index = await indexOf(["a.ts", "b.ts", "c.ts"]);

      expect(queryIndex(index, ".ts", 2)).toHaveLength(2);
    });
  });

  describe("defaultListing", () => {
    it("lists top-level directories and well-known source files, dirs first", async () => {
      const index = await indexOf([
        "src/index.ts",
        "packages/agent-sdk/package.json",
        "README.md",
      ]);

      const results = defaultListing(index, 10);
      expect(results).toContainEqual({ path: "src/", type: "directory" });
      expect(results).toContainEqual({ path: "packages/", type: "directory" });
      expect(results).toContainEqual({ path: "src/index.ts", type: "file" });
      expect(results).toContainEqual({
        path: "packages/agent-sdk/package.json",
        type: "file",
      });
      // Markdown is not in the common-extension list.
      expect(results.some((r) => r.path === "README.md")).toBe(false);
      expect(results[0].type).toBe("directory");
    });
  });

  describe("caching", () => {
    it("builds once and answers later queries from memory", async () => {
      let calls = 0;
      const list: ListFiles = () => {
        calls++;
        return Promise.resolve(["src/index.ts"]);
      };

      await getFileIndex(WORKDIR, list);
      await getFileIndex(WORKDIR, list);

      expect(calls).toBe(1);
    });

    it("shares one build between concurrent callers", async () => {
      let calls = 0;
      const list: ListFiles = () => {
        calls++;
        return Promise.resolve(["src/index.ts"]);
      };

      await Promise.all([
        getFileIndex(WORKDIR, list),
        getFileIndex(WORKDIR, list),
        getFileIndex(WORKDIR, list),
      ]);

      expect(calls).toBe(1);
    });

    it(`re-enumerates once ${REFRESH_TTL_MS}ms have passed`, async () => {
      let calls = 0;
      let files = ["a.ts"];
      const list: ListFiles = () => {
        calls++;
        return Promise.resolve(files);
      };

      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      await getFileIndex(WORKDIR, list);
      expect(calls).toBe(1);

      // Still inside the window: no refresh.
      now.mockReturnValue(1_000 + REFRESH_TTL_MS - 1);
      await getFileIndex(WORKDIR, list);
      expect(calls).toBe(1);

      // Past the window: the query itself waits for the refresh, so the file
      // created in the meantime is visible in this very result.
      files = ["a.ts", "b.ts"];
      now.mockReturnValue(1_000 + REFRESH_TTL_MS + 1);
      const fresh = await requireIndex(WORKDIR, list);
      expect(calls).toBe(2);
      expect(queryIndex(fresh, "b.ts", 10).map((r) => r.path)).toContain(
        "b.ts",
      );
    });

    it("stops showing a deleted file on the first query after the window", async () => {
      let files = ["a.ts", "b.ts"];
      const list: ListFiles = () => Promise.resolve(files);

      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      await getFileIndex(WORKDIR, list);

      files = ["a.ts"];
      now.mockReturnValue(1_000 + REFRESH_TTL_MS + 1);
      const after = await requireIndex(WORKDIR, list);
      expect(queryIndex(after, "b.ts", 10)).toEqual([]);
    });

    it("keeps the index object when the refresh finds the same paths", async () => {
      let files = ["a.ts"];
      const list: ListFiles = () => Promise.resolve(files);

      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      const first = await requireIndex(WORKDIR, list);

      now.mockReturnValue(1_000 + REFRESH_TTL_MS + 1);
      const second = await requireIndex(WORKDIR, list);

      expect(second).toBe(first);
      expect(files).toEqual(["a.ts"]);
    });

    it("does not overwrite a good index when a refresh comes back empty", async () => {
      let files = ["a.ts"];
      const list: ListFiles = () => Promise.resolve(files);

      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      await getFileIndex(WORKDIR, list);

      files = [];
      now.mockReturnValue(1_000 + REFRESH_TTL_MS + 1);
      const after = await requireIndex(WORKDIR, list);
      expect(queryIndex(after, "a.ts", 10).map((r) => r.path)).toContain(
        "a.ts",
      );
    });

    it("evicts the least recently used workspace beyond the cap", async () => {
      const calls = new Map<string, number>();
      const list: ListFiles = (workdir) => {
        calls.set(workdir, (calls.get(workdir) ?? 0) + 1);
        return Promise.resolve(["a.ts"]);
      };

      for (let i = 0; i <= MAX_CACHED_WORKDIRS; i++) {
        await getFileIndex(`/w${i}`, list);
      }

      await getFileIndex("/w0", list);
      expect(calls.get("/w0")).toBe(2);
    });
  });

  describe("oversized workspaces", () => {
    it("returns null above the entry cap and stops retrying for a while", async () => {
      let calls = 0;
      const list: ListFiles = () => {
        calls++;
        // Duplicates are fine: the cap is checked before deduplication.
        return Promise.resolve(
          new Array<string>(MAX_INDEXED_ENTRIES + 1).fill("a.ts"),
        );
      };

      expect(await getFileIndex(WORKDIR, list)).toBeNull();
      expect(calls).toBe(1);

      // Cooldown: the next query falls back without re-enumerating.
      expect(await getFileIndex(WORKDIR, list)).toBeNull();
      expect(calls).toBe(1);
    });

    it("tries again once the cooldown expires", async () => {
      let calls = 0;
      let files = new Array<string>(MAX_INDEXED_ENTRIES + 1).fill("a.ts");
      const list: ListFiles = () => {
        calls++;
        return Promise.resolve(files);
      };

      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      expect(await getFileIndex(WORKDIR, list)).toBeNull();

      files = ["a.ts"];
      now.mockReturnValue(1_000 + 10 * 60_000 + 1);
      expect(await getFileIndex(WORKDIR, list)).not.toBeNull();
      expect(calls).toBe(2);
    });

    it("drops the cached index when a refresh grows past the cap", async () => {
      let files = ["a.ts"];
      const list: ListFiles = () => Promise.resolve(files);

      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      await getFileIndex(WORKDIR, list);

      files = new Array<string>(MAX_INDEXED_ENTRIES + 1).fill("a.ts");
      now.mockReturnValue(1_000 + REFRESH_TTL_MS + 1);
      expect(await getFileIndex(WORKDIR, list)).toBeNull();
    });
  });
});
