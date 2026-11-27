import * as path from "node:path";
import * as fsSync from "node:fs";
import { execFileSyncHidden } from "./execFileHidden.js";
import { resolveWorktreeGitDirs } from "./worktreePaths.js";

/**
 * Check if a directory is a git repository
 * @param dirPath Directory path
 * @returns "Yes" if it's a git repository, "No" otherwise
 */
export function isGitRepository(dirPath: string): string {
  try {
    // Check if .git directory exists in current directory or any parent directory
    let currentPath = path.resolve(dirPath);
    while (currentPath !== path.dirname(currentPath)) {
      const gitPath = path.join(currentPath, ".git");
      if (fsSync.existsSync(gitPath)) {
        return "Yes";
      }
      currentPath = path.dirname(currentPath);
    }
    return "No";
  } catch {
    return "No";
  }
}

/**
 * Get the root directory of the git repository
 * @param cwd Working directory
 * @returns Repository root path
 */
export function getGitRepoRoot(cwd: string): string {
  try {
    return execFileSyncHidden("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

/**
 * Get the common directory of the git repository (handles worktrees)
 * @param cwd Working directory
 * @returns Repository common directory path
 */
export function getGitCommonDir(cwd: string): string {
  try {
    const commonDir = execFileSyncHidden(
      "git",
      ["rev-parse", "--git-common-dir"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return path.resolve(cwd, commonDir);
  } catch {
    return getGitRepoRoot(cwd);
  }
}

/**
 * 当前仓库 `origin` 的远端地址，没配远端时 `null`。
 *
 * 技能钩子要按托管方分叉（`/code-review` 决定敲 `gh` 还是 `glab`），而正文在这一轮
 * 就得把段落选好，不能等模型自己去 `git remote`。与 `detectSessionRepo` 同口径
 * **每次现读**：用户可能在会话中间改 remote。没配远端是正常状态（本地 init 的
 * 仓库），返回 `null` 而不是抛错。
 *
 * @param cwd Working directory
 */
export function getRemoteUrl(cwd: string): string | null {
  try {
    const url = execFileSyncHidden(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

/**
 * Get the main repository root directory (the first worktree in the list)
 * @param cwd Working directory
 * @returns Main repository root path
 */
export function getGitMainRepoRoot(cwd: string): string {
  try {
    const output = execFileSyncHidden(
      "git",
      ["worktree", "list", "--porcelain"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    const lines = output.split("\n");
    if (lines.length > 0 && lines[0].startsWith("worktree ")) {
      return lines[0].substring("worktree ".length).trim();
    }
    return getGitRepoRoot(cwd);
  } catch {
    return getGitRepoRoot(cwd);
  }
}

/**
 * The linked git worktree `dir` **is**, plus the checkout it belongs to.
 *
 * The structural half — is this a linked worktree at all, and which git dirs is
 * it wired to — is `resolveWorktreeGitDirs`, the same hardened parser the
 * memory-rule path mapping uses (#2851: two parsers answering differently for
 * one directory is how a worktree ends up judged twice). Its checks are what
 * stop a cloned repo from pointing `commondir` at a directory the user can read
 * and having this answer describe someone else's tree.
 *
 * Only the worktree's own root qualifies. A subdirectory of a worktree is not a
 * worktree root here: the answer decides which directory a session may write in,
 * and a subdirectory would narrow that to itself.
 *
 * Callers pass the session's opening directory (`SessionWorkdir`), not the
 * moving `CurrentWorkdir`: a `cd` inside the session must not decide who owns
 * the write scope.
 *
 * @returns `name` (the directory's own name, what a session shows as its
 * worktree) and `repoRoot` (the checkout's working tree), or undefined when
 * `dir` is not a linked worktree root or its checkout cannot be established.
 */
export function readLinkedWorktree(
  dir: string,
): { name: string; repoRoot: string } | undefined {
  const resolved = resolveWorktreeGitDirs(dir);
  if (!resolved) return undefined;
  const repoRoot = checkoutOfCommonDir(resolved.commonDir);
  if (!repoRoot) return undefined;
  return { name: path.basename(resolved.worktreeRoot), repoRoot };
}

/**
 * The working tree a shared git dir belongs to.
 *
 * `<checkout>/.git` answers `<checkout>` on the spot — the shape every plain
 * repository and every worktree of one produces. Any other common dir is a
 * submodule's `.git/modules/<name>`, a bare repository, or a
 * `--separate-git-dir` repository, and those have no path-shaped answer: git
 * records the checkout as `core.worktree` in that git dir's config when it has
 * one, and `git worktree list` does **not** know better (measured 2026-11-25:
 * for both a submodule worktree and a `--separate-git-dir` worktree, porcelain
 * reports the *git dir* as the main worktree). Bare and `--separate-git-dir`
 * repositories never set it — there is no main working tree to protect — so
 * both answer undefined rather than pointing the guard at a git dir.
 */
function checkoutOfCommonDir(commonDir: string): string | undefined {
  if (path.basename(commonDir) === ".git") return path.dirname(commonDir);
  try {
    const configFile = path.join(commonDir, "config");
    if (!fsSync.lstatSync(configFile).isFile()) return undefined;
    const worktree = coreWorktreeOf(fsSync.readFileSync(configFile, "utf8"));
    if (!worktree) return undefined;
    const checkout = path.resolve(commonDir, worktree);
    // A config we cannot turn into a directory that is actually there (an
    // unexpanded `~`, a stale absolute path) is no protection at all.
    return fsSync.existsSync(checkout) ? checkout : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `core.worktree` of a git config file, or undefined. Just enough config
 * parsing for that one key: sections are `[core]`, the value may be quoted, and
 * everything else is skipped.
 */
function coreWorktreeOf(config: string): string | undefined {
  let inCore = false;
  for (const rawLine of config.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      inCore = section[1].trim().toLowerCase() === "core";
      continue;
    }
    if (!inCore) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    if (line.slice(0, separator).trim().toLowerCase() !== "worktree") continue;
    const value = line.slice(separator + 1).trim();
    const unquoted =
      value.startsWith('"') && value.endsWith('"') && value.length > 1
        ? value.slice(1, -1)
        : value;
    return unquoted || undefined;
  }
  return undefined;
}

/**
 * Resolve the git directory for a repository by walking up from `cwd`.
 * Handles both normal repos (.git is a directory) and worktrees
 * (.git is a file pointing to the main repo's worktree git dir).
 * For worktrees, reads the `commondir` file to find the common git dir.
 * @param cwd Working directory to start searching from
 * @returns Absolute path to the git directory, or null if not found
 */
export function resolveGitDir(cwd: string): string | null {
  let currentPath = path.resolve(cwd);
  while (currentPath !== path.dirname(currentPath)) {
    const gitPath = path.join(currentPath, ".git");
    if (fsSync.existsSync(gitPath)) {
      const stat = fsSync.statSync(gitPath);
      if (stat.isDirectory()) {
        // Normal repo: .git is a directory
        return gitPath;
      }
      // Worktree: .git is a file containing "gitdir: <path>"
      try {
        const content = fsSync.readFileSync(gitPath, "utf8").trim();
        const prefix = "gitdir: ";
        if (content.startsWith(prefix)) {
          const worktreeGitDir = content.substring(prefix.length);
          // Read commondir to find the common git dir
          const commondirPath = path.join(worktreeGitDir, "commondir");
          if (fsSync.existsSync(commondirPath)) {
            const commondirRel = fsSync
              .readFileSync(commondirPath, "utf8")
              .trim();
            return path.resolve(worktreeGitDir, commondirRel);
          }
          // Fallback: resolve ../.. from the worktree git dir
          return path.resolve(worktreeGitDir, "..", "..");
        }
      } catch {
        return null;
      }
    }
    currentPath = path.dirname(currentPath);
  }
  return null;
}

/**
 * Read a symbolic ref file in the git directory.
 * If the file content starts with "ref: ", returns the target ref path.
 * Symbolic refs are never packed in packed-refs, so only loose refs are checked.
 * @param gitDir Absolute path to the git directory
 * @param refPath Relative path to the ref file (e.g., "refs/remotes/origin/HEAD")
 * @returns The symbolic ref target, or null if not a symbolic ref or on error
 */
function readSymref(gitDir: string, refPath: string): string | null {
  try {
    const fullPath = path.join(gitDir, refPath);
    const content = fsSync.readFileSync(fullPath, "utf8").trim();
    if (content.startsWith("ref: ")) {
      return content.substring("ref: ".length);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a git ref exists, checking both loose refs and packed-refs.
 * @param gitDir Absolute path to the git directory
 * @param refPath Relative path to the ref (e.g., "refs/remotes/origin/main")
 * @returns True if the ref exists, false otherwise
 */
function refExists(gitDir: string, refPath: string): boolean {
  // 1. Check loose ref
  const loosePath = path.join(gitDir, refPath);
  if (fsSync.existsSync(loosePath)) {
    return true;
  }
  // 2. Check packed-refs
  try {
    const packedRefsPath = path.join(gitDir, "packed-refs");
    const content = fsSync.readFileSync(packedRefsPath, "utf8");
    for (const line of content.split("\n")) {
      // Skip comments and peeled lines
      if (line.startsWith("#") || line.startsWith("^")) {
        continue;
      }
      // Format: <sha> <refPath>
      const parts = line.split(" ");
      if (parts.length >= 2 && parts[1] === refPath) {
        return true;
      }
    }
  } catch {
    // packed-refs doesn't exist or can't be read
  }
  return false;
}

/**
 * Get the default remote branch (e.g., origin/main) using filesystem reads.
 * No subprocess calls — matches Claude Code's approach.
 *
 * Priority:
 * 1. Read refs/remotes/origin/HEAD symref → extract branch name (verify it exists)
 * 2. Check if refs/remotes/origin/main ref exists
 * 3. Check if refs/remotes/origin/master ref exists
 * 4. Hardcoded "main" fallback
 *
 * @param cwd Working directory
 * @returns Default remote branch name
 */
export function getDefaultRemoteBranch(cwd: string): string {
  const gitDir = resolveGitDir(cwd);
  if (!gitDir) {
    return "main";
  }

  // 1. Try reading origin/HEAD symref
  const symref = readSymref(gitDir, "refs/remotes/origin/HEAD");
  if (symref) {
    const branch = symref.replace("refs/remotes/", "");
    // Verify the resolved branch actually exists (origin/HEAD can be stale)
    if (refExists(gitDir, symref)) {
      return branch;
    }
  }

  // 2. Check if origin/main exists
  if (refExists(gitDir, "refs/remotes/origin/main")) {
    return "origin/main";
  }

  // 3. Check if origin/master exists
  if (refExists(gitDir, "refs/remotes/origin/master")) {
    return "origin/master";
  }

  // 4. Hardcoded fallback
  return "main";
}

/**
 * Module-level set tracking git dirs already processed in this process,
 * to avoid redundant I/O.
 */
const excludedGitDirs = new Set<string>();

/**
 * Ensure that Wave runtime files are excluded from git status by writing
 * patterns to `.git/info/exclude` (per-repo, not global).
 *
 * Idempotent: if the marker `# wave-runtime` is already present in the
 * exclude file, it skips writing. A module-level Set provides additional
 * per-process dedup to avoid redundant file reads.
 *
 * @param cwd Working directory to start searching from
 */
export function ensureWaveRuntimeFilesExcluded(cwd: string): void {
  try {
    const gitDir = resolveGitDir(cwd);
    if (!gitDir) return;

    if (excludedGitDirs.has(gitDir)) return;

    const excludePath = path.join(gitDir, "info", "exclude");
    let content = "";
    try {
      content = fsSync.readFileSync(excludePath, "utf8");
    } catch {
      // File doesn't exist yet
    }

    const marker = "# wave-runtime";
    if (content.includes(marker)) {
      excludedGitDirs.add(gitDir);
      return;
    }

    const block = [
      marker,
      "**/.wave/scheduled_tasks.lock",
      "**/.wave/scheduled_tasks.json",
      "**/.wave/worktrees/",
      "**/.wave/settings.local.json",
      "",
    ].join("\n");

    fsSync.mkdirSync(path.join(gitDir, "info"), { recursive: true });
    fsSync.appendFileSync(excludePath, block);
    excludedGitDirs.add(gitDir);
  } catch {
    // Best-effort: ignore all errors
  }
}

/**
 * Check if there are uncommitted changes in the working directory
 * @param cwd Working directory
 * @returns True if there are uncommitted changes
 */
export function hasUncommittedChanges(cwd: string): boolean {
  try {
    const status = execFileSyncHidden("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if there are new commits in the current branch that are not in the base branch
 * @param cwd Working directory
 * @param baseBranch Base branch name (e.g., origin/main)
 * @returns True if there are new commits
 */
export function hasNewCommits(cwd: string, baseBranch?: string): boolean {
  try {
    const range = baseBranch ? `${baseBranch}..HEAD` : "@{u}..HEAD";
    const log = execFileSyncHidden("git", ["log", range, "--oneline"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return log.length > 0;
  } catch {
    return false;
  }
}
