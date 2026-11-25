/**
 * `readLinkedWorktree` — the single answer to "is this directory a linked git
 * worktree, and which checkout owns it" (#3091).
 *
 * These are real layouts, not fixtures: the function reads what git actually
 * writes (`.git` gitfile → `commondir` → the shared git dir → `core.worktree`),
 * and the interesting cases are exactly the ones a hand-built fixture would get
 * wrong. Every layout here was measured against git itself (2026-11-25); the
 * bare and `--separate-git-dir` cases assert the honest answer rather than a
 * guess, because `git worktree list` reports the *git dir* as the main worktree
 * for both of them.
 *
 * Spec: docs/specs/multi-agent/worktree.md「bypassPermissions 模式下 Worktree
 * 安全拦截仍生效」.
 */

import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { readLinkedWorktree } from "@/utils/gitUtils.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** A committed repository at `dir`, so worktrees can branch off it. */
function initRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "Wave Test"]);
  git(dir, ["config", "user.email", "wave-test@example.com"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "init"]);
  return dir;
}

describe("readLinkedWorktree", () => {
  // The assertions compare full paths, so the fixture's own spelling must be the
  // spelling git records — otherwise they fail for a reason that has nothing to
  // do with `readLinkedWorktree`. `realpathSync` is not enough: on macOS `/tmp`
  // and `/var` are symlinks it does resolve, but on Windows an 8.3 short name
  // (`C:\Users\RUNNER~1\…`, which is what `os.tmpdir()` returns on a CI runner)
  // passes straight through while git canonicalizes it to the long name
  // (`runneradmin`). `realpathSync.native` normalizes both.
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "wave-wt-read-")),
  );

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads a plain repository's worktree", () => {
    const repo = initRepo(path.join(root, "plain"));
    const worktree = path.join(root, "plain-wt");
    git(repo, ["worktree", "add", "-q", "-b", "wt-plain", worktree]);

    expect(readLinkedWorktree(worktree)).toEqual({
      name: "plain-wt",
      repoRoot: repo,
    });

    // git wrote a shared `.git`, so the answer needs no config at all — the
    // case every user hits is the one the parser must never get wrong.
    expect(
      fs
        .statSync(path.join(repo, ".git", "worktrees", "plain-wt"))
        .isDirectory(),
    ).toBe(true);
  });

  it("resolves a submodule's worktree to the submodule checkout", () => {
    const sub = initRepo(path.join(root, "sub-origin"));
    const superRepo = initRepo(path.join(root, "super"));
    git(superRepo, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      sub,
      "mod",
    ]);
    git(superRepo, ["commit", "-q", "-m", "add submodule"]);

    const worktree = path.join(root, "sub-wt");
    git(path.join(superRepo, "mod"), [
      "worktree",
      "add",
      "-q",
      "-b",
      "wt-sub",
      worktree,
    ]);

    // The shared git dir is `<super>/.git/modules/mod`, which has no `.git`
    // basename to strip — the checkout comes from `core.worktree` in its config.
    expect(readLinkedWorktree(worktree)).toEqual({
      name: "sub-wt",
      repoRoot: path.join(superRepo, "mod"),
    });
  });

  it("returns undefined for a bare repository's worktree", () => {
    const origin = initRepo(path.join(root, "bare-origin"));
    const bare = path.join(root, "bare.git");
    git(root, ["clone", "-q", "--bare", origin, bare]);
    const worktree = path.join(root, "bare-wt");
    git(bare, ["worktree", "add", "-q", worktree, "main"]);

    // No main working tree exists, so there is nothing to protect. Answering
    // with the bare git dir (what `git worktree list` reports) would point the
    // write guard at a directory that is not a checkout at all.
    expect(readLinkedWorktree(worktree)).toBeUndefined();
  });

  it("returns undefined for a --separate-git-dir repository's worktree", () => {
    const repo = path.join(root, "sep");
    const gitDir = path.join(root, "sep.git");
    fs.mkdirSync(repo, { recursive: true });
    git(root, [
      "init",
      "-q",
      "-b",
      "main",
      `--separate-git-dir=${gitDir}`,
      repo,
    ]);
    git(repo, ["config", "user.name", "Wave Test"]);
    git(repo, ["config", "user.email", "wave-test@example.com"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "init"]);
    const worktree = path.join(root, "sep-wt");
    git(repo, ["worktree", "add", "-q", "-b", "wt-sep", worktree]);

    // `core.worktree` is unset and git itself no longer knows the checkout, so
    // the honest answer is "cannot tell" — not the git dir.
    expect(readLinkedWorktree(worktree)).toBeUndefined();
  });

  it("returns undefined for a working tree that is not a worktree", () => {
    const repo = initRepo(path.join(root, "plain-tree"));
    expect(readLinkedWorktree(repo)).toBeUndefined();
  });

  it("returns undefined for a subdirectory of a worktree", () => {
    const repo = initRepo(path.join(root, "nested-repo"));
    const worktree = path.join(root, "nested-wt");
    git(repo, ["worktree", "add", "-q", "-b", "wt-nested", worktree]);
    const subdirectory = path.join(worktree, "src");
    fs.mkdirSync(subdirectory, { recursive: true });

    // The answer decides the session's writable root; resolving a subdirectory
    // to the worktree root would hand out a scope its caller never asked for.
    expect(readLinkedWorktree(subdirectory)).toBeUndefined();
  });

  it("rejects a gitfile that borrows another worktree's git dir", () => {
    const repo = initRepo(path.join(root, "borrow-repo"));
    const worktree = path.join(root, "borrow-wt");
    git(repo, ["worktree", "add", "-q", "-b", "wt-borrow", worktree]);

    const borrowed = path.join(root, "borrowed");
    fs.mkdirSync(borrowed, { recursive: true });
    fs.writeFileSync(
      path.join(borrowed, ".git"),
      `gitdir: ${path.join(repo, ".git", "worktrees", "borrow-wt")}\n`,
    );

    // The private git dir's `gitdir` backlink spells out the real worktree, so a
    // second directory claiming it is rejected — otherwise any repo could point
    // at a worktree entry elsewhere and inherit its scope.
    expect(readLinkedWorktree(borrowed)).toBeUndefined();
  });
});
