/**
 * In-memory index of a workspace's file paths.
 *
 * ## Why this exists
 *
 * The file panel's filter box and the `@` mention dropdown share one data path:
 * `searchFiles()` enumerates the whole workspace with `rg --files`, derives every
 * directory, and fuzzy-scores every entry — on **every keystroke**. Enumerating
 * is the cheap part (47–76 ms on 67k paths); parsing, deriving directories and a
 * full `fuzzysort` pass are what make one keystroke cost ~560 ms.
 *
 * The first three steps have nothing to do with the query, so they only need to
 * happen once per workspace. This module keeps that result and answers each
 * keystroke from memory: a 26-bit character-mask prefilter, a substring check,
 * and a cheap score. `fuzzysort` stays as the fallback for queries the substring
 * pass cannot satisfy (abbreviations like `srcidx`).
 *
 * The shape mirrors Claude Code's host-side file index (`fileIndexWorker.js`,
 * `nJ`), which is what makes their filter box feel instant with no debounce.
 *
 * ## Freshness
 *
 * There is no file watcher — Claude Code has none either (it even passes
 * `-c core.fsmonitor=` to `git ls-files`). The index is refreshed in the
 * background once it is older than {@link REFRESH_TTL_MS}, and the refresh is
 * skipped entirely when the sha1 of the entry list is unchanged.
 */

import { createHash } from "crypto";
import { spawn } from "child_process";
import fuzzysort from "fuzzysort";
import { getRgPath } from "./ripgrep.js";
import { logger } from "./globalLogger.js";
import type { FileItem } from "../types/fileSearch.js";

/**
 * Dependency and build-output directories that never participate in file
 * search. Taken from Claude Code's host file index, where the same list backs
 * its shallow fallback walk and its `git grep` excludes.
 *
 * These matter for repositories whose `.gitignore` is missing or weak: without
 * them `node_modules` / `dist` would be enumerated in full, which is exactly the
 * "67k files" case. `rg` prunes them during the walk, so they cost nothing.
 */
export const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  "__pycache__",
  ".tox",
  ".venv",
  "venv",
  "env",
  ".env",
  "coverage",
  ".nyc_output",
  ".turbo",
  ".parcel-cache",
  "target",
  "vendor",
  ".terraform",
  ".gradle",
  ".m2",
  ".mvn",
  ".idea",
  ".vscode",
  ".history",
  ".yarn",
  ".pnpm-store",
  ".npm",
  ".vite",
] as const;

const EXCLUDED_FILES = [".git", ".DS_Store"];

/**
 * How long a built index is served before the next query re-enumerates the
 * workspace. A query that arrives after this window waits for that refresh, so
 * a file created or deleted is visible within TTL + one enumeration (spec
 * desktop-file-panel「文件面板按名字查找」: ≤ 5 s), which is why the window sits
 * at 3 s rather than 5 s.
 */
export const REFRESH_TTL_MS = 3_000;

/** Cached workspaces. Two covers the common "two panes" case without unbounded memory. */
export const MAX_CACHED_WORKDIRS = 2;

/**
 * Above this many entries the index is not built and `searchFiles` falls back to
 * the per-request implementation. 67k paths cost ~16–20 MB; 300k is the point
 * where that trade stops being worth it.
 */
export const MAX_INDEXED_ENTRIES = 300_000;

/** After hitting {@link MAX_INDEXED_ENTRIES}, don't re-attempt for this long. */
export const OVERSIZED_COOLDOWN_MS = 10 * 60_000;

const COMMON_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "py",
  "java",
]);

/** Enumerates every file path under `workdir`, relative and `/`-separated. */
export type ListFiles = (workdir: string) => Promise<string[]>;

export interface FileIndex {
  workdir: string;
  /** Relative paths; directories keep a trailing `/`. Files first, then directories. */
  paths: string[];
  /** `paths` lowercased once, so a query never re-lowercases the whole index. */
  lower: string[];
  /** 26-bit letter mask per entry, for the prefilter. */
  masks: Int32Array;
  /** Index in `lower[i]` where the basename starts. */
  baseStart: Int32Array;
  /** 1 when the entry is a directory. */
  isDir: Uint8Array;
  /** sha1 of `paths.join("\n")`; unchanged version means the refresh can be skipped. */
  version: string;
  refreshedAt: number;
  refreshing: Promise<void> | null;
}

/**
 * Set a bit per distinct letter (a–z). A path can only contain the query as a
 * substring if it has every letter of the query, so one `&` rejects most entries
 * without touching a string. Characters outside a–z contribute no bits — the
 * filter never rejects on them, so it stays correct for CJK and punctuation.
 */
function charMask(value: string): number {
  let mask = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i) | 32;
    if (code >= 97 && code <= 122) mask |= 1 << (code - 97);
  }
  return mask;
}

/**
 * Execute ripgrep to get all file paths.
 *
 * `--hidden` keeps dotfiles (`.github/`, `.env`) in play, so `.git` — the one
 * hidden tree that is always noise — plus the shared excluded directories are
 * pruned with `-g`. On this repo that alone drops the output from 5,632 lines
 * (64.6% of them `.git` internals) to 1,992 and the run from 8.8 ms to 6.6 ms.
 */
export async function getAllFiles(workdir: string): Promise<string[]> {
  const rgBinary = getRgPath();
  if (!rgBinary) {
    throw new Error("ripgrep is not available");
  }

  const rgArgs = [
    "--files",
    "--color=never",
    "--hidden",
    ...EXCLUDED_DIRS.flatMap((dir) => ["-g", `!${dir}`]),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(rgBinary, rgArgs, {
      cwd: workdir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      // Exit 2 = some files were unreadable (e.g. device-name files like
      // "nul" on Windows); stdout still holds usable partial results.
      // Spawn failures surface via the 'error' listener instead.
      if (code !== 0 && code !== 1) {
        logger.warn(
          `ripgrep exited with code ${code}, keeping partial results: ${stderr.trim()}`,
        );
      }
      const files = stdout
        .trim()
        .split("\n")
        .filter((f) => {
          if (f.length === 0) return false;
          const parts = f.split(/[/\\]/);
          return !parts.some((part) => EXCLUDED_FILES.includes(part));
        })
        .map((f) => f.replace(/\\/g, "/")); // Normalize to forward slashes
      resolve(files);
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Derive directory paths from file paths
 */
export function deriveDirectories(files: string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    // Add all parent directories
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/") + "/";
      dirs.add(dir);
    }
  }
  return Array.from(dirs);
}

/** True when `char` starts a new word — separators only; camelCase is not scored. */
function isWordBoundary(char: string | undefined): boolean {
  return (
    char === undefined ||
    char === "/" ||
    char === "." ||
    char === "-" ||
    char === "_"
  );
}

/**
 * Score a substring hit.
 *
 * The ordering exists so a truncated result list still shows the entries a user
 * means: a hit in the basename beats a hit in the directory path, a hit at a
 * word boundary (`vitest.config.ts` for `config`) beats one buried inside a
 * word (`myconfig.ts`), a basename that *starts* with the query wins, and
 * shorter paths win ties.
 *
 * Unlike `fuzzysort`, this only rewards contiguous hits — abbreviations such as
 * `srcidx` come from the {@link fuzzyFallback} pass instead, so the two never
 * compete inside one result list.
 */
function scoreHit(
  lowerPath: string,
  hitAt: number,
  lowerQuery: string,
  baseStart: number,
): number {
  const inBase = hitAt >= baseStart;
  const boundary = isWordBoundary(
    hitAt === 0 ? undefined : lowerPath[hitAt - 1],
  );
  const baseLength = lowerPath.length - baseStart;

  let score = 0;
  if (inBase) score += 40;
  if (boundary) score += 30;
  if (inBase && baseLength === lowerQuery.length) score += 40;

  return score - Math.min(20, lowerPath.length / 10);
}

function buildIndex(workdir: string, files: string[]): FileIndex {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    paths.push(file);
  }
  // Same order as the pre-index implementation: every file, then the directories
  // they imply.
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/") + "/";
      if (seen.has(dir)) continue;
      seen.add(dir);
      paths.push(dir);
    }
  }

  const count = paths.length;
  const lower = new Array<string>(count);
  const masks = new Int32Array(count);
  const baseStart = new Int32Array(count);
  const isDir = new Uint8Array(count);
  const hash = createHash("sha1");

  for (let i = 0; i < count; i++) {
    const path = paths[i];
    const lowered = path.toLowerCase();
    lower[i] = lowered;
    masks[i] = charMask(lowered);
    const trimmed = lowered.endsWith("/") ? lowered.slice(0, -1) : lowered;
    baseStart[i] = trimmed.lastIndexOf("/") + 1;
    isDir[i] = path.endsWith("/") ? 1 : 0;
    hash.update(path);
    hash.update("\n");
  }

  return {
    workdir,
    paths,
    lower,
    masks,
    baseStart,
    isDir,
    version: hash.digest("hex"),
    refreshedAt: Date.now(),
    refreshing: null,
  };
}

/** The empty-query view: top-level directories plus well-known source files. */
export function defaultListing(
  index: FileIndex,
  maxResults: number,
): FileItem[] {
  const results: FileItem[] = [];
  const seenDirs = new Set<string>();

  for (let i = 0; i < index.paths.length; i++) {
    const path = index.paths[i];
    if (index.isDir[i] === 1) continue;

    const slash = path.indexOf("/");
    if (slash > 0) {
      const topDir = path.slice(0, slash + 1);
      if (!seenDirs.has(topDir)) {
        seenDirs.add(topDir);
        results.push({ path: topDir, type: "directory" });
      }
    }

    const ext = path.split(".").pop();
    if (ext && COMMON_EXTENSIONS.has(ext)) {
      results.push({ path, type: "file" });
    }
  }

  return results
    .sort((a, b) => {
      if (a.type === "directory" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "directory") return 1;
      return a.path.localeCompare(b.path);
    })
    .slice(0, maxResults);
}

/**
 * Fuzzy fallback for queries the substring pass cannot satisfy (abbreviations
 * like `srcidx`). The mask prefilter runs first — it is a necessary condition
 * for a subsequence match, so it never drops a real hit.
 */
function fuzzyFallback(
  index: FileIndex,
  query: string,
  maxResults: number,
): FileItem[] {
  const lowerQuery = query.toLowerCase();
  const queryMask = charMask(lowerQuery);
  const candidates: FileItem[] = [];
  for (let i = 0; i < index.paths.length; i++) {
    if ((index.masks[i] & queryMask) !== queryMask) continue;
    candidates.push({
      path: index.paths[i],
      type: index.isDir[i] === 1 ? "directory" : "file",
    });
  }
  return fuzzysort
    .go(query, candidates, { key: "path", limit: maxResults, threshold: 0 })
    .map((result) => result.obj);
}

/** Answer one keystroke from the index. */
export function queryIndex(
  index: FileIndex,
  query: string,
  maxResults: number,
): FileItem[] {
  const lowerQuery = query.toLowerCase();
  const queryMask = charMask(lowerQuery);
  // Scores are small integers, so hits go into one bucket per score and the
  // result is read off the top buckets. Sorting the whole hit list instead
  // costs ~110 ms on a 67k-entry workspace whose every path contains the query
  // (e.g. searching `utils` in a tree where every file sits under `src/utils/`).
  const buckets: (number[] | undefined)[] = [];
  let hitCount = 0;

  for (let i = 0; i < index.lower.length; i++) {
    if ((index.masks[i] & queryMask) !== queryMask) continue;
    const lowerPath = index.lower[i];
    const hitAt = lowerPath.indexOf(lowerQuery);
    if (hitAt < 0) continue;
    // Tenths, so the length penalty still separates otherwise-equal hits.
    const score = Math.round(
      scoreHit(lowerPath, hitAt, lowerQuery, index.baseStart[i]) * 10,
    );
    (buckets[score] ??= []).push(i);
    hitCount++;
  }

  if (hitCount === 0) return fuzzyFallback(index, query, maxResults);

  const results: FileItem[] = [];
  for (
    let score = buckets.length - 1;
    score >= 0 && results.length < maxResults;
    score--
  ) {
    const bucket = buckets[score];
    if (!bucket) continue;
    // Only the buckets we actually read get sorted.
    bucket.sort((a, b) => index.paths[a].localeCompare(index.paths[b]));
    for (const position of bucket) {
      results.push({
        path: index.paths[position],
        type: index.isDir[position] === 1 ? "directory" : "file",
      });
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

// ── Cache ────────────────────────────────────────────────────────

const cache = new Map<string, FileIndex>();
const inflight = new Map<string, Promise<FileIndex | null>>();
const oversizedUntil = new Map<string, number>();

function store(workdir: string, index: FileIndex): void {
  cache.delete(workdir);
  cache.set(workdir, index);
  while (cache.size > MAX_CACHED_WORKDIRS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function refresh(
  workdir: string,
  current: FileIndex,
  listFiles: ListFiles,
): Promise<void> {
  try {
    const files = await listFiles(workdir);
    // An empty result usually means rg failed (permissions, cwd removed); keep
    // the previous index rather than blanking the panel.
    if (files.length === 0) return;
    if (files.length > MAX_INDEXED_ENTRIES) {
      oversizedUntil.set(workdir, Date.now() + OVERSIZED_COOLDOWN_MS);
      cache.delete(workdir);
      return;
    }
    const next = buildIndex(workdir, files);
    if (next.version === current.version) {
      current.refreshedAt = Date.now();
      return;
    }
    store(workdir, next);
  } catch (error) {
    logger.warn("file index refresh failed:", error);
  }
}

function buildOnce(
  workdir: string,
  listFiles: ListFiles,
): Promise<FileIndex | null> {
  const existing = inflight.get(workdir);
  if (existing) return existing;

  const pending = listFiles(workdir)
    .then((files) => {
      if (files.length > MAX_INDEXED_ENTRIES) {
        oversizedUntil.set(workdir, Date.now() + OVERSIZED_COOLDOWN_MS);
        logger.warn(
          `file index skipped for ${workdir}: ${files.length} entries exceeds ${MAX_INDEXED_ENTRIES}`,
        );
        return null;
      }
      const index = buildIndex(workdir, files);
      store(workdir, index);
      return index;
    })
    .finally(() => {
      inflight.delete(workdir);
    });

  inflight.set(workdir, pending);
  return pending;
}

/**
 * The cached index for `workdir`, building it on first use and re-enumerating
 * once {@link REFRESH_TTL_MS} has passed. Returns `null` when the workspace is
 * too large to index, in which case the caller should serve the request the old
 * way.
 */
export async function getFileIndex(
  workdir: string,
  listFiles: ListFiles = getAllFiles,
): Promise<FileIndex | null> {
  const oversizedUntilTs = oversizedUntil.get(workdir);
  if (oversizedUntilTs !== undefined) {
    if (Date.now() < oversizedUntilTs) return null;
    oversizedUntil.delete(workdir);
  }

  const hit = cache.get(workdir);
  if (!hit) return buildOnce(workdir, listFiles);
  if (Date.now() - hit.refreshedAt <= REFRESH_TTL_MS) return hit;

  // Past the window: wait for this refresh instead of answering from the stale
  // snapshot — otherwise a created file is invisible until the *next* query and
  // a deleted one keeps showing up. Concurrent queries share one enumeration.
  let pending = hit.refreshing;
  if (!pending) {
    pending = refresh(workdir, hit, listFiles).finally(() => {
      hit.refreshing = null;
    });
    hit.refreshing = pending;
  }
  await pending;
  // A refresh that hit the entry cap drops the workspace from the cache, which
  // means "serve this one the old way".
  return cache.get(workdir) ?? null;
}

/** Drop every cached index. Used by tests and when the workspace root changes. */
export function resetFileIndexCache(): void {
  cache.clear();
  inflight.clear();
  oversizedUntil.clear();
}
