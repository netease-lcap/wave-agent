/**
 * Git worktree creation and removal utilities for the SDK.
 * Used by EnterWorktree and ExitWorktree tools.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { execFileAsyncHidden, execFileSyncHidden } from "./execFileHidden.js";
import {
  getGitMainRepoRoot,
  getDefaultRemoteBranch,
  ensureWaveRuntimeFilesExcluded,
} from "./gitUtils.js";
import { logger } from "./globalLogger.js";
import {
  describeRemovalFailure,
  describeWorktreeResidue,
  detachWorktreePointer,
  errorMessage,
  removeWorktreeDirectory,
  restoreWorktreePointer,
} from "./worktreeRemoval.js";

// Post-creation setup runs inside the shared `wave --stdio` process too
// (desktop sessions), so use the async execFile: a synchronous git call
// (e.g. `git ls-files` over a large working tree) would freeze every session.

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  repoRoot: string;
  isNew: boolean;
  /** HEAD commit of the original branch at creation time, for dirty-check on exit */
  originalHeadCommit?: string;
}

/**
 * Validate a worktree name to prevent path traversal and invalid characters.
 */
export function validateWorktreeName(name: string): void {
  const MAX_LENGTH = 64;
  if (name.length > MAX_LENGTH) {
    throw new Error(
      `Invalid worktree name: must be ${MAX_LENGTH} characters or fewer (got ${name.length})`,
    );
  }
  // The `sa-` namespace belongs to wave's own ephemeral worktrees, which the
  // startup sweep deletes once they go stale — a user-chosen name there would
  // be garbage-collected out from under them.
  if (name.split("/")[0].startsWith(EPHEMERAL_WORKTREE_PREFIX)) {
    throw new Error(
      `Invalid worktree name "${name}": the "${EPHEMERAL_WORKTREE_PREFIX}" prefix is reserved for wave-managed temporary worktrees`,
    );
  }
  for (const segment of name.split("/")) {
    if (segment === "." || segment === "..") {
      throw new Error(
        `Invalid worktree name "${name}": must not contain "." or ".." path segments`,
      );
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(segment)) {
      throw new Error(
        `Invalid worktree name "${name}": each "/"-separated segment must be non-empty and contain only letters, digits, dots, underscores, and dashes`,
      );
    }
  }
}

/**
 * Reserved name prefix for *ephemeral* worktrees — the ones wave creates for a
 * subagent's `isolation: worktree` and that nobody asked for by name.
 *
 * The stale-worktree sweep (`utils/worktreeCleanup.ts`) deletes worktrees by
 * name, so "wave created this and may clean it up" must be distinguishable
 * from "the user asked for this and owns it". Shape alone cannot do it:
 * `EnterWorktree` without a name and the subagent isolation path both used
 * `generateWorktreeName()`, so an auto-named *user session* looked exactly
 * like a throwaway one. Hence a dedicated prefix, which
 * `validateWorktreeName` refuses for user-chosen names.
 */
export const EPHEMERAL_WORKTREE_PREFIX = "sa-";

/**
 * `sa-<adjective>-<noun>-<three digits>`. Anchored and list-free on purpose:
 * this is the only thing standing between the sweep and a user's worktree.
 */
const EPHEMERAL_WORKTREE_NAME_PATTERN = /^sa-[a-z]+-[a-z]+-\d{3}$/;

const WORKTREE_NAME_ADJECTIVES = [
  "swift",
  "calm",
  "bold",
  "keen",
  "bright",
  "cool",
  "deep",
  "fair",
  "gentle",
  "grand",
];

const WORKTREE_NAME_NOUNS = [
  "fox",
  "owl",
  "hawk",
  "wolf",
  "bear",
  "lynx",
  "pike",
  "kite",
  "dove",
  "stag",
];

function randomWorktreeName(prefix: string): string {
  const adj =
    WORKTREE_NAME_ADJECTIVES[
      Math.floor(Math.random() * WORKTREE_NAME_ADJECTIVES.length)
    ];
  const noun =
    WORKTREE_NAME_NOUNS[Math.floor(Math.random() * WORKTREE_NAME_NOUNS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${prefix}${adj}-${noun}-${num}`;
}

/**
 * Generate a random worktree name for a user-facing session worktree.
 */
export function generateWorktreeName(): string {
  return randomWorktreeName("");
}

/**
 * Generate a name for an ephemeral (auto-cleaned) worktree. Callers are the
 * subagent isolation path only; user-facing flows keep `generateWorktreeName`.
 */
export function generateEphemeralWorktreeName(): string {
  return randomWorktreeName(EPHEMERAL_WORKTREE_PREFIX);
}

/**
 * True when `name` is a well-formed ephemeral worktree name — i.e. the sweep in
 * `worktreeCleanup.ts` may delete it once it is stale and clean.
 */
export function isEphemeralWorktreeName(name: string): boolean {
  return EPHEMERAL_WORKTREE_NAME_PATTERN.test(name);
}

/** Branch `createWorktree` gives a worktree it creates. */
export function worktreeBranchName(name: string): string {
  return `worktree-${name}`;
}

/**
 * Get the current HEAD commit SHA.
 */
export function getHeadCommit(cwd: string): string {
  return execFileSyncHidden("git", ["-C", cwd, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * Create a git worktree for use during a session.
 * @param name Worktree name
 * @param cwd Current working directory (will be resolved to main repo root)
 * @param options Optional creation options
 * @param options.baseRef "fresh" (default, origin/<default-branch>) | "head" (local HEAD)
 */
export function createWorktree(
  name: string,
  cwd: string,
  options?: { baseRef?: "fresh" | "head" },
): WorktreeInfo {
  const repoRoot = getGitMainRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error(
      "Cannot create a worktree: not in a git repository. Configure WorktreeCreate and WorktreeRemove hooks in settings.json to use worktree isolation with other VCS systems.",
    );
  }

  // Capture HEAD commit before creating worktree (for dirty-check on exit)
  const originalHeadCommit = getHeadCommit(cwd);

  const worktreePath = path.join(repoRoot, ".wave", "worktrees", name);
  const branchName = worktreeBranchName(name);
  const useHead = options?.baseRef === "head";
  const baseBranch = useHead ? "HEAD" : getDefaultRemoteBranch(cwd);

  // Ensure Wave runtime files are git-excluded in this repo
  ensureWaveRuntimeFilesExcluded(cwd);

  // Ensure parent directory exists
  const parentDir = path.dirname(worktreePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Check if worktree already exists
  if (fs.existsSync(worktreePath)) {
    return {
      name,
      path: worktreePath,
      branch: branchName,
      repoRoot,
      isNew: false,
      originalHeadCommit,
    };
  }

  try {
    // Create worktree and branch
    execFileSyncHidden(
      "git",
      ["worktree", "add", "-b", branchName, worktreePath, baseBranch],
      {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
        },
      },
    );

    return {
      name,
      path: worktreePath,
      branch: branchName,
      repoRoot,
      isNew: true,
      originalHeadCommit,
    };
  } catch (error: unknown) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() || "";
    if (stderr.includes("already exists")) {
      // Branch exists but worktree doesn't — attach to existing branch
      try {
        execFileSyncHidden(
          "git",
          ["worktree", "add", worktreePath, branchName],
          {
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: "0",
              GIT_ASKPASS: "",
            },
          },
        );
        return {
          name,
          path: worktreePath,
          branch: branchName,
          repoRoot,
          isNew: true,
          originalHeadCommit,
        };
      } catch (innerError: unknown) {
        throw new Error(
          `Failed to add worktree: ${(innerError as Error).message}`,
        );
      }
    }
    if (
      !useHead &&
      (stderr.includes("not a valid object name") ||
        stderr.includes("unknown revision"))
    ) {
      // Base branch not fetched yet — try fetching then retrying
      const branchNameOnly = baseBranch.split("/").pop()!;
      try {
        execFileSyncHidden("git", ["fetch", "origin", branchNameOnly], {
          cwd: repoRoot,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "",
          },
        });
        execFileSyncHidden(
          "git",
          ["worktree", "add", "-b", branchName, worktreePath, baseBranch],
          {
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: "0",
              GIT_ASKPASS: "",
            },
          },
        );
        return {
          name,
          path: worktreePath,
          branch: branchName,
          repoRoot,
          isNew: true,
          originalHeadCommit,
        };
      } catch {
        // Fetch or retry failed — fall back to HEAD
        try {
          execFileSyncHidden(
            "git",
            ["worktree", "add", "-b", branchName, worktreePath, "HEAD"],
            {
              cwd: repoRoot,
              stdio: ["ignore", "pipe", "pipe"],
              env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: "0",
                GIT_ASKPASS: "",
              },
            },
          );
          return {
            name,
            path: worktreePath,
            branch: branchName,
            repoRoot,
            isNew: true,
            originalHeadCommit,
          };
        } catch {
          throw new Error(
            `Failed to create worktree: ${(error as Error).message}\n${stderr}`,
          );
        }
      }
    }
    throw new Error(
      `Failed to create worktree: ${(error as Error).message}\n${stderr}`,
    );
  }
}

// --- .worktreeinclude matching ----------------------------------------------

interface WorktreeIncludePattern {
  /** Normalized pattern text (no leading "/", no trailing "/", no "!") */
  raw: string;
  negated: boolean;
  /** Pattern ends with "/" — matches directories only */
  dirOnly: boolean;
  /** Pattern had a leading "/" — anchored to the repo root */
  anchored: boolean;
  /** No "/" and not anchored — matches the basename at any level */
  anyLevel: boolean;
  regex: RegExp;
}

/** Translate a single gitignore glob into a RegExp (gitignore semantics). */
function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          // "**/" matches zero or more leading directories
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (ch === "?") {
      source += "[^/]";
    } else if (ch === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end === -1) {
        source += "\\[";
      } else {
        let charClass = glob.slice(i, end + 1);
        if (charClass.startsWith("[!")) {
          // gitignore uses "[!...]" for a negated character class
          charClass = "[^" + charClass.slice(2);
        }
        source += charClass;
        i = end;
      }
    } else {
      source += ch.replace(/[.+^${}()|\\]/g, "\\$&");
    }
  }
  source += "$";
  return new RegExp(source);
}

/**
 * Parse .worktreeinclude content into patterns. Blank lines and "#" comments
 * are skipped, matching gitignore conventions.
 */
function parseWorktreeIncludePatterns(
  content: string,
): WorktreeIncludePattern[] {
  const patterns: WorktreeIncludePattern[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let raw = line;
    const negated = raw.startsWith("!");
    if (negated) raw = raw.slice(1);
    const dirOnly = raw.endsWith("/");
    if (dirOnly) raw = raw.slice(0, -1);
    const anchored = raw.startsWith("/");
    if (anchored) raw = raw.slice(1);
    if (!raw) continue;
    patterns.push({
      raw,
      negated,
      dirOnly,
      anchored,
      anyLevel: !anchored && !raw.includes("/"),
      regex: globToRegExp(raw),
    });
  }
  return patterns;
}

/** Test a single pattern against one candidate path. */
function testPatternAgainst(
  pattern: WorktreeIncludePattern,
  candidate: string,
): boolean {
  if (pattern.anyLevel) {
    // Match the full path or any "/"-suffix (basename at any level)
    if (pattern.regex.test(candidate)) return true;
    for (let i = 0; i < candidate.length; i++) {
      if (candidate[i] === "/" && pattern.regex.test(candidate.slice(i + 1))) {
        return true;
      }
    }
    return false;
  }
  return pattern.regex.test(candidate);
}

/**
 * Test a pattern against a path and every ancestor prefix. Excluding a
 * directory excludes everything beneath it (gitignore semantics), so ancestor
 * prefixes are always treated as directories.
 */
function patternMatchesPath(
  pattern: WorktreeIncludePattern,
  relPath: string,
  isDir: boolean,
): boolean {
  let candidate = relPath;
  for (;;) {
    const candidateIsDir = candidate === relPath ? isDir : true;
    if (
      !(pattern.dirOnly && !candidateIsDir) &&
      testPatternAgainst(pattern, candidate)
    ) {
      return true;
    }
    const idx = candidate.lastIndexOf("/");
    if (idx === -1) break;
    candidate = candidate.slice(0, idx);
  }
  return false;
}

/** Last-match-wins resolution with "!" negation. */
function worktreeIncludeMatches(
  patterns: WorktreeIncludePattern[],
  relPath: string,
  isDir: boolean,
): boolean {
  let matched = false;
  for (const pattern of patterns) {
    if (patternMatchesPath(pattern, relPath, isDir)) {
      matched = !pattern.negated;
    }
  }
  return matched;
}

/**
 * A positive pattern targets something inside a collapsed directory: either it
 * literally starts with the directory path, or the directory path starts with
 * the pattern's literal (pre-glob) prefix.
 */
function needsExpansion(
  patterns: WorktreeIncludePattern[],
  dir: string,
): boolean {
  return patterns.some((p) => {
    if (p.negated) return false;
    if (p.raw.startsWith(dir + "/")) return true;
    const globIdx = p.raw.search(/[*?[]/);
    if (globIdx > 0 && dir.startsWith(p.raw.slice(0, globIdx))) return true;
    return false;
  });
}

// --- Post-creation setup -----------------------------------------------------

/**
 * Copy <repoRoot>/.wave/settings.local.json into the worktree so local
 * configuration (permissions, env, ...) carries over. Missing files are
 * skipped silently; other failures only log a warning.
 */
async function copyLocalSettingsToWorktree(
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  const relativePath = path.join(".wave", "settings.local.json");
  const sourcePath = path.join(repoRoot, relativePath);
  const destPath = path.join(worktreePath, relativePath);
  let content: string;
  try {
    content = await fs.promises.readFile(sourcePath, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(`Failed to read ${sourcePath}: ${(error as Error).message}`);
    }
    return;
  }
  try {
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.writeFile(destPath, content);
  } catch (error: unknown) {
    logger.warn(
      `Failed to copy ${relativePath} into worktree: ${(error as Error).message}`,
    );
  }
}

/**
 * Copy files listed in <repoRoot>/.worktreeinclude into the worktree. Each
 * non-comment line is a gitignore pattern; matching gitignored files are
 * copied at their relative paths.
 */
async function copyWorktreeIncludeFiles(
  repoRoot: string,
  worktreePath: string,
): Promise<string[]> {
  const includePath = path.join(repoRoot, ".worktreeinclude");
  let content: string;
  try {
    content = await fs.promises.readFile(includePath, "utf8");
  } catch {
    return [];
  }
  const patterns = parseWorktreeIncludePatterns(content);
  if (patterns.length === 0) return [];

  const worktreeRelPath = path
    .relative(repoRoot, worktreePath)
    .split(path.sep)
    .join("/");
  // The worktree lives under .wave/worktrees/, which is gitignored — never
  // copy the worktree (or anything inside it) into itself.
  const isSelf = (entry: string) =>
    entry === worktreeRelPath || entry.startsWith(worktreeRelPath + "/");

  // "--directory" collapses fully-ignored directories into single entries,
  // which keeps the listing fast on large repos.
  let entries: string[];
  try {
    const { stdout } = await execFileAsyncHidden(
      "git",
      [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    entries = stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }

  const copied: string[] = [];
  const dirsToExpand: string[] = [];

  const copyToWorktree = async (relativePath: string): Promise<void> => {
    const srcPath = path.join(repoRoot, relativePath);
    const destPath = path.join(worktreePath, relativePath);
    try {
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      await fs.promises.copyFile(srcPath, destPath);
      copied.push(relativePath);
    } catch (error: unknown) {
      logger.warn(
        `Failed to copy ${relativePath} into worktree: ${(error as Error).message}`,
      );
    }
  };

  for (const entry of entries) {
    if (isSelf(entry)) continue;
    if (entry.endsWith("/")) {
      const dir = entry.slice(0, -1);
      if (worktreeIncludeMatches(patterns, dir, true)) {
        // The directory itself matches — copy it wholesale
        try {
          await fs.promises.cp(
            path.join(repoRoot, dir),
            path.join(worktreePath, dir),
            {
              recursive: true,
            },
          );
          copied.push(entry);
        } catch (error: unknown) {
          logger.warn(
            `Failed to copy ${entry} into worktree: ${(error as Error).message}`,
          );
        }
      } else if (needsExpansion(patterns, dir)) {
        dirsToExpand.push(dir);
      }
    } else if (worktreeIncludeMatches(patterns, entry, false)) {
      await copyToWorktree(entry);
    }
  }

  if (dirsToExpand.length > 0) {
    // List the files inside collapsed dirs whose contents are targeted
    try {
      const { stdout } = await execFileAsyncHidden(
        "git",
        [
          "ls-files",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--",
          ...dirsToExpand,
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );
      for (const file of stdout.trim().split("\n").filter(Boolean)) {
        if (isSelf(file)) continue;
        if (worktreeIncludeMatches(patterns, file, false)) {
          await copyToWorktree(file);
        }
      }
    } catch {
      // Expansion is best-effort; the worktree is already usable without it
    }
  }

  return copied;
}

/**
 * Set up a freshly created worktree: copy local settings and gitignored
 * project files (via .worktreeinclude) from the main repo. Best-effort — any
 * failure only logs a warning and never fails worktree creation.
 */
export async function performPostCreationSetup(
  worktreePath: string,
  repoRoot: string,
): Promise<void> {
  await copyLocalSettingsToWorktree(repoRoot, worktreePath);
  await copyWorktreeIncludeFiles(repoRoot, worktreePath);
}

/**
 * Remove a git worktree and its branch.
 *
 * The order is inverted relative to "let git delete it": the worktree's own
 * `.git` pointer is deleted first, then the directory, and `git worktree prune`
 * deregisters what is left. That is deliberate.
 *
 * - git's exit code is not trustworthy for this job. On Windows git cannot
 *   remove the directory symlinks/junctions pnpm's node_modules is made of, so
 *   it deletes the files, leaves the skeleton behind and still exits 0; the
 *   opposite also happens (git deregisters, then fails to delete). Whichever
 *   way, the directory and git's records end up disagreeing — the recurring
 *   "directory residue + branch still there + worktree no longer registered"
 *   report.
 * - With the pointer removed first, git's records play no part in the delete:
 *   what remains is an ordinary directory, and if `fs.rmSync` cannot remove it
 *   the pointer is written back. So "directory on disk" and "git knows about
 *   it" never diverge.
 *
 * Accepted trade-off: a crash (or a kill) between the pointer unlink and the
 * delete leaves a plain directory that git no longer knows about — `git
 * worktree prune` will never report it and nothing sweeps it up. That window is
 * a single `fs.rmSync` call, whereas the git-first order opened an equally
 * unrecoverable window on every junction-skeleton failure.
 *
 * Because git no longer performs the delete, the checks it used to make are
 * made here: never the main working tree, never a `git worktree lock`ed
 * worktree, and only a directory whose `.git` points back into this repo.
 *
 * The checks, the pointer handling and the delete all live in
 * `worktreeRemoval.ts` — `packages/code` removes worktrees too (TUI exit, `-p`,
 * `daemon destroy --remove-worktree`, the remote-control `destroy`) and shares
 * exactly that core. What is left below is this package's calling convention:
 * synchronous git, best-effort, no return value.
 *
 * Removal stays best-effort and non-throwing: every refusal and failure is
 * logged, and the branch is kept whenever the directory survives.
 */
export function removeWorktree(info: WorktreeInfo): void {
  const repoRoot = info.repoRoot;

  // Path safety (symlink final component, path escaping the repo root). Kept as
  // a refusal rather than a throw: removal is best-effort by contract and all
  // three callers can only report a throw, not act on it.
  try {
    validateWorktreeRemovalPath(info.path, repoRoot);
  } catch (error) {
    logger.warn("Refusing to remove worktree — unsafe path:", {
      worktreePath: info.path,
      reason: errorMessage(error),
    });
    return;
  }

  const detach = detachWorktreePointer({ worktreePath: info.path, repoRoot });

  if (detach.status === "refused") {
    logger.warn(detach.message, {
      worktreePath: info.path,
      refusal: detach.reason,
      ...detach.details,
    });
    return;
  }

  if (detach.status === "pointer-stuck") {
    logger.error("Failed to remove worktree — could not detach its .git:", {
      worktreePath: info.path,
      stage: "unlink .git",
      reason: detach.reason,
      residue: describeWorktreeResidue(info.path),
    });
    return;
  }

  // Already gone: nothing to unwrap or delete. The branch still goes, which is
  // what makes a repeated removal idempotent.
  if (detach.status === "absent") {
    deregisterAndDeleteBranch(repoRoot, info);
    return;
  }

  if (detach.leftover) {
    // No pointer: a previous cleanup already took it, so this is a plain
    // leftover directory. Not an error — just delete it like one.
    logger.warn(
      "Worktree .git pointer already gone — deleting the directory as a plain leftover:",
      { worktreePath: info.path, residue: describeWorktreeResidue(info.path) },
    );
  }
  if (detach.reparsePointsUnlinked > 0) {
    logger.info("Unlinked reparse points before removing the worktree:", {
      worktreePath: info.path,
      unlinked: detach.reparsePointsUnlinked,
    });
  }

  const rmError = removeWorktreeDirectory(info.path);
  if (rmError !== null) {
    const restoreError =
      detach.pointer === null
        ? null
        : restoreWorktreePointer(info.path, detach.pointer.content);
    const reason = describeRemovalFailure(
      rmError,
      detach.reparsePointUnremovable,
    );
    if (restoreError !== null) {
      // Both failures, and neither masks the other: the directory is still
      // there but git no longer knows about it, so a manual removal is required.
      logger.error(
        "Failed to remove the worktree directory AND failed to restore its .git — git will not register it until `git worktree prune` is followed by a manual delete:",
        {
          worktreePath: info.path,
          stage: "fs.rmSync + restore .git",
          reason,
          restoreError: errorMessage(restoreError),
          residue: describeWorktreeResidue(info.path),
        },
      );
    } else {
      logger.error("Failed to remove worktree directory:", {
        worktreePath: info.path,
        stage: "fs.rmSync",
        reason,
        gitPointerRestored: detach.pointer !== null,
        residue: describeWorktreeResidue(info.path),
      });
    }
    // The directory survived, so the branch stays (it is the only ref leading
    // back to whatever work is left in that checkout).
    logger.warn(
      `Worktree directory survived removal — keeping ${info.branch} so the leftover checkout stays reachable:`,
      { worktreePath: info.path, residue: describeWorktreeResidue(info.path) },
    );
    return;
  }

  deregisterAndDeleteBranch(repoRoot, info);
}

/**
 * Finish a successful directory removal: deregister the worktree, then delete
 * its branch.
 *
 * The order matters. git's registration deliberately outlives the directory
 * (that is what let the delete be recoverable), so `prune` is what removes it —
 * and it has to run before `branch -D`, which git refuses for a branch a
 * registered worktree still has checked out.
 */
function deregisterAndDeleteBranch(repoRoot: string, info: WorktreeInfo): void {
  try {
    execFileSyncHidden("git", ["worktree", "prune"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    logger.warn("git worktree prune failed after removing a worktree:", {
      worktreePath: info.path,
      error: errorMessage(error),
    });
  }

  // The directory, not any exit code, decides whether the removal happened. A
  // surviving directory means its checkout (and any uncommitted work in it) is
  // still on disk, and the branch is the only ref still leading back to it.
  if (fs.existsSync(info.path)) {
    logger.warn(
      `Worktree directory survived removal — keeping ${info.branch} so the leftover checkout stays reachable:`,
      { worktreePath: info.path, residue: describeWorktreeResidue(info.path) },
    );
    return;
  }

  // Delete the worktree's own branch. Branches the user checked out inside the
  // worktree are never touched — they may hold commits that are not reachable
  // from anywhere else (aligned with Claude Code).
  try {
    execFileSyncHidden("git", ["branch", "-D", info.branch], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    logger.warn(`Failed to delete branch ${info.branch}:`, {
      worktreePath: info.path,
      error: errorMessage(error),
    });
  }
}

/**
 * Validate that a worktree path is safe to remove before running git removal.
 * Aligns with Claude Code v2.1.216+ background-session checks:
 * - rejects a path whose final component is a symlink;
 * - rejects a path that resolves outside the repo root.
 *
 * A path that no longer exists (worktree already removed) is allowed so that
 * removal stays best-effort/idempotent; its nearest existing ancestor is used
 * for the containment check. Throws an Error on invalid paths.
 */
export function validateWorktreeRemovalPath(
  worktreePath: string,
  repoRoot: string,
): void {
  const SYMLINK_PREFIX = "Refusing to remove worktree at symlink path:";

  // Reject a symlink as the final path component.
  try {
    if (fs.lstatSync(worktreePath).isSymbolicLink()) {
      throw new Error(`${SYMLINK_PREFIX} ${worktreePath}`);
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith(SYMLINK_PREFIX)) {
      throw error;
    }
    // lstat failed (path missing) — the containment check below still applies.
  }

  const resolvedRepoRoot = fs.realpathSync(repoRoot);

  // Resolve the path, following symlinks in existing components. If the path
  // (or a parent) no longer exists, fall back to the deepest existing ancestor
  // so the containment check still guards against traversal outside the repo.
  let resolvedPath: string;
  let existingAncestor = worktreePath;
  for (;;) {
    try {
      resolvedPath = fs.realpathSync(existingAncestor);
      break;
    } catch {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw new Error(`Invalid worktree path for removal: ${worktreePath}`);
      }
      existingAncestor = parent;
    }
  }
  if (existingAncestor !== worktreePath) {
    resolvedPath = path.join(
      resolvedPath,
      path.relative(existingAncestor, worktreePath),
    );
  }

  const relative = path.relative(resolvedRepoRoot, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Refusing to remove worktree outside repo root: ${worktreePath}`,
    );
  }
}

/**
 * Count uncommitted files and new commits in a worktree.
 * Returns null if git commands fail (fail-closed).
 */
export function countWorktreeChanges(
  worktreePath: string,
  originalHeadCommit: string | undefined,
): { changedFiles: number; commits: number } | null {
  try {
    const statusOutput = execFileSyncHidden(
      "git",
      ["-C", worktreePath, "status", "--porcelain"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const changedFiles = statusOutput
      .split("\n")
      .filter((l) => l.trim() !== "").length;

    if (!originalHeadCommit) {
      return null;
    }

    const revListOutput = execFileSyncHidden(
      "git",
      [
        "-C",
        worktreePath,
        "rev-list",
        "--count",
        `${originalHeadCommit}..HEAD`,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const commits = parseInt(revListOutput.trim(), 10) || 0;

    return { changedFiles, commits };
  } catch {
    return null;
  }
}
