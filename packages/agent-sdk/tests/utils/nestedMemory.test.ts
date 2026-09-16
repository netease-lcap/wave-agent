import { describe, it, expect, vi, beforeEach } from "vitest";
import fsPromises from "node:fs/promises";
import * as path from "node:path";
import { findNestedMemoryFiles } from "@/utils/nestedMemory.js";

vi.mock("node:fs/promises");

// The walk resolves its inputs with `path.resolve`, which on Windows prepends
// the cwd's drive letter (`/repo` -> `C:\repo`). Fixture paths must go through
// the same call, or the mocked reader is asked for a path no key matches.
const WORKDIR = path.resolve("/repo");
const ELSEWHERE = path.resolve("/elsewhere");

/** A fixture path under the project root, in the platform's own form. */
const at = (...segments: string[]) => path.join(WORKDIR, ...segments);

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
      [at("packages/AGENTS.md")]: "packages memory",
      [at("packages/foo/AGENTS.md")]: "foo memory",
      [at("AGENTS.md")]: "root memory",
    });

    const memories = await findNestedMemoryFiles(
      at("packages/foo/src/a.ts"),
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([
      { path: at("packages/AGENTS.md"), content: "packages memory" },
      { path: at("packages/foo/AGENTS.md"), content: "foo memory" },
    ]);
    // The root memory file is loaded eagerly into every request already.
    expect(fsPromises.readFile).not.toHaveBeenCalledWith(
      at("AGENTS.md"),
      "utf-8",
    );
  });

  it("falls back to CLAUDE.md when AGENTS.md is absent", async () => {
    mockFiles({ [at("packages/CLAUDE.md")]: "legacy memory" });

    const memories = await findNestedMemoryFiles(
      at("packages/a.ts"),
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([
      { path: at("packages/CLAUDE.md"), content: "legacy memory" },
    ]);
  });

  it("prefers AGENTS.md over CLAUDE.md in the same directory", async () => {
    mockFiles({
      [at("packages/AGENTS.md")]: "agents memory",
      [at("packages/CLAUDE.md")]: "claude memory",
    });

    const memories = await findNestedMemoryFiles(
      at("packages/a.ts"),
      WORKDIR,
      new Set(),
    );

    expect(memories.map((m) => m.path)).toEqual([at("packages/AGENTS.md")]);
  });

  it("skips a directory whose memory file was already injected", async () => {
    mockFiles({
      [at("packages/AGENTS.md")]: "packages memory",
      [at("packages/foo/AGENTS.md")]: "foo memory",
    });
    const loaded = new Set([
      at("packages/AGENTS.md"),
      at("packages/CLAUDE.md"),
    ]);

    const memories = await findNestedMemoryFiles(
      at("packages/foo/src/a.ts"),
      WORKDIR,
      loaded,
    );

    expect(memories.map((m) => m.path)).toEqual([at("packages/foo/AGENTS.md")]);
    // An already-loaded AGENTS.md must not fall through to CLAUDE.md either.
    expect(fsPromises.readFile).not.toHaveBeenCalledWith(
      at("packages/CLAUDE.md"),
      "utf-8",
    );
  });

  it("records injected files in the dedup set", async () => {
    mockFiles({ [at("packages/foo/AGENTS.md")]: "foo memory" });
    const loaded = new Set<string>();

    await findNestedMemoryFiles(at("packages/foo/a.ts"), WORKDIR, loaded);

    expect(loaded.has(at("packages/foo/AGENTS.md"))).toBe(true);
  });

  it("ignores a file outside the project", async () => {
    mockFiles({ [path.join(ELSEWHERE, "AGENTS.md")]: "other memory" });

    const memories = await findNestedMemoryFiles(
      path.join(ELSEWHERE, "src/a.ts"),
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([]);
    expect(fsPromises.readFile).not.toHaveBeenCalled();
  });

  it("ignores a file directly in the project root", async () => {
    mockFiles({ [at("AGENTS.md")]: "root memory" });

    const memories = await findNestedMemoryFiles(
      at("package.json"),
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([]);
  });

  it("keeps walking the chain when one directory's memory file is unreadable", async () => {
    vi.mocked(fsPromises.readFile).mockImplementation(async (filePath) => {
      const requested = String(filePath);
      if (requested === at("a/AGENTS.md")) {
        return "a memory" as unknown as Awaited<
          ReturnType<typeof fsPromises.readFile>
        >;
      }
      if (requested === at("a/b/AGENTS.md")) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      throw Object.assign(new Error(`ENOENT: ${requested}`), {
        code: "ENOENT",
      });
    });

    const memories = await findNestedMemoryFiles(
      at("a/b/c.ts"),
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([
      { path: at("a/AGENTS.md"), content: "a memory" },
    ]);
  });
});
