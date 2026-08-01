import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";
import * as worktreeUtils from "@/utils/worktreeUtils.js";
import * as gitUtils from "@/utils/gitUtils.js";
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
  const { promisify } = await import("node:util");
  const execFile = vi.fn(() => {
    throw new Error("execFile must only be used via util.promisify");
  });
  // worktreeUtils wraps execFile with util.promisify, which prefers the
  // promisify.custom symbol — mirror node's { stdout, stderr } result shape.
  (execFile as unknown as Record<PropertyKey, unknown>)[promisify.custom] = (
    cmd: string,
    args: string[],
    opts?: unknown,
  ): Promise<GitResult> => {
    git.calls.push({ cmd, args, opts });
    try {
      return Promise.resolve(git.handler(cmd, args, opts));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  return { execFile, execFileSync: vi.fn() };
});

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  lstatSync: vi.fn(),
  realpathSync: vi.fn(),
  readFileSync: vi.fn(),
  appendFileSync: vi.fn(),
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
  });

  describe("generateWorktreeName", () => {
    it("returns a string in adjective-noun-number format", () => {
      const name = worktreeUtils.generateWorktreeName();
      expect(typeof name).toBe("string");
      expect(name).toMatch(/^[a-z]+-[a-z]+-\d{3}$/);
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
    beforeEach(() => {
      vi.mocked(execFileSync).mockReturnValue("");
      vi.mocked(gitUtils.getDefaultRemoteBranch).mockReturnValue("origin/main");
    });

    it("removes worktree and branch", () => {
      worktreeUtils.removeWorktree({
        name: "feat",
        path: "/test/repo/.wave/worktrees/feat",
        branch: "worktree-feat",
        repoRoot: "/test/repo",
        isNew: true,
      });

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "remove", "--force"]),
        expect.anything(),
      );
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["branch", "-D", "worktree-feat"]),
        expect.anything(),
      );
    });

    it("logs and rethrows on failure", () => {
      const error = new Error("git failed");
      vi.mocked(execFileSync).mockImplementation(() => {
        throw error;
      });

      expect(() =>
        worktreeUtils.removeWorktree({
          name: "feat",
          path: "/test/repo/.wave/worktrees/feat",
          branch: "worktree-feat",
          repoRoot: "/test/repo",
          isNew: true,
        }),
      ).toThrow("git failed");
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
