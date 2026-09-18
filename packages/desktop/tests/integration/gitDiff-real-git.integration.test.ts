/**
 * Real-git tests for the diff service's base and range resolution.
 *
 * tests/gitDiff.test.ts mocks `child_process`, so it pins the parsing of
 * fixture strings — it can never tell whether the commands git is actually
 * given produce those strings. This suite runs the real service against a real
 * (throwaway) repository: the merge-base default-branch resolution, rename
 * detection, the single-commit range and the no-HEAD fallback are all verified
 * through git's real output.
 *
 * Lives under tests/integration/ (excluded from the unit gate, picked up by
 * vitest.integration.config.ts) because it shells out to git and writes to a
 * temp directory.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { getWorkspaceDiff } from "../../src/main/gitDiff";
import type { WorkspaceDiffResult } from "../../src/main/gitDiff";
import { longFormTempDir } from "../helpers/tempDir";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** A repo with an identity, no autocrlf and no signing — commits must not depend on the runner's global config. */
function initRepo(prefix: string, branch = "main"): string {
  const root = fs.mkdtempSync(path.join(longFormTempDir(), prefix));
  git(root, ["init", "-b", branch, "-q"]);
  git(root, ["config", "user.name", "Wave Test"]);
  git(root, ["config", "user.email", "wave-test@example.com"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["config", "core.autocrlf", "false"]);
  return root;
}

function write(root: string, rel: string, content: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

async function ok(
  cwd: string,
  options?: { commit?: string },
): Promise<Extract<WorkspaceDiffResult, { kind: "ok" }>> {
  const result = await getWorkspaceDiff(cwd, undefined, options);
  if (result.kind !== "ok")
    throw new Error(`expected an ok result, got ${result.kind}`);
  return result;
}

const TEN_LINES = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join("\n");

describe("getWorkspaceDiff against a real repository", () => {
  let root: string;
  let initSha: string;
  let renameSha: string;
  let addSha: string;

  beforeAll(() => {
    root = initRepo("wave-diff-real-");
    write(root, "src/a.ts", `${TEN_LINES}\n`);
    write(root, "tests/a.test.ts", "test one\n");
    write(root, "docs/readme.md", "docs line 1\ndocs line 2\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "init", "-q"]);
    initSha = git(root, ["rev-parse", "HEAD"]);
    // Make the repo look like a clone: the default branch is a remote-tracking
    // ref and `origin/HEAD` is a symref pointing at it.
    git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(root, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    ]);

    // The session's own work: one rename commit (with a content change, so the
    // rename has to be detected rather than read as delete+add) and one that
    // adds a file.
    git(root, ["checkout", "-b", "worktree-session", "-q"]);
    git(root, ["mv", "src/a.ts", "src/renamed.ts"]);
    write(root, "src/renamed.ts", `${TEN_LINES.replace("l5", "L5-renamed")}\n`);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "rename and reword", "-q"]);
    renameSha = git(root, ["rev-parse", "HEAD"]);
    write(root, "src/added.ts", "brand new\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "add a file", "-q"]);
    addSha = git(root, ["rev-parse", "HEAD"]);

    // Uncommitted worktree state on top of those commits.
    write(
      root,
      "src/renamed.ts",
      `${TEN_LINES.replace("l5", "L5-renamed").replace("l8", "L8-dirty")}\n`,
    );
    write(root, "tests/a.test.ts", "test one edited\n");
    fs.rmSync(path.join(root, "docs/readme.md"));
    write(root, "notes.txt", "hello\nworld\n");
    write(root, "docs/untracked.md", "new doc\n");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("measures the range from the fork point with the default branch", async () => {
    const result = await ok(root);
    expect(result.base).toEqual({
      label: "origin/main",
      sha: initSha,
      kind: "default-branch",
      ref: "refs/remotes/origin/main",
    });
  });

  it("lists the session's own commits, newest first", async () => {
    const result = await ok(root);
    expect(result.commits).toEqual([
      {
        sha: addSha,
        shortSha: addSha.slice(0, 7),
        subject: "add a file",
      },
      {
        sha: renameSha,
        shortSha: renameSha.slice(0, 7),
        subject: "rename and reword",
      },
    ]);
  });

  it("covers committed, uncommitted and untracked changes in one list", async () => {
    const result = await ok(root);
    const byPath = new Map(result.files.map((file) => [file.path, file]));

    // Committed by the session.
    expect(byPath.get("src/added.ts")).toMatchObject({
      status: "added",
      additions: 1,
      deletions: 0,
      binary: false,
    });
    expect(byPath.get("src/added.ts")?.hunks).toContain("+brand new");

    // Uncommitted.
    expect(byPath.get("tests/a.test.ts")).toMatchObject({
      status: "modified",
      additions: 1,
      deletions: 1,
    });
    expect(byPath.get("docs/readme.md")).toMatchObject({
      status: "deleted",
      additions: 0,
      deletions: 2,
    });

    // Untracked, including one below a directory.
    expect(byPath.get("notes.txt")).toMatchObject({
      status: "untracked",
      additions: 2,
      hunks: "+hello\n+world",
    });
    expect(byPath.get("docs/untracked.md")).toMatchObject({
      status: "untracked",
      additions: 1,
    });
  });

  it("merges a file that was committed and then changed again into one entry", async () => {
    const result = await ok(root);
    const renamed = result.files.filter((f) => f.path === "src/renamed.ts");

    expect(renamed).toHaveLength(1);
    expect(renamed[0]).toMatchObject({
      status: "renamed",
      oldPath: "src/a.ts",
      // Net change against the base: one committed line, one dirty line.
      additions: 2,
      deletions: 2,
    });
    // The rename is detected, so the patch is a real diff — not "new file mode"
    // with the whole file re-added (which is what limiting the pathspec to the
    // new path alone would have produced).
    expect(renamed[0].hunks).toContain("-l5");
    expect(renamed[0].hunks).toContain("+L5-renamed");
    expect(renamed[0].hunks).toContain("+L8-dirty");
    expect(renamed[0].hunks).not.toContain("new file mode");
  });

  it("resolves paths against the repo root when cwd is a subdirectory", async () => {
    const result = await ok(path.join(root, "src"));
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("src/renamed.ts");
    expect(paths).toContain("notes.txt");
    // Untracked content is read from disk, so it must have resolved too.
    expect(result.files.find((f) => f.path === "notes.txt")?.hunks).toBe(
      "+hello\n+world",
    );
  });

  it("shows exactly one commit's own changes", async () => {
    const result = await ok(root, { commit: addSha });
    expect(result.scope).toEqual({
      kind: "commit",
      sha: addSha,
      shortSha: addSha.slice(0, 7),
      subject: "add a file",
    });
    expect(result.files.map((f) => f.path)).toEqual(["src/added.ts"]);
  });

  it("diffs a committed rename against its own parent", async () => {
    const result = await ok(root, { commit: renameSha });
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "src/renamed.ts",
        oldPath: "src/a.ts",
        status: "renamed",
        additions: 1,
        deletions: 1,
      }),
    ]);
    const hunks = result.files[0].hunks;
    expect(hunks).toContain("-l5");
    expect(hunks).toContain("+L5-renamed");
    expect(hunks).not.toContain("new file mode");
    // The dirty worktree edit belongs to no commit.
    expect(hunks).not.toContain("L8-dirty");
  });

  it("falls back to the whole range for a commit outside the session", async () => {
    // The fork point itself is not part of `base..HEAD`, and a rebased-away
    // commit is not either: neither is selectable, and both must degrade to the
    // full range rather than to an empty panel.
    for (const commit of ["0".repeat(40), initSha]) {
      const result = await ok(root, { commit });
      expect(result.scope).toEqual({ kind: "all" });
      expect(result.files.map((f) => f.path)).toContain("src/renamed.ts");
    }
  });
});

describe("getWorkspaceDiff against a repository with no commits", () => {
  let root: string;

  beforeAll(() => {
    root = initRepo("wave-diff-nocommit-");
    write(root, "staged.ts", "staged\n");
    git(root, ["add", "-A"]);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("falls back to the index", async () => {
    const result = await ok(root);
    expect(result.base).toEqual({
      label: "索引",
      sha: null,
      kind: "index",
      ref: null,
    });
    expect(result.commits).toEqual([]);
    expect(result.files.map((f) => f.path)).toEqual(["staged.ts"]);
  });
});

describe("getWorkspaceDiff against a repository with no default branch", () => {
  let root: string;

  beforeAll(() => {
    root = initRepo("wave-diff-nobranch-", "trunk");
    write(root, "src/a.ts", "one\ntwo\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "init", "-q"]);
    // Committed after the branch point, then changed again in the worktree.
    write(root, "src/a.ts", "one\ntwo\nthree\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "session work", "-q"]);
    write(root, "src/a.ts", "one\ntwo\nthree\nfour\n");
    write(root, "untracked.txt", "new\n");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("falls back to HEAD", async () => {
    const result = await ok(root);
    expect(result.base).toMatchObject({ label: "HEAD", kind: "head" });
    expect(result.commits).toEqual([]);
    const byPath = new Map(result.files.map((f) => [f.path, f]));
    // Only the worktree is visible against HEAD — the committed line is not,
    // which is exactly why the default-branch base exists.
    expect(byPath.get("src/a.ts")).toMatchObject({
      status: "modified",
      additions: 1,
      deletions: 0,
    });
    expect(byPath.get("src/a.ts")?.hunks).toContain("+four");
    expect(byPath.get("untracked.txt")).toMatchObject({
      status: "untracked",
      additions: 1,
    });
  });
});
