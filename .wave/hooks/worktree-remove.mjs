#!/usr/bin/env node
// WorktreeRemove hook: reads { worktree_path } from stdin and removes the
// worktree. Best-effort, mirroring the git removal wave uses for non-hook
// worktrees: `git worktree remove --force` + branch delete + prune, with an
// fs.rmSync fallback for Windows MAX_PATH-limited removals.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// --- Read payload { worktree_path } from stdin -----------------------------
let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  console.error("worktree-remove: failed to parse hook payload from stdin");
  process.exit(1);
}

const worktreePath = payload.worktree_path;
if (typeof worktreePath !== "string" || worktreePath.length === 0) {
  console.error(
    `worktree-remove: missing worktree_path in payload: ${JSON.stringify(payload)}`,
  );
  process.exit(1);
}

// --- Resolve the repo root from git (git-common-dir may be relative to CWD) -
const gitCommonDir = spawnSync("git", ["rev-parse", "--git-common-dir"], {
  encoding: "utf8",
});
if (gitCommonDir.error || gitCommonDir.status !== 0) {
  console.error("worktree-remove: not inside a git repository");
  process.exit(1);
}
const repoRoot = path.resolve(gitCommonDir.stdout.trim(), "..");

// --- Sync .wave/settings.local.json back to the main repo ------------------
// Local settings are gitignored, so any changes made inside the worktree
// would otherwise be lost when the worktree is deleted. Merge into the
// main repo's file (if any) instead of overwriting it: arrays are unioned,
// scalars/objects from the worktree win. This mirrors how wave itself
// merges local settings (read-modify-write with deduped rule arrays).
function mergeSettings(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (Array.isArray(value) && Array.isArray(current)) {
      result[key] = [...new Set([...current, ...value])];
    } else if (
      value !== null &&
      typeof value === "object" &&
      current !== null &&
      typeof current === "object"
    ) {
      result[key] = mergeSettings(current, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function parseJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null; // missing or corrupted -> treated as empty
  }
}

const localSettingsPath = path.join(
  worktreePath,
  ".wave",
  "settings.local.json",
);
if (existsSync(localSettingsPath)) {
  const mainSettingsPath = path.join(repoRoot, ".wave", "settings.local.json");
  const merged = mergeSettings(
    parseJsonFile(mainSettingsPath) ?? {},
    parseJsonFile(localSettingsPath) ?? {},
  );
  writeFileSync(mainSettingsPath, `${JSON.stringify(merged, null, 2)}\n`);
}

// --- Remove the worktree (best-effort, non-blocking like wave's git path) ---
const name = path.basename(worktreePath);
const branch = `worktree-${name}`;

// 1. git worktree remove --force (deletes working dir + metadata)
let removed = existsSync(worktreePath)
  ? spawnSync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: repoRoot,
      stdio: "inherit",
    }).status === 0
  : true;

// 2. fs.rmSync fallback for MAX_PATH-limited removals (git leaves an orphan dir)
if (!removed && existsSync(worktreePath)) {
  try {
    rmSync(worktreePath, { recursive: true, force: true });
    removed = true;
  } catch (error) {
    console.error(
      `worktree-remove: fs.rmSync failed for ${worktreePath}: ${error.message}`,
    );
  }
}

// 3. Prune stale metadata and delete the worktree branch
spawnSync("git", ["worktree", "prune"], { cwd: repoRoot });
spawnSync("git", ["branch", "-D", "--", branch], { cwd: repoRoot });

if (!removed) {
  console.error(
    `worktree-remove: failed to remove worktree at: ${worktreePath}`,
  );
  process.exit(1);
}
