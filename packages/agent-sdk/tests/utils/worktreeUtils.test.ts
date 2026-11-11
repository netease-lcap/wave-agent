import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as worktreeUtils from "@/utils/worktreeUtils.js";
import * as worktreeRemoval from "@/utils/worktreeRemoval.js";
import * as gitUtils from "@/utils/gitUtils.js";
import { clearGlobalLogger, setGlobalLogger } from "@/utils/globalLogger.js";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";

interface GitResult {
  stdout: string;
  stderr: string;
}

const { git } = vi.hoisted(() => {
  const git = {
    calls: [] as Array<{ cmd: string; args: string[]; opts: unknown }>,
    handler: (): GitResult => ({ stdout: "", stderr: "" }) as GitResult,
  } as {
    calls: Array<{ cmd: string; args: string[]; opts: unknown }>;
    handler: (cmd: string, args: string[], opts: unknown) => GitResult;
  };
  return { git };
});

vi.mock("node:child_process", async () => {
  // execFileAsyncHidden drives this through node native callback shape —
  // (error, stdout, stderr). Answering with one merged object instead hides
  // exactly the shape mismatch that once shipped a bare-stdout regression.
  const execFile = vi.fn(
    (
      cmd: string,
      args: string[],
      opts: unknown,
      cb?: (err: unknown, stdout?: string, stderr?: string) => void,
    ) => {
      git.calls.push({ cmd, args, opts });
      try {
        const res: GitResult = git.handler(cmd, args, opts);
        cb?.(null, res.stdout, res.stderr);
      } catch (error) {
        cb?.(error);
      }
      return {};
    },
  );
  return { execFile, execFileSync: vi.fn() };
});

/**
 * Fake filesystem for the removal tests.
 *
 * The removal touches the tree in a specific ORDER — unlink the `.git` pointer,
 * then delete the directory, then (on failure) write the pointer back — so the
 * fake records every mutating call in `ops`. Order is the whole point of the
 * implementation, and only an ordered log can assert it.
 */
const fakeFs = vi.hoisted(() => {
  interface FakeEntry {
    name: string;
    link: boolean;
    dir: boolean;
  }
  const state = {
    /** Regular files: path → text content */
    files: new Map<string, string>(),
    /** Directories that exist without being anybody's readdir result */
    dirs: new Set<string>(),
    /** Directory → entries `readdirSync` reports for it */
    children: new Map<string, FakeEntry[]>(),
    /** Reparse points: `unlinkSync` fails on them, `rmdirSync` removes them */
    links: new Set<string>(),
    rmError: null as unknown,
    unlinkError: null as unknown,
    writeError: null as unknown,
    /** Mutating calls in order: "unlink:<path>", "rm:<path>", "write:<path>"… */
    ops: [] as string[],
    written: [] as Array<{ file: string; content: unknown }>,
    /** rmSync is called with the Windows extended-length prefix; strip it */
    key(p: unknown) {
      return String(p).replace(/^\\\\\?\\/, "");
    },
    reset() {
      state.files.clear();
      state.dirs.clear();
      state.children.clear();
      state.links.clear();
      state.rmError = null;
      state.unlinkError = null;
      state.writeError = null;
      state.ops = [];
      state.written = [];
    },
  };
  return state;
});

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  lstatSync: vi.fn(),
  realpathSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  rmSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    copyFile: vi.fn(),
    cp: vi.fn(),
  },
}));

vi.mock("@/utils/gitUtils.js");

function gitCallsWith(fragments: string[]) {
  return git.calls.filter((c) => fragments.every((f) => c.args.includes(f)));
}

function enoent() {
  return Object.assign(new Error("ENOENT: no such file or directory"), {
    code: "ENOENT",
  });
}

/** readFile mock that returns content for exact paths and ENOENT otherwise */
function mockReadFile(map: Record<string, string>) {
  vi.mocked(fs.promises.readFile).mockImplementation(async (p) => {
    for (const [filePath, content] of Object.entries(map)) {
      if (p === filePath) return content;
    }
    throw enoent();
  });
}

describe("worktreeUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    git.calls.length = 0;
    git.handler = () => ({ stdout: "", stderr: "" });
    // Default: neither settings.local.json nor .worktreeinclude exist
    vi.mocked(fs.promises.readFile).mockRejectedValue(enoent());
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.copyFile).mockResolvedValue(undefined);
    vi.mocked(fs.promises.cp).mockResolvedValue(undefined);
  });

  describe("validateWorktreeName", () => {
    it("accepts valid names", () => {
      expect(() =>
        worktreeUtils.validateWorktreeName("my-feature"),
      ).not.toThrow();
      expect(() => worktreeUtils.validateWorktreeName("a")).not.toThrow();
      expect(() => worktreeUtils.validateWorktreeName("foo/bar")).not.toThrow();
      expect(() =>
        worktreeUtils.validateWorktreeName("feat_1.0"),
      ).not.toThrow();
    });

    it("rejects names longer than 64 chars", () => {
      const longName = "a".repeat(65);
      expect(() => worktreeUtils.validateWorktreeName(longName)).toThrow(
        "Invalid worktree name: must be 64 characters or fewer",
      );
    });

    it("rejects names with . or .. segments", () => {
      expect(() => worktreeUtils.validateWorktreeName("../escape")).toThrow(
        'must not contain "." or ".."',
      );
      expect(() => worktreeUtils.validateWorktreeName("foo/./bar")).toThrow(
        'must not contain "." or ".."',
      );
    });

    it("rejects names with invalid characters", () => {
      expect(() => worktreeUtils.validateWorktreeName("foo bar")).toThrow(
        "must be non-empty and contain only letters",
      );
      expect(() => worktreeUtils.validateWorktreeName("foo@bar")).toThrow();
    });

    it("rejects names with empty segments (leading/trailing/double slash)", () => {
      expect(() => worktreeUtils.validateWorktreeName("/foo")).toThrow();
      expect(() => worktreeUtils.validateWorktreeName("foo/")).toThrow();
      expect(() => worktreeUtils.validateWorktreeName("foo//bar")).toThrow();
    });

    it("rejects the reserved ephemeral prefix", () => {
      // The stale-worktree sweep deletes `sa-*` worktrees, so a user-chosen
      // name in that namespace would be garbage-collected out from under them.
      expect(() =>
        worktreeUtils.validateWorktreeName("sa-swift-fox-123"),
      ).toThrow('the "sa-" prefix is reserved');
      expect(() => worktreeUtils.validateWorktreeName("sa-mine")).toThrow(
        'the "sa-" prefix is reserved',
      );
    });
  });

  describe("generateWorktreeName", () => {
    it("returns a string in adjective-noun-number format", () => {
      const name = worktreeUtils.generateWorktreeName();
      expect(typeof name).toBe("string");
      expect(name).toMatch(/^[a-z]+-[a-z]+-\d{3}$/);
    });

    it("does not produce the reserved ephemeral prefix", () => {
      for (let i = 0; i < 50; i++) {
        expect(worktreeUtils.generateWorktreeName()).not.toMatch(/^sa-/);
      }
    });
  });

  describe("generateEphemeralWorktreeName", () => {
    it("prefixes the name so the sweep can recognise it", () => {
      const name = worktreeUtils.generateEphemeralWorktreeName();
      expect(name).toMatch(/^sa-[a-z]+-[a-z]+-\d{3}$/);
      expect(worktreeUtils.isEphemeralWorktreeName(name)).toBe(true);
    });
  });

  describe("isEphemeralWorktreeName", () => {
    it("accepts only the exact ephemeral shape", () => {
      expect(worktreeUtils.isEphemeralWorktreeName("sa-swift-fox-123")).toBe(
        true,
      );
    });

    it("rejects user-facing and malformed names", () => {
      for (const name of [
        "swift-fox-123", // pre-prefix ephemeral / EnterWorktree auto name
        "sa-swift-fox", // no digits
        "sa-swift-fox-1234", // digits are exactly three
        "sa-swift-fox-123/extra", // never nested
        "SA-swift-fox-123",
        "sa_mine-1",
        "narrow-quiet-glacier", // session worktree auto name
      ]) {
        expect(worktreeUtils.isEphemeralWorktreeName(name)).toBe(false);
      }
    });
  });

  describe("worktreeBranchName", () => {
    it("prefixes with worktree-", () => {
      expect(worktreeUtils.worktreeBranchName("my-feature")).toBe(
        "worktree-my-feature",
      );
    });
  });

  describe("getHeadCommit", () => {
    it("returns HEAD commit SHA", () => {
      vi.mocked(execFileSync).mockReturnValue("abc123def\n");

      const result = worktreeUtils.getHeadCommit("/test");

      expect(result).toBe("abc123def");
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["-C"]),
        expect.objectContaining({ encoding: "utf8" }),
      );
    });
  });

  describe("createWorktree", () => {
    beforeEach(() => {
      vi.mocked(gitUtils.getGitMainRepoRoot).mockReturnValue("/test/repo");
      vi.mocked(gitUtils.getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(execFileSync).mockReturnValue("abc123\n");
      vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    it("creates a new worktree", () => {
      const result = worktreeUtils.createWorktree("my-feat", "/test");

      expect(result.name).toBe("my-feat");
      expect(result.branch).toBe("worktree-my-feat");
      expect(result.path).toBe(
        path.join("/test/repo", ".wave", "worktrees", "my-feat"),
      );
      expect(result.repoRoot).toBe("/test/repo");
      expect(result.isNew).toBe(true);
      expect(result.originalHeadCommit).toBe("abc123");
    });

    it("uses HEAD as base when baseRef is 'head'", () => {
      const result = worktreeUtils.createWorktree("my-feat", "/test", {
        baseRef: "head",
      });

      expect(result.isNew).toBe(true);
      // git worktree add -b <branch> <path> HEAD
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["HEAD"]),
        expect.anything(),
      );
      // Should NOT call getDefaultRemoteBranch
      expect(gitUtils.getDefaultRemoteBranch).not.toHaveBeenCalled();
    });

    it("uses origin default branch when baseRef is 'fresh'", () => {
      worktreeUtils.createWorktree("my-feat", "/test", { baseRef: "fresh" });

      expect(gitUtils.getDefaultRemoteBranch).toHaveBeenCalledWith("/test");
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["origin/main"]),
        expect.anything(),
      );
    });

    it("defaults to 'fresh' behavior when baseRef is undefined", () => {
      worktreeUtils.createWorktree("my-feat", "/test");

      expect(gitUtils.getDefaultRemoteBranch).toHaveBeenCalledWith("/test");
    });

    it("reuses existing worktree", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = worktreeUtils.createWorktree("existing", "/test");

      expect(result.isNew).toBe(false);
      expect(execFileSync).not.toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "add", "-b"]),
        expect.anything(),
      );
    });

    it("throws when not in a git repository", () => {
      vi.mocked(gitUtils.getGitMainRepoRoot).mockReturnValue(null as never);

      expect(() => worktreeUtils.createWorktree("feat", "/test")).toThrow(
        "Cannot create a worktree: not in a git repository",
      );
    });

    it("handles branch already exists fallback", () => {
      let callCount = 0;
      vi.mocked(execFileSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // getHeadCommit
          return "abc123\n";
        }
        if (callCount === 2) {
          // First git worktree add -b fails
          const err = new Error("git error") as Error & {
            stderr?: Buffer;
          };
          err.stderr = Buffer.from("already exists");
          throw err;
        }
        // Second git worktree add (without -b) succeeds
        return "";
      });

      const result = worktreeUtils.createWorktree("feat", "/test");

      expect(result.isNew).toBe(true);
    });

    it("should fetch default branch when not found locally, then create worktree", () => {
      let callCount = 0;
      vi.mocked(execFileSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // getHeadCommit
          return "abc123\n";
        }
        if (callCount === 2) {
          // First git worktree add -b fails — branch not fetched
          const err = new Error("git error") as Error & {
            stderr?: Buffer;
          };
          err.stderr = Buffer.from("not a valid object name");
          throw err;
        }
        if (callCount === 3) {
          // git fetch origin main succeeds
          return "";
        }
        // Retry git worktree add -b succeeds
        return "";
      });

      const result = worktreeUtils.createWorktree("feat", "/test");

      expect(result.isNew).toBe(true);
      expect(result.originalHeadCommit).toBe("abc123");
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["fetch", "origin", "main"]),
        expect.anything(),
      );
    });

    it("should fall back to HEAD when fetch also fails", () => {
      let callCount = 0;
      vi.mocked(execFileSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // getHeadCommit
          return "abc123\n";
        }
        if (callCount === 2) {
          // First git worktree add -b fails
          const err = new Error("git error") as Error & {
            stderr?: Buffer;
          };
          err.stderr = Buffer.from("not a valid object name");
          throw err;
        }
        if (callCount === 3) {
          // git fetch origin main fails
          throw new Error("fetch failed");
        }
        // git worktree add -b ... HEAD succeeds
        return "";
      });

      const result = worktreeUtils.createWorktree("feat", "/test");

      expect(result.isNew).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining([
          "worktree",
          "add",
          "-b",
          "worktree-feat",
          "HEAD",
        ]),
        expect.anything(),
      );
    });

    it("should throw when both fetch and HEAD fallback fail", () => {
      let callCount = 0;
      vi.mocked(execFileSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // getHeadCommit
          return "abc123\n";
        }
        if (callCount === 2) {
          // First git worktree add -b fails
          const err = new Error("git error") as Error & {
            stderr?: Buffer;
          };
          err.stderr = Buffer.from("not a valid object name");
          throw err;
        }
        if (callCount === 3) {
          // git fetch origin main fails
          throw new Error("fetch failed");
        }
        // git worktree add -b ... HEAD also fails
        throw new Error("HEAD fallback failed");
      });

      expect(() => worktreeUtils.createWorktree("feat", "/test")).toThrow(
        "Failed to create worktree",
      );
    });

    it("should NOT attempt fetch when baseRef is 'head' and creation fails", () => {
      let callCount = 0;
      vi.mocked(execFileSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // getHeadCommit
          return "abc123\n";
        }
        if (callCount === 2) {
          // git worktree add -b ... HEAD fails
          const err = new Error("git error") as Error & {
            stderr?: Buffer;
          };
          err.stderr = Buffer.from("not a valid object name");
          throw err;
        }
        return "";
      });

      expect(() =>
        worktreeUtils.createWorktree("feat", "/test", { baseRef: "head" }),
      ).toThrow("Failed to create worktree");
      // Should not call git fetch
      expect(execFileSync).not.toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["fetch"]),
        expect.anything(),
      );
    });
  });

  describe("removeWorktree", () => {
    const REPO_ROOT = path.resolve("/test/repo");
    const WORKTREE_PATH = path.join(REPO_ROOT, ".wave", "worktrees", "feat");
    const GIT_DIR = path.join(REPO_ROOT, ".git", "worktrees", "feat");
    const DOT_GIT = path.join(WORKTREE_PATH, ".git");
    const INFO = {
      name: "feat",
      path: WORKTREE_PATH,
      branch: "worktree-feat",
      repoRoot: REPO_ROOT,
      isNew: true,
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    function failWith(code: string) {
      return Object.assign(new Error(`${code}: mocked failure`), { code });
    }

    /**
     * Point every fs call at `fakeFs`. Installed per test rather than in the
     * module factory so no other suite can leave a stale implementation behind.
     */
    function installFakeFs() {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const key = fakeFs.key(p);
        return (
          fakeFs.files.has(key) ||
          fakeFs.dirs.has(key) ||
          fakeFs.children.has(key) ||
          fakeFs.links.has(key)
        );
      });
      vi.mocked(fs.readFileSync).mockImplementation(((
        p: string,
        encoding?: string,
      ) => {
        const content = fakeFs.files.get(fakeFs.key(p));
        if (content === undefined) throw failWith("ENOENT");
        return encoding ? content : Buffer.from(content);
      }) as unknown as typeof fs.readFileSync);
      vi.mocked(fs.readdirSync).mockImplementation(((
        p: string,
        options?: { withFileTypes?: boolean },
      ) => {
        const entries = fakeFs.children.get(fakeFs.key(p));
        if (entries === undefined) throw failWith("ENOENT");
        if (options?.withFileTypes) {
          return entries.map((entry) => ({
            name: entry.name,
            isSymbolicLink: () => entry.link,
            isDirectory: () => entry.dir,
            isFile: () => !entry.dir && !entry.link,
          }));
        }
        return entries.map((entry) => entry.name);
      }) as unknown as typeof fs.readdirSync);
      vi.mocked(fs.rmSync).mockImplementation(((p: string) => {
        const key = fakeFs.key(p);
        if (fakeFs.rmError) throw fakeFs.rmError;
        fakeFs.ops.push(`rm:${key}`);
        fakeFs.dirs.delete(key);
        fakeFs.children.delete(key);
        fakeFs.links.delete(key);
        for (const file of [...fakeFs.files.keys()]) {
          if (file === key || /^[\\/]/.test(file.slice(key.length))) {
            fakeFs.files.delete(file);
          }
        }
      }) as unknown as typeof fs.rmSync);
      vi.mocked(fs.unlinkSync).mockImplementation(((p: string) => {
        const key = fakeFs.key(p);
        if (fakeFs.unlinkError) throw fakeFs.unlinkError;
        // A junction is a directory reparse point: unlink does not remove it.
        if (fakeFs.links.has(key)) throw failWith("EPERM");
        if (!fakeFs.files.has(key)) throw failWith("ENOENT");
        fakeFs.files.delete(key);
        fakeFs.ops.push(`unlink:${key}`);
      }) as unknown as typeof fs.unlinkSync);
      vi.mocked(fs.rmdirSync).mockImplementation(((p: string) => {
        const key = fakeFs.key(p);
        if (!fakeFs.links.has(key)) throw failWith("ENOTEMPTY");
        fakeFs.links.delete(key);
        fakeFs.ops.push(`rmdir:${key}`);
      }) as unknown as typeof fs.rmdirSync);
      vi.mocked(fs.writeFileSync).mockImplementation(((
        p: string,
        content: unknown,
      ) => {
        const key = fakeFs.key(p);
        if (fakeFs.writeError) throw fakeFs.writeError;
        fakeFs.files.set(key, String(content));
        fakeFs.written.push({ file: key, content });
        fakeFs.ops.push(`write:${key}`);
      }) as unknown as typeof fs.writeFileSync);
    }

    /** A linked worktree of REPO_ROOT that git still registers. */
    function givenRegisteredWorktree() {
      fakeFs.dirs.add(WORKTREE_PATH);
      fakeFs.dirs.add(GIT_DIR);
      fakeFs.files.set(DOT_GIT, `gitdir: ${GIT_DIR}\n`);
      fakeFs.children.set(WORKTREE_PATH, []);
    }

    /** Git subcommands issued, in order — `["worktree prune", "branch -D x"]`. */
    function gitOps(): string[] {
      return vi
        .mocked(execFileSync)
        .mock.calls.map(([, args]) => (args as string[]).join(" "));
    }

    beforeEach(() => {
      fakeFs.reset();
      installFakeFs();
      vi.mocked(execFileSync).mockReturnValue("");
      vi.mocked(fs.realpathSync).mockImplementation((p) => String(p));
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
      } as unknown as ReturnType<typeof fs.lstatSync>);
      setGlobalLogger(logger);
    });

    afterEach(() => {
      clearGlobalLogger();
    });

    it("deletes the .git pointer before the directory, then prunes and deletes the branch", () => {
      givenRegisteredWorktree();

      worktreeUtils.removeWorktree(INFO);

      // The order IS the implementation: pointer first, directory second. The
      // previous implementation ran `git worktree remove --force` here instead.
      expect(fakeFs.ops).toEqual([`unlink:${DOT_GIT}`, `rm:${WORKTREE_PATH}`]);
      expect(
        gitOps().filter((op) => op.includes("worktree remove")),
      ).toHaveLength(0);
      // prune has to run before branch -D: git refuses to delete a branch a
      // still-registered worktree has checked out.
      expect(gitOps()).toEqual(["worktree prune", "branch -D worktree-feat"]);
      expect(vi.mocked(fs.rmSync)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true, force: true }),
      );
    });

    it("uses an extended-length path for fs.rmSync on Windows", () => {
      givenRegisteredWorktree();

      worktreeUtils.removeWorktree(INFO);

      const [rmPath] = vi.mocked(fs.rmSync).mock.calls[0];
      if (process.platform === "win32") {
        expect(String(rmPath)).toMatch(/^\\\\\?\\/);
      } else {
        expect(rmPath).toBe(WORKTREE_PATH);
      }
    });

    it("restores the .git pointer and keeps the branch when the delete fails", () => {
      givenRegisteredWorktree();
      const original = fakeFs.files.get(DOT_GIT);
      fakeFs.rmError = failWith("EPERM");

      expect(() => worktreeUtils.removeWorktree(INFO)).not.toThrow();

      // "Directory still there" must keep meaning "git still knows about it":
      // the pointer goes back byte-for-byte, and the branch is kept.
      expect(fakeFs.written).toEqual([
        { file: DOT_GIT, content: expect.anything() },
      ]);
      expect(String(fakeFs.written[0].content)).toBe(original);
      expect(fakeFs.files.get(DOT_GIT)).toBe(original);
      expect(gitOps()).toEqual([]);
      // EPERM is translated, not just passed through: the errno alone tells a
      // user nothing about what to close.
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to remove worktree directory"),
        expect.objectContaining({
          reason: expect.stringContaining("one of the worktree's files open"),
          gitPointerRestored: true,
        }),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("keeping worktree-feat"),
        expect.anything(),
      );
    });

    it("reports both errors when even the write-back fails", () => {
      givenRegisteredWorktree();
      fakeFs.rmError = failWith("EBUSY");
      fakeFs.writeError = failWith("EROFS");

      worktreeUtils.removeWorktree(INFO);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("failed to restore its .git"),
        expect.objectContaining({
          reason: expect.stringContaining("one of the worktree's files open"),
          restoreError: "EROFS: mocked failure",
        }),
      );
      // The delete error is not masked by the write-back error.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("keeping worktree-feat"),
        expect.anything(),
      );
    });

    it("refuses a worktree git was told to lock", () => {
      givenRegisteredWorktree();
      fakeFs.files.set(
        path.join(GIT_DIR, "locked"),
        "in use by a long build\n",
      );

      worktreeUtils.removeWorktree(INFO);

      expect(fakeFs.ops).toEqual([]);
      expect(gitOps()).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("git worktree unlock"),
        expect.objectContaining({ refusal: "locked" }),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("in use by a long build"),
        expect.anything(),
      );
    });

    it("refuses a directory whose .git points at another repo", () => {
      // An independent clone: its `.git` holds the only copy of its history, so
      // removing the directory would destroy the repository.
      fakeFs.dirs.add(WORKTREE_PATH);
      fakeFs.files.set(
        DOT_GIT,
        `gitdir: ${path.join(path.resolve("/elsewhere/clone"), ".git")}\n`,
      );
      fakeFs.children.set(WORKTREE_PATH, []);

      worktreeUtils.removeWorktree(INFO);

      expect(fakeFs.ops).toEqual([]);
      expect(gitOps()).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("does not point into this repo"),
        expect.anything(),
      );
    });

    it("refuses the main working tree", () => {
      fakeFs.dirs.add(REPO_ROOT);

      worktreeUtils.removeWorktree({ ...INFO, path: REPO_ROOT });

      expect(fakeFs.ops).toEqual([]);
      expect(gitOps()).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("main working tree"),
        expect.anything(),
      );
    });

    it("refuses a .git that is not a gitfile at all", () => {
      fakeFs.dirs.add(WORKTREE_PATH);
      fakeFs.files.set(DOT_GIT, "garbage");
      fakeFs.children.set(WORKTREE_PATH, []);

      worktreeUtils.removeWorktree(INFO);

      expect(fakeFs.ops).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("its .git pointer is unusable"),
        expect.anything(),
      );
    });

    it("deletes a directory whose .git is already gone as a plain leftover", () => {
      // A previous cleanup already removed the pointer: git does not know about
      // this directory any more, so there is nothing to unlink and nothing to
      // restore — it is just files.
      fakeFs.dirs.add(WORKTREE_PATH);
      fakeFs.children.set(WORKTREE_PATH, [
        { name: "src", link: false, dir: true },
      ]);

      worktreeUtils.removeWorktree(INFO);

      expect(fakeFs.ops).toEqual([`rm:${WORKTREE_PATH}`]);
      expect(gitOps()).toEqual(["worktree prune", "branch -D worktree-feat"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("plain leftover"),
        expect.anything(),
      );
    });

    it("still deletes the branch when the directory is already gone", () => {
      // Idempotent: a repeated removal finds no directory but must not leave
      // the branch behind.
      worktreeUtils.removeWorktree(INFO);

      expect(fakeFs.ops).toEqual([]);
      expect(gitOps()).toEqual(["worktree prune", "branch -D worktree-feat"]);
    });

    it("keeps the branch when the directory survives a successful delete", () => {
      givenRegisteredWorktree();
      // rmSync reports success but the directory is still listed afterwards
      // (something re-created it): the branch is the only ref back to its work.
      fakeFs.dirs.add(WORKTREE_PATH);
      fakeFs.children.set(WORKTREE_PATH, []);
      vi.mocked(fs.rmSync).mockImplementation((() => {
        fakeFs.ops.push(`rm:${WORKTREE_PATH}`);
      }) as unknown as typeof fs.rmSync);

      worktreeUtils.removeWorktree(INFO);

      expect(gitOps()).toEqual(["worktree prune"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("keeping worktree-feat"),
        expect.anything(),
      );
    });

    it("aborts when the .git pointer cannot be unlinked", () => {
      givenRegisteredWorktree();
      fakeFs.unlinkError = failWith("EPERM");

      worktreeUtils.removeWorktree(INFO);

      // Deleting the directory with a live registration would leave a dangling
      // entry — exactly the half-state this rework exists to remove.
      expect(fakeFs.ops).toEqual([]);
      expect(gitOps()).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("could not detach its .git"),
        expect.objectContaining({ stage: "unlink .git" }),
      );
    });

    it("treats an already-unlinked .git as nothing to restore", () => {
      // present at the pre-check read, gone by the time we unlink it
      givenRegisteredWorktree();
      vi.mocked(fs.unlinkSync).mockImplementation(((p: string) => {
        fakeFs.files.delete(fakeFs.key(p));
        throw failWith("ENOENT");
      }) as unknown as typeof fs.unlinkSync);
      fakeFs.rmError = failWith("EBUSY");

      worktreeUtils.removeWorktree(INFO);

      // The delete still ran; there was no pointer left to write back, and that
      // is not reported as a restore failure.
      expect(fakeFs.written).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to remove worktree directory"),
        expect.objectContaining({ gitPointerRestored: false }),
      );
    });

    it.runIf(process.platform === "win32")(
      "unlinks junctions before the delete so rmSync sees plain directories",
      () => {
        givenRegisteredWorktree();
        const nodeModules = path.join(WORKTREE_PATH, "node_modules");
        const pnpmLink = path.join(nodeModules, "deps", "foo");
        fakeFs.children.set(WORKTREE_PATH, [
          { name: "node_modules", link: false, dir: true },
        ]);
        fakeFs.children.set(nodeModules, [
          { name: "deps", link: false, dir: true },
        ]);
        fakeFs.children.set(path.join(nodeModules, "deps"), [
          { name: "foo", link: true, dir: false },
        ]);
        fakeFs.links.add(pnpmLink);

        worktreeUtils.removeWorktree(INFO);

        // The junction is gone before the recursive delete starts.
        expect(fakeFs.ops).toEqual([
          `rmdir:${pnpmLink}`,
          `unlink:${DOT_GIT}`,
          `rm:${WORKTREE_PATH}`,
        ]);
        expect(logger.info).toHaveBeenCalledWith(
          expect.stringContaining("reparse points"),
          expect.objectContaining({ unlinked: 1 }),
        );
      },
    );

    it.runIf(process.platform === "win32")(
      "names an unremovable junction in the failure log",
      () => {
        givenRegisteredWorktree();
        const stuck = path.join(WORKTREE_PATH, "locked-link");
        fakeFs.children.set(WORKTREE_PATH, [
          { name: "locked-link", link: true, dir: false },
        ]);
        fakeFs.links.add(stuck);
        // Neither unlink nor rmdir can take it (a real junction in use).
        vi.mocked(fs.rmdirSync).mockImplementation((() => {
          throw failWith("EBUSY");
        }) as unknown as typeof fs.rmdirSync);
        fakeFs.rmError = failWith("ENOTEMPTY");

        worktreeUtils.removeWorktree(INFO);

        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining("Failed to remove worktree directory"),
          expect.objectContaining({
            reason: expect.stringContaining(`could not be removed: ${stuck}`),
          }),
        );
      },
    );

    it("transfers the extended-length-path note for ENAMETOOLONG", () => {
      givenRegisteredWorktree();
      fakeFs.rmError = failWith("ENAMETOOLONG");

      worktreeUtils.removeWorktree(INFO);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to remove worktree directory"),
        expect.objectContaining({
          reason: expect.stringContaining("extended-length"),
        }),
      );
    });

    // Nested: the outcome text is a probe of the same directory, so it runs on
    // the same fake filesystem and its helpers.
    describe("describeWorktreeRemovalOutcome", () => {
      const OUTCOME = {
        worktreePath: WORKTREE_PATH,
        repoRoot: REPO_ROOT,
        branch: "worktree-feat",
      };

      /** The text a caller prints when the removal returned "not gone". */
      function outcomeFor(overrides: Partial<typeof OUTCOME> = {}): string {
        return worktreeRemoval.describeWorktreeRemovalOutcome({
          ...OUTCOME,
          ...overrides,
        });
      }

      beforeEach(() => {
        fakeFs.reset();
        installFakeFs();
        // The decision "is <path>/.git a directory" is an lstat, and the shared
        // helper above leaves that mock to each suite.
        vi.mocked(fs.lstatSync).mockImplementation(((p: string) => ({
          isSymbolicLink: () => fakeFs.links.has(fakeFs.key(p)),
          isDirectory: () => fakeFs.dirs.has(fakeFs.key(p)),
          isFile: () => fakeFs.files.has(fakeFs.key(p)),
        })) as unknown as typeof fs.lstatSync);
      });

      it("says the main working tree was left alone, with no cleanup command", () => {
        fakeFs.dirs.add(REPO_ROOT);

        const text = outcomeFor({ worktreePath: REPO_ROOT });

        expect(text).toContain("main working tree");
        expect(text).toContain("nothing was deleted");
        // The whole point: no destructive advice for something that is not a
        // worktree at all.
        expect(text).not.toContain("rm -rf");
        expect(text).not.toContain("branch -D");
      });

      it("refuses to advise deleting a directory that is its own repository", () => {
        // `.git` as a *directory*: an independent clone, whose objects and
        // history exist only there.
        fakeFs.dirs.add(WORKTREE_PATH);
        fakeFs.dirs.add(path.join(WORKTREE_PATH, ".git"));

        const text = outcomeFor();

        expect(text).toContain("independent repository");
        expect(text).toContain("deleting it would destroy the repository");
        expect(text).not.toContain("Clean up manually");
        expect(text).not.toContain("branch -D");
      });

      it("treats a gitfile pointing outside this repo as an independent repository", () => {
        fakeFs.dirs.add(WORKTREE_PATH);
        fakeFs.files.set(
          DOT_GIT,
          `gitdir: ${path.join(path.resolve("/somewhere/else"), ".git")}\n`,
        );

        const text = outcomeFor();

        expect(text).toContain("independent repository");
        expect(text).toContain("deleting it would destroy the repository");
        expect(text).not.toContain("Clean up manually");
      });

      it("names the lock reason and offers unlock instead of rm", () => {
        givenRegisteredWorktree();
        fakeFs.files.set(
          path.join(GIT_DIR, "locked"),
          "in use by a long build\n",
        );

        const text = outcomeFor();

        expect(text).toContain("is locked (in use by a long build)");
        expect(text).toContain(`git worktree unlock ${WORKTREE_PATH}`);
        // Bypassing the lock would leave the registration dangling.
        expect(text).not.toContain("rm -rf");
        expect(text).not.toContain("branch -D");
      });

      it("does not advise deleting a directory it could not verify", () => {
        fakeFs.dirs.add(WORKTREE_PATH);
        fakeFs.files.set(DOT_GIT, "not a gitfile at all\n");

        const text = outcomeFor();

        expect(text).toContain("could not verify");
        expect(text).not.toContain("rm -rf");
        expect(text).not.toContain("branch -D");
      });

      it("keeps the manual-cleanup wording for a genuine delete failure", () => {
        // The pointer is back in place (the delete failed and was rolled back),
        // so this is a real leftover of this repo: the two commands are right.
        givenRegisteredWorktree();

        const text = outcomeFor();

        expect(text).toBe(
          `Worktree directory survived at ${WORKTREE_PATH}; kept branch ` +
            `worktree-feat so the leftover checkout stays reachable\n` +
            `Clean up manually: rm -rf ${WORKTREE_PATH} && git -C ` +
            `${REPO_ROOT} branch -D worktree-feat`,
        );
      });

      it("drops the branch command when the caller could not name a branch", () => {
        givenRegisteredWorktree();

        const text = outcomeFor({ branch: "" });

        expect(text).toContain("kept every branch");
        expect(text).toContain(`Clean up manually: rm -rf ${WORKTREE_PATH}`);
        expect(text).not.toContain("branch -D");
      });
    });
  });

  describe("validateWorktreeRemovalPath", () => {
    const worktreePath = "/test/repo/.wave/worktrees/feat";

    it("accepts an existing path inside the repo root", () => {
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
      } as unknown as ReturnType<typeof fs.lstatSync>);
      vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());

      expect(() =>
        worktreeUtils.validateWorktreeRemovalPath(worktreePath, "/test/repo"),
      ).not.toThrow();
    });

    it("accepts a missing path inside the repo root (already-removed worktree)", () => {
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        const s = p.toString();
        if (s === worktreePath) {
          throw new Error("ENOENT");
        }
        return s;
      });

      // Best-effort/idempotent removal: a worktree that is already gone is fine
      expect(() =>
        worktreeUtils.validateWorktreeRemovalPath(worktreePath, "/test/repo"),
      ).not.toThrow();
    });

    it("rejects a symlink as the final path component", () => {
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as unknown as ReturnType<typeof fs.lstatSync>);

      expect(() =>
        worktreeUtils.validateWorktreeRemovalPath(worktreePath, "/test/repo"),
      ).toThrow(/symlink/);
    });

    it("rejects an existing path outside the repo root", () => {
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
      } as unknown as ReturnType<typeof fs.lstatSync>);
      vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());

      expect(() =>
        worktreeUtils.validateWorktreeRemovalPath("/etc/passwd", "/test/repo"),
      ).toThrow(/outside repo root/);
    });

    it("rejects a missing path whose nearest existing ancestor escapes the repo root", () => {
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        const s = p.toString();
        if (s === "/etc/evil") {
          throw new Error("ENOENT");
        }
        return s;
      });

      expect(() =>
        worktreeUtils.validateWorktreeRemovalPath("/etc/evil", "/test/repo"),
      ).toThrow(/outside repo root/);
    });

    it("rejects a path escaping the repo root via ..", () => {
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
      } as unknown as ReturnType<typeof fs.lstatSync>);
      vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());

      expect(() =>
        worktreeUtils.validateWorktreeRemovalPath(
          "/test/repo/../outside",
          "/test/repo",
        ),
      ).toThrow(/outside repo root/);
    });
  });

  describe("countWorktreeChanges", () => {
    it("returns changed files and commits", () => {
      vi.mocked(execFileSync)
        .mockReturnValueOnce("M file1.txt\n?? file2.txt\n") // status
        .mockReturnValueOnce("3\n"); // rev-list

      const result = worktreeUtils.countWorktreeChanges(
        "/test/worktree",
        "abc123",
      );

      expect(result).toEqual({ changedFiles: 2, commits: 3 });
    });

    it("returns null when originalHeadCommit is undefined", () => {
      vi.mocked(execFileSync).mockReturnValueOnce("\n"); // empty status

      const result = worktreeUtils.countWorktreeChanges(
        "/test/worktree",
        undefined,
      );

      expect(result).toBeNull();
    });

    it("returns null when git commands fail", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("git error");
      });

      const result = worktreeUtils.countWorktreeChanges(
        "/test/worktree",
        "abc123",
      );

      expect(result).toBeNull();
    });

    it("returns 0 commits for clean worktree", () => {
      vi.mocked(execFileSync)
        .mockReturnValueOnce("") // no changes
        .mockReturnValueOnce("0\n"); // no commits

      const result = worktreeUtils.countWorktreeChanges(
        "/test/worktree",
        "abc123",
      );

      expect(result).toEqual({ changedFiles: 0, commits: 0 });
    });
  });

  describe("performPostCreationSetup", () => {
    it("should copy settings.local.json into the worktree when present", async () => {
      mockReadFile({
        [path.join("/repo/root", ".wave", "settings.local.json")]:
          '{"model":"claude"}',
      });

      await worktreeUtils.performPostCreationSetup(
        "/repo/root/.wave/worktrees/my-feat",
        "/repo/root",
      );

      expect(vi.mocked(fs.promises.writeFile)).toHaveBeenCalledWith(
        path.join(
          "/repo/root/.wave/worktrees/my-feat",
          ".wave",
          "settings.local.json",
        ),
        '{"model":"claude"}',
      );
    });

    it("should not copy settings.local.json when the main repo lacks it", async () => {
      await worktreeUtils.performPostCreationSetup(
        "/repo/root/.wave/worktrees/my-feat",
        "/repo/root",
      );

      expect(vi.mocked(fs.promises.writeFile)).not.toHaveBeenCalled();
      expect(gitCallsWith(["ls-files"])).toHaveLength(0);
    });

    it("should copy matched files and skip unmatched ones", async () => {
      mockReadFile({
        [path.join("/repo/root", ".worktreeinclude")]:
          "dist/\n*.env\n!prod.env\nconfig/secret.key\n",
      });
      git.handler = (_cmd, args) => {
        if (args[0] === "ls-files") {
          return {
            stdout:
              "dist/\n.env\nprod.env\nconfig/secret.key\nconfig/other.key\n",
            stderr: "",
          };
        }
        throw new Error("unexpected git call: " + args.join(" "));
      };

      await worktreeUtils.performPostCreationSetup(
        "/repo/root/.wave/worktrees/my-feat",
        "/repo/root",
      );

      // dist/ matches the dir-only pattern -> copied wholesale
      expect(vi.mocked(fs.promises.cp)).toHaveBeenCalledWith(
        path.join("/repo/root", "dist"),
        path.join("/repo/root/.wave/worktrees/my-feat", "dist"),
        { recursive: true },
      );
      // .env matches *.env at any level
      expect(vi.mocked(fs.promises.copyFile)).toHaveBeenCalledWith(
        path.join("/repo/root", ".env"),
        path.join("/repo/root/.wave/worktrees/my-feat", ".env"),
      );
      // prod.env excluded by the later !prod.env negation
      expect(vi.mocked(fs.promises.copyFile)).not.toHaveBeenCalledWith(
        path.join("/repo/root", "prod.env"),
        expect.anything(),
      );
      // config/secret.key matches its literal pattern
      expect(vi.mocked(fs.promises.copyFile)).toHaveBeenCalledWith(
        path.join("/repo/root", "config", "secret.key"),
        path.join("/repo/root/.wave/worktrees/my-feat", "config", "secret.key"),
      );
      // config/other.key does not match any pattern
      expect(vi.mocked(fs.promises.copyFile)).not.toHaveBeenCalledWith(
        path.join("/repo/root", "config", "other.key"),
        expect.anything(),
      );
      // no dirs needed expansion -> exactly one ls-files call
      expect(gitCallsWith(["ls-files"])).toHaveLength(1);
    });

    it("should expand collapsed dirs whose contents match patterns", async () => {
      mockReadFile({
        [path.join("/repo/root", ".worktreeinclude")]:
          "config/secrets/api.key\n",
      });
      let lsCalls = 0;
      git.handler = (_cmd, args) => {
        if (args[0] === "ls-files") {
          lsCalls++;
          if (lsCalls === 1) {
            return { stdout: "config/secrets/\n", stderr: "" };
          }
          return {
            stdout: "config/secrets/api.key\nconfig/secrets/other.key\n",
            stderr: "",
          };
        }
        throw new Error("unexpected git call: " + args.join(" "));
      };

      await worktreeUtils.performPostCreationSetup(
        "/repo/root/.wave/worktrees/my-feat",
        "/repo/root",
      );

      expect(lsCalls).toBe(2);
      expect(git.calls[1].args).toContain("--");
      expect(git.calls[1].args).toContain("config/secrets");
      expect(vi.mocked(fs.promises.copyFile)).toHaveBeenCalledWith(
        path.join("/repo/root", "config", "secrets", "api.key"),
        path.join(
          "/repo/root/.wave/worktrees/my-feat",
          "config",
          "secrets",
          "api.key",
        ),
      );
      expect(vi.mocked(fs.promises.copyFile)).not.toHaveBeenCalledWith(
        path.join("/repo/root", "config", "secrets", "other.key"),
        expect.anything(),
      );
    });

    it("should copy nothing when no entries match", async () => {
      mockReadFile({
        [path.join("/repo/root", ".worktreeinclude")]: "dist/\n",
      });
      git.handler = (_cmd, args) => {
        if (args[0] === "ls-files") {
          return { stdout: "coverage/\nfoo.ts\n", stderr: "" };
        }
        throw new Error("unexpected git call: " + args.join(" "));
      };

      await worktreeUtils.performPostCreationSetup(
        "/repo/root/.wave/worktrees/my-feat",
        "/repo/root",
      );

      expect(vi.mocked(fs.promises.cp)).not.toHaveBeenCalled();
      expect(vi.mocked(fs.promises.copyFile)).not.toHaveBeenCalled();
    });
  });
});
