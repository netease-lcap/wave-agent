import { describe, it, expect, vi, beforeEach } from "vitest";
import fsPromises from "node:fs/promises";
import * as nodeFs from "node:fs";
import * as path from "node:path";
import { findNestedSkillRoots } from "@/utils/nestedSkills.js";
import { resetWorktreePathCache } from "@/utils/worktreePaths.js";

vi.mock("node:fs/promises");

// Passthrough except for the probes the worktree mapping uses: fixture paths do
// not exist on disk, so `realpathSync` stands in for the OS call.
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

// The walk resolves its inputs with `path.resolve`, which on Windows prepends the
// cwd's drive letter; fixtures go through the same call or the mocked reader is
// asked for a path no key matches.
const WORKDIR = path.resolve("/repo");
const ELSEWHERE = path.resolve("/elsewhere");

/** A fixture path under the project root, in the platform's own form. */
const at = (...segments: string[]) => path.join(WORKDIR, ...segments);

/** Every `<dir>/.<config>/skills` spelling, for building fixture key sets. */
const CONFIG_DIRS = [".agents", ".claude", ".wave"] as const;

/** Which skill root directories exist, given as absolute paths. */
function givenSkillDirs(...skillRoots: string[]): void {
  const present = new Set(skillRoots);
  vi.mocked(fsPromises.stat).mockImplementation(async (target) => {
    if (!present.has(String(target))) {
      throw Object.assign(new Error(`ENOENT: ${String(target)}`), {
        code: "ENOENT",
      });
    }
    return { isDirectory: () => true } as unknown as Awaited<
      ReturnType<typeof fsPromises.stat>
    >;
  });
}

/** The two files of a worktree's git link chain, both plain files. */
function givenChainFilesArePlain(): void {
  vi.mocked(nodeFs.lstatSync).mockImplementation(
    () =>
      ({ isFile: () => true }) as unknown as ReturnType<
        typeof nodeFs.lstatSync
      >,
  );
}

/**
 * Make `worktree` look like a linked worktree of the checkout at WORKDIR: a
 * `.git` file pointing at `<checkout>/.git/worktrees/<name>`, which points back
 * and carries a `commondir`.
 */
function givenWorktreeAt(worktree: string): void {
  const gitfile = path.join(worktree, ".git");
  const gitDir = path.join(
    WORKDIR,
    ".git",
    "worktrees",
    path.basename(worktree),
  );
  givenChainFilesArePlain();
  vi.mocked(nodeFs.statSync).mockImplementation((p) => {
    if (String(p) === gitfile) {
      return { isFile: () => true } as unknown as ReturnType<
        typeof nodeFs.statSync
      >;
    }
    throw Object.assign(new Error(`ENOENT: ${String(p)}`), {
      code: "ENOENT",
    });
  });
  vi.mocked(nodeFs.readFileSync).mockImplementation((p) => {
    const requested = String(p);
    if (requested === gitfile) return `gitdir: ${gitDir}\n`;
    if (requested === path.join(gitDir, "commondir")) return "../..\n";
    if (requested === path.join(gitDir, "gitdir")) return `${gitfile}\n`;
    throw Object.assign(new Error(`ENOENT: ${requested}`), {
      code: "ENOENT",
    });
  });
}

describe("findNestedSkillRoots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorktreePathCache();
  });

  it("collects ancestor skill directories outermost first, skipping the project root", async () => {
    givenSkillDirs(
      at("packages", ".wave", "skills"),
      at("packages", "foo", ".wave", "skills"),
    );

    const roots = await findNestedSkillRoots(
      at("packages", "foo", "src", "a.ts"),
      WORKDIR,
      new Set(),
    );

    // Outer before inner: the caller writes them in order, so the deeper (more
    // specific) directory ends up winning a name collision.
    expect(roots).toEqual([
      at("packages", ".wave", "skills"),
      at("packages", "foo", ".wave", "skills"),
    ]);
  });

  it("probes all three config directories in one directory, lowest precedence first", async () => {
    givenSkillDirs(
      ...CONFIG_DIRS.map((config) => at("packages", config, "skills")),
    );

    const roots = await findNestedSkillRoots(
      at("packages", "a.ts"),
      WORKDIR,
      new Set(),
    );

    expect(roots).toEqual([
      at("packages", ".agents", "skills"),
      at("packages", ".claude", "skills"),
      at("packages", ".wave", "skills"),
    ]);
  });

  it("ignores a file directly in the project root", async () => {
    givenSkillDirs(at(".wave", "skills"));

    const roots = await findNestedSkillRoots(
      at("package.json"),
      WORKDIR,
      new Set(),
    );

    // The root level is loaded eagerly at startup.
    expect(roots).toEqual([]);
  });

  it("ignores a file outside the project", async () => {
    givenSkillDirs(path.join(ELSEWHERE, "packages", ".wave", "skills"));

    const roots = await findNestedSkillRoots(
      path.join(ELSEWHERE, "packages", "a.ts"),
      WORKDIR,
      new Set(),
    );

    expect(roots).toEqual([]);
    expect(fsPromises.stat).not.toHaveBeenCalled();
  });

  it("records misses, so a second file in the same subtree probes nothing", async () => {
    givenSkillDirs(at("packages", ".wave", "skills"));
    const probed = new Set<string>();

    const first = await findNestedSkillRoots(
      at("packages", "foo", "a.ts"),
      WORKDIR,
      probed,
    );
    vi.mocked(fsPromises.stat).mockClear();
    const second = await findNestedSkillRoots(
      at("packages", "foo", "b.ts"),
      WORKDIR,
      probed,
    );

    expect(first).toEqual([at("packages", ".wave", "skills")]);
    // "No skills anywhere down here" is the common case, and re-stat'ing the same
    // absent directories on every Read is what the set exists to prevent.
    expect(second).toEqual([]);
    expect(fsPromises.stat).not.toHaveBeenCalled();
  });

  it("probes a new level the session has not visited yet", async () => {
    givenSkillDirs(at("packages", "foo", ".wave", "skills"));
    const probed = new Set<string>();

    await findNestedSkillRoots(at("packages", "a.ts"), WORKDIR, probed);
    const deeper = await findNestedSkillRoots(
      at("packages", "foo", "a.ts"),
      WORKDIR,
      probed,
    );

    expect(deeper).toEqual([at("packages", "foo", ".wave", "skills")]);
  });

  it("skips dependency and build-output ancestors", async () => {
    givenSkillDirs(
      at("node_modules", "dep", ".claude", "skills"),
      at("packages", "node_modules", "dep", ".wave", "skills"),
      at("packages", "dist", ".wave", "skills"),
    );

    const roots = await findNestedSkillRoots(
      at("packages", "dist", "node_modules", "dep", "lib", "a.js"),
      WORKDIR,
      new Set(),
    );

    // A vendored or half-built `.claude/skills` must not become callable just
    // because the agent read a file inside it.
    expect(roots).toEqual([]);
  });

  it("skips dot-prefixed ancestors", async () => {
    givenSkillDirs(at(".venv", "lib", ".claude", "skills"));

    const roots = await findNestedSkillRoots(
      at(".venv", "lib", "python3", "a.py"),
      WORKDIR,
      new Set(),
    );

    expect(roots).toEqual([]);
  });

  it("keeps walking when one directory is unreadable", async () => {
    vi.mocked(fsPromises.stat).mockImplementation(async (target) => {
      const requested = String(target);
      if (requested === at("packages", ".wave", "skills")) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      if (requested === at("packages", "foo", ".claude", "skills")) {
        return { isDirectory: () => true } as unknown as Awaited<
          ReturnType<typeof fsPromises.stat>
        >;
      }
      throw Object.assign(new Error(`ENOENT: ${requested}`), {
        code: "ENOENT",
      });
    });

    const roots = await findNestedSkillRoots(
      at("packages", "foo", "a.ts"),
      WORKDIR,
      new Set(),
    );

    expect(roots).toEqual([at("packages", "foo", ".claude", "skills")]);
  });

  it("ignores a matching path that is a file rather than a directory", async () => {
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => false,
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

    const roots = await findNestedSkillRoots(
      at("packages", "a.ts"),
      WORKDIR,
      new Set(),
    );

    expect(roots).toEqual([]);
  });

  it("finds skills when the read happens in a linked worktree of the project", async () => {
    // A session that entered a worktree mid-flight keeps the checkout as its
    // workdir; walking in checkout coordinates and mapping each directory back
    // is what keeps subtree skills alive there.
    const worktree = at(".wave", "worktrees", "wt");
    givenWorktreeAt(worktree);
    givenSkillDirs(path.join(worktree, "packages", ".wave", "skills"));

    const roots = await findNestedSkillRoots(
      path.join(worktree, "packages", "foo", "a.ts"),
      WORKDIR,
      new Set(),
    );

    // The worktree's own copy is what gets loaded, not the checkout's.
    expect(roots).toEqual([path.join(worktree, "packages", ".wave", "skills")]);
  });

  it("stops at a session root that itself lives inside a worktree", async () => {
    // The session was opened in the worktree, so the subtree walk must both
    // start from there and stop there: it may not climb out into the checkout
    // (whose `.wave` segment would also be suppressed as excluded), and it may
    // not miss the worktree's own ancestors.
    const worktree = at(".wave", "worktrees", "wt");
    const sessionRoot = path.join(worktree, "packages");
    givenWorktreeAt(worktree);
    givenSkillDirs(
      path.join(worktree, "packages", "foo", ".wave", "skills"),
      // Outside the session root: never walked, since work never reached it.
      path.join(worktree, ".claude", "skills"),
    );

    const roots = await findNestedSkillRoots(
      path.join(worktree, "packages", "foo", "a.ts"),
      sessionRoot,
      new Set(),
    );

    expect(roots).toEqual([
      path.join(worktree, "packages", "foo", ".wave", "skills"),
    ]);
  });
});
