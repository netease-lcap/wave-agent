/**
 * Machine-level 「recently opened working directories」.
 *
 * The list belongs to **this machine**, not to any one front end: the desktop
 * app used to keep its own copy in `userData/wave-desktop.json` (grouped by
 * host) and the remote-control Web page could only derive directories from the
 * live session registry — so deleting every session made the list vanish. Both
 * read this file instead (spec core/recent-workdirs.md).
 *
 * `~/.wave/recent-workdirs.json`, MRU, capped, written atomically: several
 * processes (daemon, a desktop `--stdio` child, the CLI) may write it around
 * the same time, and a torn file would cost the whole list.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { atomicWriteFileSync } from "./atomicWrite.js";

/** Same cap as the desktop's own MRU (`MAX_RECENT_WORKDIRS`). */
export const MAX_RECENT_WORKDIRS = 10;

/** The stored file for this machine. */
export function recentWorkdirsPath(): string {
  return join(homedir(), ".wave", "recent-workdirs.json");
}

/**
 * Trailing separators are noise for identity purposes — `/repo` and `/repo/`
 * are the same directory, and a user who typed one then picked the other from
 * the browser should not get two entries. A drive root (`C:\`) keeps its
 * separator: stripping it would leave a name that is not a path.
 */
function normalizeWorkdir(dir: string): string {
  const trimmed = dir.trim();
  if (trimmed.length <= 1) return trimmed;
  const stripped = trimmed.replace(/[\\/]+$/, "");
  if (/^[A-Za-z]:$/.test(stripped)) {
    return stripped + (trimmed.includes("\\") ? "\\" : "/");
  }
  return stripped;
}

/**
 * The main repository root of the linked worktree at `dir`, or `undefined`
 * when `dir` is not one. The test is the same one `resolveGitDir` and the
 * CLI's `deriveWorktreeInfo` use, narrowed to "this directory itself": `.git`
 * is a **file** holding `gitdir: …`, and that git dir's `commondir` points
 * back at the main repository's `.git` (whose parent is the root we want). A
 * submodule also has a `.git` file but no `commondir`, so it keeps its own
 * entry.
 *
 * Deliberately shallow: a subdirectory *inside* a worktree has no `.git` of
 * its own, and walking up would replace the directory the user actually
 * picked with one they never chose.
 */
function worktreeRepoRoot(dir: string): string | undefined {
  try {
    const gitEntry = join(dir, ".git");
    if (!statSync(gitEntry).isFile()) return undefined;
    const content = readFileSync(gitEntry, "utf-8").trim();
    const prefix = "gitdir: ";
    if (!content.startsWith(prefix)) return undefined;
    const gitDir = resolve(dir, content.slice(prefix.length).trim());
    const common = readFileSync(join(gitDir, "commondir"), "utf-8").trim();
    if (!common) return undefined;
    const commonDir = resolve(gitDir, common);
    const repoRoot =
      basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
    return repoRoot && repoRoot !== dir ? repoRoot : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Repository root of a worktree that is **no longer on disk**, judged by the
 * layout Wave itself creates: `<repoRoot>/.wave/worktrees/<name>` (see
 * `worktreeUtils.createWorktree`). Once a worktree session is deleted its
 * directory — and the git metadata the check above reads — is gone, but the
 * leftover entry must still not masquerade as a project of its own.
 */
function layoutRepoRoot(dir: string): string | undefined {
  const worktreesDir = dirname(dir);
  const waveDir = dirname(worktreesDir);
  if (basename(worktreesDir) !== "worktrees") return undefined;
  if (basename(waveDir) !== ".wave") return undefined;
  const repoRoot = dirname(waveDir);
  return repoRoot && repoRoot !== dir ? repoRoot : undefined;
}

/**
 * The form a directory is stored as. A worktree records its repository root
 * (spec core/recent-workdirs.md 场景 3): the list is a list of projects, and
 * `.wave/worktrees/<name>` is a derived location that disappears with the
 * session that made it.
 */
function recentEntry(dir: string): string {
  const normalized = normalizeWorkdir(dir);
  if (!normalized) return "";
  const repoRoot =
    worktreeRepoRoot(normalized) ?? layoutRepoRoot(normalized) ?? normalized;
  return normalizeWorkdir(repoRoot) || "";
}

/**
 * The stored entries as written (slash/trailing-separator normalized only),
 * uncapped so `forgetRecentWorkdir` can still reach an entry that the
 * worktree mapping would have merged away.
 */
function readStored(): string[] {
  let raw: string;
  try {
    raw = readFileSync(recentWorkdirsPath(), "utf-8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const dirs = (parsed as { dirs?: unknown } | null)?.dirs;
  if (!Array.isArray(dirs)) return [];
  const list: string[] = [];
  for (const entry of dirs) {
    if (typeof entry !== "string") continue;
    const normalized = normalizeWorkdir(entry);
    if (!normalized) continue;
    list.push(normalized);
  }
  return list;
}

/**
 * The list, most recent first. A missing / unreadable / malformed file is an
 * empty list: this is convenience data, and a broken file must never make
 * session creation fail.
 *
 * Worktree paths are mapped to their repository root here as well as on write,
 * so entries written before that rule existed (or by an older CLI) read back
 * as the repo root and merge with its own entry instead of showing twice.
 */
export function readRecentWorkdirs(): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const entry of readStored()) {
    const mapped = recentEntry(entry);
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    list.push(mapped);
    if (list.length >= MAX_RECENT_WORKDIRS) break;
  }
  return list;
}

function writeRecentWorkdirs(dirs: string[]): void {
  try {
    const waveDir = join(homedir(), ".wave");
    if (!existsSync(waveDir)) mkdirSync(waveDir, { recursive: true });
    atomicWriteFileSync(
      recentWorkdirsPath(),
      JSON.stringify({ dirs }, null, 2) + "\n",
    );
  } catch {
    // Silent by design (see the spec's 场景 5).
  }
}

/**
 * Push `dir` to the front (MRU, deduped, capped). Never throws: a read-only
 * `~/.wave` costs the user a remembered directory, not the session they were
 * about to create.
 */
export function rememberRecentWorkdir(dir: string): void {
  const entry = recentEntry(dir);
  if (!entry) return;
  writeRecentWorkdirs(
    [
      entry,
      ...readRecentWorkdirs().filter((existing) => existing !== entry),
    ].slice(0, MAX_RECENT_WORKDIRS),
  );
}

/**
 * Drop `dir` from this machine's list. Comparison uses the same mapping as the
 * write path, so removing a worktree's repository root also removes a stale
 * worktree entry for it. Never throws (same reasoning as the write above); an
 * entry that is not there is not an error.
 */
export function forgetRecentWorkdir(dir: string): void {
  const target = recentEntry(dir);
  if (!target) return;
  const stored = readStored();
  const remaining = stored.filter((entry) => recentEntry(entry) !== target);
  if (remaining.length === stored.length) return;
  writeRecentWorkdirs(remaining);
}
