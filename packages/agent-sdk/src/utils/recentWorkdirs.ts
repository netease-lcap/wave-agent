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
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
 * The list, most recent first. A missing / unreadable / malformed file is an
 * empty list: this is convenience data, and a broken file must never make
 * session creation fail.
 */
export function readRecentWorkdirs(): string[] {
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
  const seen = new Set<string>();
  const list: string[] = [];
  for (const entry of dirs) {
    if (typeof entry !== "string") continue;
    const normalized = normalizeWorkdir(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    list.push(normalized);
    if (list.length >= MAX_RECENT_WORKDIRS) break;
  }
  return list;
}

/**
 * Push `dir` to the front (MRU, deduped, capped). Never throws: a read-only
 * `~/.wave` costs the user a remembered directory, not the session they were
 * about to create.
 */
export function rememberRecentWorkdir(dir: string): void {
  const normalized = normalizeWorkdir(dir);
  if (!normalized) return;
  const next = [
    normalized,
    ...readRecentWorkdirs().filter((entry) => entry !== normalized),
  ].slice(0, MAX_RECENT_WORKDIRS);
  try {
    const waveDir = join(homedir(), ".wave");
    if (!existsSync(waveDir)) mkdirSync(waveDir, { recursive: true });
    atomicWriteFileSync(
      recentWorkdirsPath(),
      JSON.stringify({ dirs: next }, null, 2) + "\n",
    );
  } catch {
    // Silent by design (see the spec's 场景 5).
  }
}
