import { describe, it, expect, vi, beforeEach } from "vitest";
import fsPromises from "node:fs/promises";
import * as nodeFs from "node:fs";
import * as path from "node:path";
import { findNestedMemoryFiles } from "@/utils/nestedMemory.js";
import {
  normalizePathForComparison,
  resetWorktreePathCache,
} from "@/utils/worktreePaths.js";

vi.mock("node:fs/promises");

// Passthrough except for the probes the worktree mapping uses. `realpathSync`
// stands in for the OS call: fixture paths do not exist on disk, and the
// mapping verifies a worktree's backlink through it.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: vi.fn(),
    lstatSync: vi.fn(),
    readFileSync: vi.fn(),
    realpathSync: Object.assign((p: string) => p, {
      native: (p: string) => p,
    }),
  };
});

// The walk resolves its inputs with `path.resolve`, which on Windows prepends
// the cwd's drive letter (`/repo` -> `C:\repo`). Fixture paths must go through
// the same call, or the mocked reader is asked for a path no key matches.
const WORKDIR = path.resolve("/repo");
const ELSEWHERE = path.resolve("/elsewhere");

/** A fixture path under the project root, in the platform's own form. */
const at = (...segments: string[]) => path.join(WORKDIR, ...segments);

/** The two files of a worktree's git link chain, both plain files. */
function givenChainFilesArePlain(): void {
  vi.mocked(nodeFs.lstatSync).mockImplementation(
    () =>
      ({ isFile: () => true }) as unknown as ReturnType<
        typeof nodeFs.lstatSync
      >,
  );
}

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
    resetWorktreePathCache();
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
    // The dedup set is keyed by the lexical path
    // (`normalizePathForComparison`), so a file already injected is skipped
    // even when this walk spells it differently.
    const loaded = new Set([
      normalizePathForComparison(at("packages/AGENTS.md")),
      normalizePathForComparison(at("packages/CLAUDE.md")),
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

  it("does not inject the same file twice when it is reached twice", async () => {
    mockFiles({ [at("packages/foo/AGENTS.md")]: "foo memory" });
    const loaded = new Set<string>();

    const first = await findNestedMemoryFiles(
      at("packages/foo/a.ts"),
      WORKDIR,
      loaded,
    );
    const second = await findNestedMemoryFiles(
      at("packages/foo/a.ts"),
      WORKDIR,
      loaded,
    );

    expect(first).toEqual([
      { path: at("packages/foo/AGENTS.md"), content: "foo memory" },
    ]);
    expect(second).toEqual([]);
  });

  it("skips a memory file the model already read itself", async () => {
    // Claude Code's `memoryFilesToAttachments` checks `readFileState` before
    // attaching: a file already in the model's context (it Read the file) must
    // not be pushed again.
    mockFiles({
      [at("packages/AGENTS.md")]: "packages memory",
      [at("packages/CLAUDE.md")]: "packages legacy memory",
      [at("packages/foo/AGENTS.md")]: "foo memory",
    });
    const read = new Set([at("packages/AGENTS.md")]);

    const memories = await findNestedMemoryFiles(
      at("packages/foo/a.ts"),
      WORKDIR,
      new Set(),
      (candidate) => read.has(candidate),
    );

    expect(memories.map((m) => m.path)).toEqual([at("packages/foo/AGENTS.md")]);
    // A file already in context must not fall through to CLAUDE.md either.
    expect(fsPromises.readFile).not.toHaveBeenCalledWith(
      at("packages/AGENTS.md"),
      "utf-8",
    );
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

  it("finds memory files when the read happens in a linked worktree of the project", async () => {
    // A session that entered a worktree mid-flight keeps the checkout as its
    // workdir; walking the worktree path in checkout coordinates (then mapping
    // each directory back) is what keeps nested memory alive there.
    const worktree = path.join(WORKDIR, ".wave", "worktrees", "wt");
    const worktreeGitfile = path.join(worktree, ".git");
    const worktreeGitDir = path.join(WORKDIR, ".git", "worktrees", "wt");
    givenChainFilesArePlain();
    vi.mocked(nodeFs.statSync).mockImplementation((p) => {
      if (String(p) === worktreeGitfile) {
        return {
          isFile: () => true,
        } as unknown as ReturnType<typeof nodeFs.statSync>;
      }
      throw Object.assign(new Error(`ENOENT: ${String(p)}`), {
        code: "ENOENT",
      });
    });
    vi.mocked(nodeFs.readFileSync).mockImplementation((p) => {
      const requested = String(p);
      if (requested === worktreeGitfile) {
        return `gitdir: ${worktreeGitDir}\n`;
      }
      if (requested === path.join(worktreeGitDir, "commondir")) {
        return "../..\n";
      }
      if (requested === path.join(worktreeGitDir, "gitdir")) {
        return `${worktreeGitfile}\n`;
      }
      throw Object.assign(new Error(`ENOENT: ${requested}`), {
        code: "ENOENT",
      });
    });
    mockFiles({
      [path.join(worktree, "packages", "AGENTS.md")]: "worktree package memory",
    });

    const memories = await findNestedMemoryFiles(
      path.join(worktree, "packages", "foo", "a.ts"),
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([
      {
        path: path.join(worktree, "packages", "AGENTS.md"),
        content: "worktree package memory",
      },
    ]);
  });

  it("never injects another checkout's root memory when the path cannot be mapped", async () => {
    // The mapping above only fires when the walk recognises the worktree as
    // related to this session's workdir. When it does not (a different spelling
    // of the same directory, a symlinked entry point), the walk falls back to
    // crawling the raw path — and would reach the worktree root, whose memory
    // file is a second copy of the root memory already loaded eagerly. The
    // guard has to drop that directory without dropping its children.
    const worktree = path.join(WORKDIR, ".wave", "worktrees", "wt");
    const worktreeGitfile = path.join(worktree, ".git");
    const elsewhereGitDir = path.join(ELSEWHERE, ".git", "worktrees", "wt");
    givenChainFilesArePlain();
    vi.mocked(nodeFs.statSync).mockImplementation((p) => {
      if (String(p) === worktreeGitfile) {
        return {
          isFile: () => true,
        } as unknown as ReturnType<typeof nodeFs.statSync>;
      }
      throw Object.assign(new Error(`ENOENT: ${String(p)}`), {
        code: "ENOENT",
      });
    });
    vi.mocked(nodeFs.readFileSync).mockImplementation((p) => {
      const requested = String(p);
      if (requested === worktreeGitfile) {
        // Points at a checkout this session's workdir is not part of.
        return `gitdir: ${elsewhereGitDir}\n`;
      }
      if (requested === path.join(elsewhereGitDir, "commondir"))
        return "../..\n";
      if (requested === path.join(elsewhereGitDir, "gitdir")) {
        return `${worktreeGitfile}\n`;
      }
      throw Object.assign(new Error(`ENOENT: ${requested}`), {
        code: "ENOENT",
      });
    });
    mockFiles({
      [path.join(worktree, "AGENTS.md")]: "worktree root memory",
      [path.join(worktree, "packages", "AGENTS.md")]: "worktree package memory",
    });

    const memories = await findNestedMemoryFiles(
      path.join(worktree, "packages", "a.ts"),
      WORKDIR,
      new Set(),
    );

    expect(memories).toEqual([
      {
        path: path.join(worktree, "packages", "AGENTS.md"),
        content: "worktree package memory",
      },
    ]);
    expect(fsPromises.readFile).not.toHaveBeenCalledWith(
      path.join(worktree, "AGENTS.md"),
      "utf-8",
    );
  });
});
