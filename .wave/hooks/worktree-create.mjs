#!/usr/bin/env node
// WorktreeCreate hook: reads { name } from stdin, creates a git worktree at
// <repo-root>/.wave/worktrees/<name>, prints the worktree path to stdout,
// then kicks off pnpm install + build in the background.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Resolve the repo root from git (git-common-dir may be relative to CWD)
const gitCommonDir = spawnSync("git", ["rev-parse", "--git-common-dir"], {
  encoding: "utf8",
});
if (gitCommonDir.error || gitCommonDir.status !== 0) {
  console.error("worktree-create: not inside a git repository");
  process.exit(1);
}
const repoRoot = path.resolve(gitCommonDir.stdout.trim(), "..");

// --- Read payload { name } from stdin -------------------------------------
let name;
try {
  name = JSON.parse(readFileSync(0, "utf8")).name;
} catch {
  console.error("worktree-create: failed to parse hook payload from stdin");
  process.exit(1);
}
if (typeof name !== "string" || !/^[A-Za-z0-9._-]+$/.test(name)) {
  console.error(`worktree-create: invalid worktree name: ${name}`);
  process.exit(1);
}

// --- Create the worktree --------------------------------------------------
const worktreePath = path.join(repoRoot, ".wave", "worktrees", name);
const add = spawnSync(
  "git",
  ["worktree", "add", "-B", `worktree-${name}`, worktreePath],
  {
    cwd: repoRoot,
    stdio: ["inherit", 2, 2], // keep git output off stdout; stdout is the hook result
  },
);
if (add.error) {
  console.error(`worktree-create: failed to run git: ${add.error.message}`);
  process.exit(1);
}
if (add.status !== 0) process.exit(add.status);

// --- Kick off install + build in the background ---------------------------
const bg = spawn(
  "sh",
  [
    "-c",
    `cd "${worktreePath.replaceAll("\\", "/")}" && pnpm install && pnpm build || true`,
  ],
  { cwd: repoRoot, detached: true, stdio: "ignore", windowsHide: true },
);
bg.unref();

// --- Report the worktree path to wave --------------------------------------
process.stdout.write(`${worktreePath}\n`);
