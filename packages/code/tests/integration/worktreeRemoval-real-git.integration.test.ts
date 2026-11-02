/**
 * Real-git test for **which branch** deleting a worktree deletes.
 *
 * `tests/utils/worktree.test.ts` mocks `child_process`, so it can only pin the
 * arguments `removeWorktree` passes to git; `tests/stdio/agentBridge.test.ts`
 * mocks `removeWorktree` itself, so it can only pin the branch the bridge
 * hands it. Neither can show what git actually does to the two branches
 * involved. This suite runs the real thing against a real (throwaway)
 * repository: a worktree whose HEAD has been moved to another branch, deleted
 * through the real `deriveWorktreeInfo` → `worktreeCreationBranch` →
 * `removeWorktree` chain.
 *
 * Lives under tests/integration/ (excluded from the unit gate, picked up by
 * `pnpm run test:integration`) because it shells out to git and writes to a
 * temp directory.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  deriveWorktreeInfo,
  removeWorktree,
  worktreeCreationBranch,
  type WorktreeSession,
} from "../../src/utils/worktree.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** A repo with an identity and no signing — commits must not depend on the runner's global config. */
function initRepo(prefix: string): string {
  // `os.tmpdir()` hands back the path it was given, which on Windows can be an
  // 8.3 short name (`C:\Users\RUNNER~1\…`) and on macOS goes through `/var` →
  // `/private/var`. Git canonicalizes whatever path it is told and writes *that*
  // into `<gitdir>`, so a fixture built on the raw value would make this suite
  // pass or fail on how the runner's temp dir is spelled rather than on what it
  // is testing. Canonicalize once here; the path-form divergence itself is
  // pinned by `tests/utils/worktree.test.ts` (it needs no git and runs on the
  // PR gate, which this suite does not).
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  git(root, ["init", "-b", "main", "-q"]);
  git(root, ["config", "user.name", "Wave Test"]);
  git(root, ["config", "user.email", "wave-test@example.com"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  return root;
}

describe("removeWorktree against a real repository", () => {
  let root: string;
  let worktreePath: string;
  /** The commit only the user's checked-out branch reaches. */
  let userBranchSha: string;

  beforeEach(() => {
    root = initRepo("wave-worktree-real-");
    fs.writeFileSync(path.join(root, "a.txt"), "a\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "init", "-q"]);
    git(root, ["branch", "user-branch"]);

    // A worktree laid out the way createWorktree builds one.
    worktreePath = path.join(root, ".wave", "worktrees", "feat");
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    git(root, ["worktree", "add", "-q", "-b", "worktree-feat", worktreePath]);
    // A commit that only `worktree-feat` reaches: losing the branch loses it.
    git(worktreePath, [
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "work in progress",
    ]);

    // The agent then checks one of the user's own branches out inside the
    // worktree and commits there. This is what makes the worktree's HEAD a
    // record of the wrong branch.
    git(worktreePath, ["checkout", "-q", "user-branch"]);
    git(worktreePath, [
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "fix on user branch",
    ]);
    userBranchSha = git(root, ["rev-parse", "user-branch"]);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** The session the bridge builds for a worktree it can name the branch of. */
  function session(branch: string, at = worktreePath): WorktreeSession {
    const info = deriveWorktreeInfo(at);
    if (!info) throw new Error("the fixture is not a linked worktree");
    return {
      name: path.basename(info.path),
      path: info.path,
      branch,
      repoRoot: info.repoRoot,
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: false,
      hookBased: info.hookBased,
    };
  }

  it("deletes the worktree's own branch and leaves the checked-out one alone", async () => {
    const info = deriveWorktreeInfo(worktreePath)!;
    // Git has no memory of the creation branch: both the worktree's HEAD and
    // `git worktree list --porcelain` name whatever it has checked out now.
    expect(info.branch).toBe("user-branch");

    // The creation branch is recovered from the path layout instead — the same
    // answer `createWorktree` would have snapshotted at creation time.
    const creationBranch = worktreeCreationBranch(info);
    expect(creationBranch).toBe("worktree-feat");

    await removeWorktree(session(creationBranch!));

    expect(fs.existsSync(worktreePath)).toBe(false);
    // The branch wave created is gone…
    expect(git(root, ["branch", "--list", "worktree-feat"])).toBe("");
    // …and the user's branch, with the commit only it reaches, survives.
    expect(git(root, ["branch", "--list", "user-branch"])).toContain(
      "user-branch",
    );
    expect(git(root, ["rev-parse", "user-branch"])).toBe(userBranchSha);
  });

  it("keeps every branch when the caller could not name one", async () => {
    // No snapshot and no path convention (a hand-made worktree): removal gets
    // an empty branch, and must then delete no branch at all rather than fall
    // back to whatever the worktree had checked out.
    await removeWorktree(session(""));

    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(git(root, ["branch", "--list", "worktree-feat"])).toContain(
      "worktree-feat",
    );
    expect(git(root, ["rev-parse", "user-branch"])).toBe(userBranchSha);
  });

  it("names a slash-separated worktree by every segment below .wave/worktrees", async () => {
    // Names are slug paths (see validateWorktreeSlug), so wave's directory is
    // nested — `<repo>/.wave/worktrees/team/api` sits on `worktree-team/api`.
    // The name is what remains *below* `.wave/worktrees`, i.e. it cannot be
    // read off the last path segment alone: `path.basename` would say `api`
    // and leave `worktree-team/api` behind as the orphan.
    const nested = path.join(root, ".wave", "worktrees", "team", "api");
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    git(root, ["worktree", "add", "-q", "-b", "worktree-team/api", nested]);

    const info = deriveWorktreeInfo(nested)!;
    const creationBranch = worktreeCreationBranch(info);

    expect(creationBranch).toBe("worktree-team/api");

    await removeWorktree(session(creationBranch!, nested));

    expect(fs.existsSync(nested)).toBe(false);
    expect(git(root, ["branch", "--list", "worktree-team/api"])).toBe("");
    // The worktree above is untouched, branch included.
    expect(git(root, ["branch", "--list", "worktree-feat"])).toContain(
      "worktree-feat",
    );
  });
});
