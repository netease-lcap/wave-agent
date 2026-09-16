import { describe, it, expect, vi, beforeEach } from "vitest";
import fsPromises from "node:fs/promises";
import { findNestedMemoryFiles } from "@/utils/nestedMemory.js";

vi.mock("node:fs/promises");

const WORKDIR = "/repo";

function mockFiles(files: Record<string, string>) {
  vi.mocked(fsPromises.readFile).mockImplementation(async (filePath) => {
    const content = files[String(filePath)];
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: ${String(filePath)}`), {
        code: "ENOENT",
      });
    }
    return content as unknown as Awaited<
      ReturnType<typeof fsPromises.readFile>
    >;
  });
}

describe("findNestedMemoryFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects ancestor memory files outermost first, skipping the project root", async () => {
    mockFiles({
      "/repo/packages/AGENTS.md": "packages memory",
      "/repo/packages/foo/AGENTS.md": "foo memory",
      "/repo/AGENTS.md": "root memory",
    });

    const memories = await findNestedMemoryFiles(
      "/repo/packages/foo/src/a.ts",
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([
      { path: "/repo/packages/AGENTS.md", content: "packages memory" },
      { path: "/repo/packages/foo/AGENTS.md", content: "foo memory" },
    ]);
    // The root memory file is loaded eagerly into every request already.
    expect(fsPromises.readFile).not.toHaveBeenCalledWith(
      "/repo/AGENTS.md",
      "utf-8",
    );
  });

  it("falls back to CLAUDE.md when AGENTS.md is absent", async () => {
    mockFiles({ "/repo/packages/CLAUDE.md": "legacy memory" });

    const memories = await findNestedMemoryFiles(
      "/repo/packages/a.ts",
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([
      { path: "/repo/packages/CLAUDE.md", content: "legacy memory" },
    ]);
  });

  it("prefers AGENTS.md over CLAUDE.md in the same directory", async () => {
    mockFiles({
      "/repo/packages/AGENTS.md": "agents memory",
      "/repo/packages/CLAUDE.md": "claude memory",
    });

    const memories = await findNestedMemoryFiles(
      "/repo/packages/a.ts",
      WORKDIR,
      new Set(),
    );

    expect(memories.map((m) => m.path)).toEqual(["/repo/packages/AGENTS.md"]);
  });

  it("skips a directory whose memory file was already injected", async () => {
    mockFiles({
      "/repo/packages/AGENTS.md": "packages memory",
      "/repo/packages/foo/AGENTS.md": "foo memory",
    });
    const loaded = new Set([
      "/repo/packages/AGENTS.md",
      "/repo/packages/CLAUDE.md",
    ]);

    const memories = await findNestedMemoryFiles(
      "/repo/packages/foo/src/a.ts",
      WORKDIR,
      loaded,
    );

    expect(memories.map((m) => m.path)).toEqual([
      "/repo/packages/foo/AGENTS.md",
    ]);
    // An already-loaded AGENTS.md must not fall through to CLAUDE.md either.
    expect(fsPromises.readFile).not.toHaveBeenCalledWith(
      "/repo/packages/CLAUDE.md",
      "utf-8",
    );
  });

  it("records injected files in the dedup set", async () => {
    mockFiles({ "/repo/packages/foo/AGENTS.md": "foo memory" });
    const loaded = new Set<string>();

    await findNestedMemoryFiles("/repo/packages/foo/a.ts", WORKDIR, loaded);

    expect(loaded.has("/repo/packages/foo/AGENTS.md")).toBe(true);
  });

  it("ignores a file outside the project", async () => {
    mockFiles({ "/elsewhere/AGENTS.md": "other memory" });

    const memories = await findNestedMemoryFiles(
      "/elsewhere/src/a.ts",
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([]);
    expect(fsPromises.readFile).not.toHaveBeenCalled();
  });

  it("ignores a file directly in the project root", async () => {
    mockFiles({ "/repo/AGENTS.md": "root memory" });

    const memories = await findNestedMemoryFiles(
      "/repo/package.json",
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([]);
  });

  it("keeps walking the chain when one directory's memory file is unreadable", async () => {
    vi.mocked(fsPromises.readFile).mockImplementation(async (filePath) => {
      const path = String(filePath);
      if (path === "/repo/a/AGENTS.md") {
        return "a memory" as unknown as Awaited<
          ReturnType<typeof fsPromises.readFile>
        >;
      }
      if (path === "/repo/a/b/AGENTS.md") {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    });

    const memories = await findNestedMemoryFiles(
      "/repo/a/b/c.ts",
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([
      { path: "/repo/a/AGENTS.md", content: "a memory" },
    ]);
  });
});
