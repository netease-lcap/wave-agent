import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import { getDefaultRemoteBranch, getGitMainRepoRoot } from "wave-agent-sdk";

// Never use execFileSync here: the shared `wave --stdio` process handles all
// desktop sessions, so a synchronous git call (especially a multi-second
// recursive worktree delete or a network fetch) freezes every session.
const execFileAsync = promisify(execFile);

export interface WorktreeSession {
  name: string;
  path: string;
  branch: string;
  repoRoot: string;
  hasUncommittedChanges: boolean;
  hasNewCommits: boolean;
  isNew: boolean;
}

// --- Worktree name validation ------------------------------------------------

const VALID_WORKTREE_SLUG_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const MAX_WORKTREE_SLUG_LENGTH = 64;

/**
 * Validate a worktree name before any side effects. Names are slash-separated
 * slugs: every segment must be non-empty and contain only letters, digits,
 * dots, underscores, and dashes. The total length is capped at 64 characters
 * and "." / ".." segments are rejected (path traversal protection).
 * @throws {Error} When the name is not a valid slug
 */
export function validateWorktreeSlug(name: string): void {
  if (name.length > MAX_WORKTREE_SLUG_LENGTH) {
    throw new Error(
      `Invalid worktree name: "${name}" must be ${MAX_WORKTREE_SLUG_LENGTH} characters or fewer (got ${name.length})`,
    );
  }
  for (const segment of name.split("/")) {
    if (segment === "." || segment === "..") {
      throw new Error(
        `Invalid worktree name: "${name}" must not contain "." or ".." path segments`,
      );
    }
    if (segment.length === 0 || !VALID_WORKTREE_SLUG_SEGMENT.test(segment)) {
      throw new Error(
        `Invalid worktree name: "${name}" each "/"-separated segment must be non-empty and contain only letters, digits, dots, underscores, and dashes`,
      );
    }
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
      console.warn(`Failed to read ${sourcePath}: ${(error as Error).message}`);
    }
    return;
  }
  try {
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.writeFile(destPath, content);
  } catch (error: unknown) {
    console.warn(
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
    const { stdout } = await execFileAsync(
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
      console.warn(
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
          console.warn(
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
      const { stdout } = await execFileAsync(
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
 * Create a new git worktree
 * @param name Worktree name
 * @param cwd Current working directory
 * @param options Optional creation options
 * @param options.baseRef "fresh" (default, origin/<default-branch>) | "head" (local HEAD)
 * @param options.baseBranch Explicit base branch (overrides baseRef)
 * @returns Worktree session details
 */
export async function createWorktree(
  name: string,
  cwd: string,
  options?: { baseRef?: "fresh" | "head"; baseBranch?: string },
): Promise<WorktreeSession> {
  validateWorktreeSlug(name);
  const session = await createWorktreeInternal(name, cwd, options);
  if (session.isNew) {
    await performPostCreationSetup(session.path, session.repoRoot);
  }
  return session;
}

async function createWorktreeInternal(
  name: string,
  cwd: string,
  options?: { baseRef?: "fresh" | "head"; baseBranch?: string },
): Promise<WorktreeSession> {
  const repoRoot = getGitMainRepoRoot(cwd);
  const worktreePath = path.join(repoRoot, ".wave", "worktrees", name);
  const branchName = `worktree-${name}`;
  const useHead = options?.baseRef === "head";
  const resolvedBaseBranch =
    options?.baseBranch ?? (useHead ? "HEAD" : getDefaultRemoteBranch(cwd));

  // Ensure parent directory exists
  const parentDir = path.dirname(worktreePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Check if worktree already exists
  if (fs.existsSync(worktreePath)) {
    // If it exists, we assume it's already set up correctly
    return {
      name,
      path: worktreePath,
      branch: branchName,
      repoRoot,
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: false,
    };
  }

  try {
    // Create worktree and branch
    await execFileAsync(
      "git",
      ["worktree", "add", "-b", branchName, worktreePath, resolvedBaseBranch],
      {
        cwd: repoRoot,
      },
    );

    return {
      name,
      path: worktreePath,
      branch: branchName,
      repoRoot,
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: true,
    };
  } catch (error: unknown) {
    const stderr =
      (error as { stderr?: Buffer | string }).stderr?.toString() || "";
    if (stderr.includes("already exists")) {
      // If branch already exists, try to add worktree without -b
      try {
        await execFileAsync(
          "git",
          ["worktree", "add", worktreePath, branchName],
          {
            cwd: repoRoot,
          },
        );
        return {
          name,
          path: worktreePath,
          branch: branchName,
          repoRoot,
          hasUncommittedChanges: false,
          hasNewCommits: false,
          isNew: true,
        };
      } catch (innerError: unknown) {
        throw new Error(
          `Failed to add existing worktree branch: ${(innerError as Error).message}`,
        );
      }
    }
    if (
      !useHead &&
      (stderr.includes("not a valid object name") ||
        stderr.includes("unknown revision"))
    ) {
      // Base branch not fetched yet — try fetching then retrying
      const branchNameOnly = resolvedBaseBranch.split("/").pop()!;
      try {
        await execFileAsync("git", ["fetch", "origin", branchNameOnly], {
          cwd: repoRoot,
        });
        await execFileAsync(
          "git",
          [
            "worktree",
            "add",
            "-b",
            branchName,
            worktreePath,
            resolvedBaseBranch,
          ],
          {
            cwd: repoRoot,
          },
        );
        return {
          name,
          path: worktreePath,
          branch: branchName,
          repoRoot,
          hasUncommittedChanges: false,
          hasNewCommits: false,
          isNew: true,
        };
      } catch {
        // Fetch or retry failed — fall back to HEAD
        try {
          await execFileAsync(
            "git",
            ["worktree", "add", "-b", branchName, worktreePath, "HEAD"],
            {
              cwd: repoRoot,
            },
          );
          return {
            name,
            path: worktreePath,
            branch: branchName,
            repoRoot,
            hasUncommittedChanges: false,
            hasNewCommits: false,
            isNew: true,
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

/**
 * Remove a git worktree and its associated branch
 * @param session Worktree session details
 */
export async function removeWorktree(session: WorktreeSession): Promise<void> {
  const repoRoot = session.repoRoot;

  try {
    // Get current branch in worktree before removing it
    let currentBranch: string | undefined;
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        {
          cwd: session.path,
          encoding: "utf8",
        },
      );
      currentBranch = stdout.trim();
    } catch {
      // Ignore errors getting current branch
    }

    // Remove worktree
    await execFileAsync(
      "git",
      ["worktree", "remove", "--force", session.path],
      {
        cwd: repoRoot,
      },
    );

    // Delete original branch
    try {
      await execFileAsync("git", ["branch", "-D", session.branch], {
        cwd: repoRoot,
      });
    } catch {
      // Ignore errors deleting original branch
    }

    // Delete current branch if it's different and not a protected branch
    if (
      currentBranch &&
      currentBranch !== session.branch &&
      currentBranch !== "HEAD"
    ) {
      const defaultRemoteBranch = getDefaultRemoteBranch(repoRoot);
      const defaultBranchName = defaultRemoteBranch.split("/").pop();

      if (
        currentBranch !== defaultBranchName &&
        currentBranch !== "main" &&
        currentBranch !== "master"
      ) {
        try {
          await execFileAsync("git", ["branch", "-D", currentBranch], {
            cwd: repoRoot,
          });
        } catch {
          // Ignore errors deleting current branch
        }
      }
    }
  } catch (error: unknown) {
    console.error(
      `Failed to remove worktree or branch: ${(error as Error).message}`,
    );
  }
}
