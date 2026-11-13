/**
 * The worktree delete core — shared by every entry point that removes one.
 *
 * There are two such entry points, in two packages:
 *
 * - `worktreeUtils.removeWorktree` in this package (ExitWorktree, subagent
 *   isolation, the startup sweep) — synchronous, best-effort, no return value;
 * - `utils/worktree.removeWorktree` in `packages/code` (TUI exit, `-p`,
 *   `wave daemon destroy --remove-worktree`, the remote-control `destroy`) —
 *   asynchronous, returns "is the directory gone", retries the delete.
 *
 * They differ in exactly those things: the calling convention around the
 * delete. Everything that decides *what* gets deleted lives here, once. The
 * two used to be independent implementations and drifted: one grew the
 * inverted order and the other stayed git-first, so the path users hit every
 * day kept the bug the other had fixed.
 *
 * Why the order is inverted at all
 * -------------------------------
 * git's exit code is not trustworthy for this job. On Windows git cannot
 * remove the directory symlinks/junctions pnpm's `node_modules` is made of, so
 * `git worktree remove` deletes the files, leaves the skeleton behind and still
 * exits 0; the opposite also happens (it deregisters, then fails to delete).
 * Whichever way, the directory and git's records end up disagreeing — the
 * recurring "directory residue + branch still there + worktree no longer
 * registered" report.
 *
 * So git does not perform the delete and neither does the pointer go first. The
 * order is Claude Code's (`mn()` with `pointerFirst: false`, i.e. what every
 * caller uses):
 *
 *   1. the checks below (main working tree / lock / pointer points back);
 *   2. read the pointer's bytes;
 *   3. Windows only: clear the reparse points;
 *   4. delete every entry under the worktree EXCEPT the root `.git`;
 *   5. unlink the root `.git`;
 *   6. remove the now-empty directory;
 *   7. only if 6 failed: write the pointer back;
 *   8. the caller runs `git worktree prune` and `branch -D`.
 *
 * Steps 4 and 5 are in that order on purpose. Step 4 is the long, failure-prone
 * one — seconds on a pnpm `node_modules`, and the one that fails on a file some
 * other process still holds. While it runs the `.git` pointer is still on disk,
 * so git still recognises the worktree: a process killed in that window leaves a
 * directory that is still registered, which `git worktree prune` and the next
 * removal both find. Steps 5 and 6 are microsecond-scale, and the only window
 * they open (pointer gone, empty shell still there) is closed by the restore in
 * step 7 the moment the shell delete reports failure.
 *
 * The three failure points therefore act on the pointer differently, and the
 * difference is the whole point of the rework:
 *
 * | failed at | `.git` on disk? | action |
 * | --- | --- | --- |
 * | 4 (contents) | yes, never touched | nothing to restore |
 * | 5 (unlink) | yes, the unlink failed | nothing to restore |
 * | 6 (shell) | no, already unlinked | write the bytes back |
 *
 * Either way the branch is kept: the directory survived, and its branch is the
 * only ref still leading back to whatever work is in it.
 *
 * Everything a crash can therefore leave behind is something git knows about.
 * That is the property the git-first order could not hold, since it stranded a
 * deregistered checkout on every junction-skeleton failure.
 *
 * Because git no longer performs the delete, the checks it used to make are made
 * here: never the main working tree, never a `git worktree lock`ed worktree, and
 * only a directory whose `.git` points back into this repo.
 *
 * Async all the way down
 * ----------------------
 * Every step that walks the tree uses `fs.promises`, never `readdirSync` /
 * `rmSync` / `unlinkSync`. This code runs inside the long-lived `wave --stdio`
 * process, which serves several sessions at once: a pnpm `node_modules` takes
 * minutes to walk, and a synchronous pass would block the event loop for that
 * whole time — every other session's JSON-RPC reply stalls behind it, including
 * the remote-control `destroy` answer that times out after 20 s. `fs.promises`
 * runs on the libuv pool, so the loop (and those replies) keep moving while the
 * delete grinds on. Only the microsecond-scale accesses stay synchronous: the
 * gitfile, the lock file, and the one directory level read while explaining a
 * failure.
 *
 * Side-effect free apart from the filesystem: callers own logging, the retry
 * policy, and the git commands that finish the job (`prune`, `branch -D`).
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { getGitCommonDir } from "./gitUtils.js";
import { normalizePathForComparison } from "./worktreePaths.js";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Same path, whatever spelling/case each side arrived in (Windows folds both).
 *
 * The two sides reach us from different sources — a caller's snapshot must not
 * be compared to git's canonical path with `===` (8.3 short names, drive-letter
 * case, unexpanded junctions).
 */
export function isSamePath(a: string, b: string): boolean {
  return (
    normalizePathForComparison(path.resolve(a)) ===
    normalizePathForComparison(path.resolve(b))
  );
}

/** `target` strictly inside `parent` (equal paths do not count). */
function isStrictlyWithin(target: string, parent: string): boolean {
  const rel = path.relative(
    normalizePathForComparison(parent),
    normalizePathForComparison(target),
  );
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function errnoOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : "";
}

/** Human-readable message of an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * On Windows, prefix an absolute path with the extended-length marker (`\\?\`)
 * so recursive removal bypasses the 260-char MAX_PATH limit. POSIX paths are
 * returned unchanged.
 */
export function toExtendedLengthPath(worktreePath: string): string {
  if (process.platform !== "win32") {
    return worktreePath;
  }
  const absolute = path.win32.resolve(worktreePath);
  if (absolute.startsWith("\\\\?\\")) {
    return absolute;
  }
  if (absolute.startsWith("\\\\")) {
    // UNC path: \\server\share -> \\?\UNC\server\share
    return `\\\\?\\UNC\\${absolute.slice(2)}`;
  }
  return `\\\\?\\${absolute}`;
}

/**
 * Describe what is still on disk after a failed removal. Without this a log
 * line cannot distinguish "directory already gone" from "the whole checkout is
 * still sitting there".
 */
export function describeWorktreeResidue(worktreePath: string): string {
  try {
    if (!fs.existsSync(worktreePath)) return "none";
    const entries = fs.readdirSync(worktreePath) as string[];
    const head = entries.slice(0, 5).join(",");
    return `${entries.length}[${head}${entries.length > 5 ? ",…" : ""}]`;
  } catch (error) {
    return `unknown(${(error as { code?: string }).code ?? "error"})`;
  }
}

/**
 * Turn a raw delete failure into a sentence that says what to do. The errno
 * alone ("EPERM") names nothing actionable; Claude Code maps these to the same
 * user-facing reasons (`I1e`).
 */
export function describeRemovalFailure(
  error: unknown,
  unremovableReparsePoint: string | null,
): string {
  if (unremovableReparsePoint !== null) {
    return `a reparse point inside could not be removed: ${unremovableReparsePoint} (a junction/symlink that is in use, or one this account cannot replace)`;
  }
  const code = errnoOf(error);
  switch (code) {
    case "ENOTEMPTY":
      return "a folder inside could not be emptied — it may be unreadable, or something is still writing to it";
    case "EBUSY":
    case "EPERM":
    case "EACCES":
      return "a program still has one of the worktree's files open";
    case "ENAMETOOLONG":
      return "a path inside is too long for this filesystem's delete, even with the extended-length (\\\\?\\) form";
    default:
      return code === ""
        ? errorMessage(error)
        : `${code}: ${errorMessage(error)}`;
  }
}

// ---------------------------------------------------------------------------
// The worktree's `.git` pointer
//
// Two things depend on it. The pointer itself: git stops recognizing the
// worktree the moment the file is gone, which is what makes the delete
// recoverable. And the administrative dir it names —
// `<commonGitDir>/worktrees/<name>` — which is where `git worktree lock`
// records its reason and the one piece of evidence that this directory really
// is a linked worktree of *this* repo.
// ---------------------------------------------------------------------------

export interface WorktreePointer {
  /** Raw bytes, so a failed delete can put the file back unchanged */
  content: Buffer;
  /** The worktree's administrative dir in the shared git dir */
  gitDir: string;
}

export type WorktreePointerProbe =
  | { kind: "pointer"; pointer: WorktreePointer }
  /** No `.git` at all: a previous cleanup already removed the pointer */
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string };

const GITDIR_POINTER_PREFIX = "gitdir:";

/** Read the worktree's `.git` gitfile without touching the directory. */
export function probeWorktreePointer(
  worktreePath: string,
): WorktreePointerProbe {
  const dotGit = path.join(worktreePath, ".git");
  let content: Buffer;
  try {
    content = fs.readFileSync(dotGit) as Buffer;
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return { kind: "absent" };
    return {
      kind: "unreadable",
      reason: `${errnoOf(error) || "read failed"}: ${errorMessage(error)}`,
    };
  }
  // A directory here is the main working tree's own `.git` (git refuses the
  // read with EISDIR before this line); anything else that is not a gitfile is
  // not a linked worktree either.
  const text = String(content).trim();
  if (!text.startsWith(GITDIR_POINTER_PREFIX)) {
    return { kind: "unreadable", reason: "its .git is not a worktree gitfile" };
  }
  const target = path.resolve(
    worktreePath,
    text.slice(GITDIR_POINTER_PREFIX.length).trim(),
  );
  return { kind: "pointer", pointer: { content, gitDir: target } };
}

/**
 * The shared git dir of `repoRoot`, i.e. where worktree administrative dirs
 * live. Asked of git rather than assumed to be `<repoRoot>/.git`: a repo can
 * keep its git dir elsewhere (`--separate-git-dir`, a gitfile), and the
 * authenticity check below must not refuse a legitimate worktree there.
 *
 * This is a synchronous git call, so `pointsBackIntoRepo` only reaches it after
 * the ordinary layout has been ruled out — the common case spawns nothing.
 */
function commonGitDirOf(repoRoot: string): string {
  try {
    const commonDir = getGitCommonDir(repoRoot);
    if (typeof commonDir === "string" && commonDir !== "") return commonDir;
  } catch {
    // Not a repo (or git is missing) — the lexical answer is the best we have.
  }
  return path.join(repoRoot, ".git");
}

/**
 * True when `gitDir` is a worktree administrative dir of the repo at
 * `repoRoot`, i.e. sits under `<commonGitDir>/worktrees/`.
 *
 * This is what keeps the removal from destroying an independent clone: its
 * `.git` is a real git dir holding the only copy of its history, and a
 * recursive delete would happily take it. Claude Code refuses the same case
 * (`not_pointing_back`).
 */
export function pointsBackIntoRepo(gitDir: string, repoRoot: string): boolean {
  if (isStrictlyWithin(gitDir, path.join(repoRoot, ".git", "worktrees"))) {
    return true;
  }
  return isStrictlyWithin(
    gitDir,
    path.join(commonGitDirOf(repoRoot), "worktrees"),
  );
}

/**
 * `git worktree lock` state, read from the worktree's administrative dir.
 *
 * The lock file is located through the `.git` pointer rather than by name
 * (`<repoRoot>/.git/worktrees/<name>`): git names the administrative dir after
 * the worktree path's basename and de-duplicates collisions, so a nested name
 * like `feat/my-branch` does not live at `worktrees/feat/my-branch`. Callers in
 * other packages also pass guessed names.
 *
 * An unreadable lock file counts as locked: the failure mode we care about is
 * deleting a worktree git was told to hold on to.
 */
export function probeWorktreeLock(gitDir: string): {
  locked: boolean;
  reason: string;
} {
  try {
    const reason = String(
      fs.readFileSync(path.join(gitDir, "locked"), "utf8"),
    ).trim();
    return { locked: true, reason };
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return { locked: false, reason: "" };
    return { locked: true, reason: `unreadable lock file (${errnoOf(error)})` };
  }
}

/**
 * Put the `.git` gitfile back after a failed delete so git's registration and
 * the directory on disk stay in agreement: "directory still there" continues to
 * mean "git still knows about it", instead of the half-state that left users
 * with a stranded checkout, a live branch and no record tying them together.
 */
export async function restoreWorktreePointer(
  worktreePath: string,
  content: Buffer,
): Promise<unknown | null> {
  try {
    await fs.promises.writeFile(path.join(worktreePath, ".git"), content);
    return null;
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------
// Windows reparse points
// ---------------------------------------------------------------------------

export interface ReparsePointPass {
  /** Reparse points unlinked (or rmdir'd) before the real delete */
  unlinked: number;
  /** The first one that could not be removed, if any */
  unremovable: string | null;
}

/**
 * Try to remove one link without following it. `unlink` covers symlinks to
 * files, `rmdir` a directory reparse point (on Windows a junction is removed by
 * `RemoveDirectory`, which drops the reparse point and leaves its target
 * alone). `true` means the link is gone — including "it was not there".
 */
async function removeLink(linkPath: string): Promise<boolean> {
  try {
    await fs.promises.unlink(linkPath);
    return true;
  } catch {
    // Junction / directory symlink: rmdir is the one that works on Windows.
  }
  try {
    await fs.promises.rmdir(linkPath);
    return true;
  } catch (error) {
    return errnoOf(error) === "ENOENT";
  }
}

/**
 * Depth-first walk that clears reparse points out of the tree before the real
 * delete (Claude Code's `pXe`: Windows only).
 *
 * Why it exists: pnpm's `node_modules` is a skeleton of junctions, and Windows
 * deletes them on neither `unlink` nor a plain recursive descriptor walk
 * reliably — that is the failure that made `git worktree remove` exit 0 with
 * the directory still there. Doing it up front means the recursive delete sees
 * ordinary directories, and a link that genuinely cannot be replaced is named
 * in the failure log instead of surfacing as a bare EPERM.
 *
 * Best-effort by construction: every failure is swallowed here and only the
 * `unremovable` verdict is reported. A link is never walked into — its contents
 * belong to the link's target, not to the worktree.
 */
export async function clearReparsePoints(
  target: string,
  isLink: boolean,
  state: ReparsePointPass,
): Promise<void> {
  if (isLink) {
    if (await removeLink(target)) {
      state.unlinked++;
    } else if (state.unremovable === null) {
      state.unremovable = target;
    }
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = (await fs.promises.readdir(target, {
      withFileTypes: true,
    })) as fs.Dirent[];
  } catch {
    // A plain file, or a directory we cannot list — the delete reports it.
    return;
  }
  for (const entry of entries) {
    const entryIsLink = entry.isSymbolicLink();
    if (!entryIsLink && !entry.isDirectory()) continue;
    await clearReparsePoints(path.join(target, entry.name), entryIsLink, state);
  }
}

// ---------------------------------------------------------------------------
// The delete itself
// ---------------------------------------------------------------------------

/** The root gitfile's name — the one entry steps 4 and 5 diverge over. */
const GITFILE_NAME = ".git";

/**
 * Step 4: delete everything under the worktree **except** the root `.git`.
 *
 * Returning an error means the pointer was never touched — nothing was
 * unlinked, so there is nothing to restore and git still registers the
 * worktree. That is the property this split exists for: the failure that
 * actually happens (a file another process holds, an unremovable junction) is
 * the one that leaves git's records intact.
 *
 * One recursive delete per top-level entry rather than one over the whole tree,
 * because the root `.git` has to survive the pass. Each per-entry delete is
 * still recursive, so nested content is removed by Node (which handles
 * directory symlinks/junctions, the thing git gives up on) in one call.
 *
 * Callers own the retry policy: a directory held by a process that is only now
 * exiting becomes deletable a moment later, and how long to wait for that is a
 * per-entry-point decision (`worktreeRemoveRetry` in `packages/code`). The
 * retry belongs around *this* call and no other — once the pointer is gone,
 * re-running the sequence makes no sense.
 */
export async function removeWorktreeContents(
  worktreePath: string,
): Promise<unknown | null> {
  const root = toExtendedLengthPath(worktreePath);
  let entries: fs.Dirent[];
  try {
    entries = (await fs.promises.readdir(root, {
      withFileTypes: true,
    })) as fs.Dirent[];
  } catch (error) {
    // Already gone: there is no content left to delete, and the steps after this
    // one are no-ops rather than failures.
    return errnoOf(error) === "ENOENT" ? null : error;
  }
  for (const entry of entries) {
    if (entry.name === GITFILE_NAME) continue;
    try {
      // `path.join` keeps the `\\?\` prefix, so the per-entry delete stays
      // extended-length too (the entries can be the longest paths in the tree).
      await fs.promises.rm(path.join(root, entry.name), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      return error;
    }
  }
  return null;
}

/**
 * Delete the worktree directory, returning the error when it fails (null on
 * success). Node removes directory symlinks/junctions properly, which is
 * exactly where git gives up on Windows.
 *
 * By the time `finishWorktreeRemoval` reaches this the tree is empty and the
 * pointer is gone, so this is the microsecond-scale step: it cannot fail the way
 * the content delete does, and if it somehow does there is nothing left to
 * retry (the pointer is gone) — the caller restores the pointer instead.
 */
export async function removeWorktreeDirectory(
  worktreePath: string,
): Promise<unknown | null> {
  try {
    await fs.promises.rm(toExtendedLengthPath(worktreePath), {
      recursive: true,
      force: true,
    });
    return null;
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------
// The shared sequence: check, delete the contents, detach, remove the shell
// ---------------------------------------------------------------------------

/** Why the core refused to touch a worktree. */
export type WorktreeRefusalReason =
  | "main-working-tree"
  | "unreadable-pointer"
  | "not-pointing-back"
  | "locked";

export interface WorktreePrepared {
  status: "prepared";
  /** The pointer read before anything was deleted; null when it was already gone */
  pointer: WorktreePointer | null;
  /** True when there was no `.git` at all: a plain leftover directory */
  leftover: boolean;
  reparsePointsUnlinked: number;
  /** The first reparse point that could not be removed, if any */
  reparsePointUnremovable: string | null;
}

export interface WorktreeRefusal {
  status: "refused";
  reason: WorktreeRefusalReason;
  /** One sentence naming what was found and what to do — the only copy of it */
  message: string;
  /** Evidence the caller may want in its own log line */
  details: { gitDir?: string; lockReason?: string; pointerProblem?: string };
}

export type WorktreePreparation =
  | WorktreePrepared
  | WorktreeRefusal
  /** No directory: nothing to delete. Its branch may still exist. */
  | { status: "absent" };

/**
 * Steps 1–3: everything that must happen before a single file is deleted. Make
 * the checks git used to make, read the pointer, and clear the reparse points
 * Windows cannot recurse over.
 *
 * The pointer comes back in the result because a later step may need to write it
 * back. Splitting the sequence up rather than shipping one function is
 * deliberate: the content delete (step 4) has to stay in the caller (one shot
 * vs. a retry loop), and the restore must happen after the caller's *last*
 * attempt, never between attempts — rewriting the pointer and retrying would
 * leave a stray `.git` behind once an attempt succeeds.
 *
 * Non-throwing by contract: every outcome is a value, so both the SDK's
 * "best-effort, return nothing" caller and `packages/code`'s "return whether the
 * directory is gone" caller can use it.
 */
export async function prepareWorktreeRemoval(options: {
  worktreePath: string;
  repoRoot: string;
}): Promise<WorktreePreparation> {
  const { worktreePath, repoRoot } = options;

  // Never the main working tree: the containment check callers run before this
  // is satisfied by the repo root itself, and deleting that takes the user's
  // checkout.
  if (isSamePath(worktreePath, repoRoot)) {
    return {
      status: "refused",
      reason: "main-working-tree",
      message:
        `Refusing to remove ${worktreePath} — it is the repository's main ` +
        `working tree, so deleting it would take the checkout itself; nothing ` +
        `was deleted.`,
      details: {},
    };
  }

  // Already gone: nothing to delete. The branch still goes, which is what makes
  // a repeated removal idempotent.
  if (!fs.existsSync(worktreePath)) return { status: "absent" };

  const probe = probeWorktreePointer(worktreePath);
  if (probe.kind === "unreadable") {
    // Without a readable pointer there is nothing to restore if the delete
    // fails, and the directory may well be a main working tree or an unrelated
    // repo — refuse rather than guess.
    return {
      status: "refused",
      reason: "unreadable-pointer",
      message:
        `Refusing to remove worktree ${worktreePath} — its .git pointer is ` +
        `unusable (${probe.reason}); without it there is nothing to restore if ` +
        `the delete fails, and the directory may be a main working tree or an ` +
        `unrelated repository; nothing was deleted.`,
      details: { pointerProblem: probe.reason },
    };
  }

  let pointer: WorktreePointer | null = null;
  if (probe.kind === "pointer") {
    pointer = probe.pointer;
    if (!pointsBackIntoRepo(pointer.gitDir, repoRoot)) {
      return {
        status: "refused",
        reason: "not-pointing-back",
        message:
          `Refusing to remove worktree ${worktreePath} — its .git does not ` +
          `point into this repo (${pointer.gitDir}); it may be an independent ` +
          `clone whose history exists only here, so nothing was deleted.`,
        details: { gitDir: pointer.gitDir },
      };
    }
    const lock = probeWorktreeLock(pointer.gitDir);
    if (lock.locked) {
      return {
        status: "refused",
        reason: "locked",
        message:
          `Refusing to remove worktree ${worktreePath} — it is locked` +
          (lock.reason === "" ? "" : ` (${lock.reason})`) +
          `; nothing was deleted. \`git worktree unlock ${worktreePath}\` ` +
          `unlocks it.`,
        details: { lockReason: lock.reason, gitDir: pointer.gitDir },
      };
    }
  }

  // Windows only: junctions are the reason this pass exists, and on POSIX a
  // symlink inside a worktree is ordinary user content that the recursive delete
  // handles. Runs before the content delete because that is the pass which
  // cannot remove them on Windows.
  const reparse: ReparsePointPass = { unlinked: 0, unremovable: null };
  if (process.platform === "win32") {
    await clearReparsePoints(worktreePath, false, reparse);
  }

  return {
    status: "prepared",
    pointer,
    leftover: probe.kind === "absent",
    reparsePointsUnlinked: reparse.unlinked,
    reparsePointUnremovable: reparse.unremovable,
  };
}

export type WorktreeFinish =
  /** Both steps done: the directory is gone. */
  | { status: "removed" }
  /** The `.git` could not be unlinked: nothing else was touched. */
  | { status: "pointer-stuck"; reason: string }
  /**
   * The `.git` was unlinked and the empty directory could not be removed: the
   * pointer goes back so git keeps recognising the directory that survived.
   */
  | {
      status: "shell-stuck";
      error: unknown;
      reason: string;
      /** True when the pointer bytes are back on disk */
      pointerRestored: boolean;
      /** Why the write-back failed, when it did */
      restoreError: unknown | null;
    };

/**
 * Steps 5–7: unlink the root `.git`, remove the now-empty directory, and — only
 * if that last step failed — write the pointer back.
 *
 * The restore is attached to step 6 alone. Steps 4 and 5 failing both leave the
 * pointer on disk untouched, so writing it again would be a no-op at best and a
 * lie about what happened at worst; and the pointer must not go back while the
 * directory is fine, or every successful removal would leave a `.git` behind.
 */
export async function finishWorktreeRemoval(options: {
  worktreePath: string;
  pointer: WorktreePointer | null;
  /** Named in the failure sentence instead of a bare errno */
  reparsePointUnremovable: string | null;
}): Promise<WorktreeFinish> {
  const { worktreePath, reparsePointUnremovable } = options;
  let pointer = options.pointer;

  if (pointer !== null) {
    try {
      await fs.promises.unlink(path.join(worktreePath, GITFILE_NAME));
    } catch (error) {
      if (errnoOf(error) !== "ENOENT") {
        // A directory that is still registered would be deleted out from under
        // git, i.e. exactly the dangling-registration state this design exists
        // to eliminate. Stop while the two still agree.
        return {
          status: "pointer-stuck",
          reason: describeRemovalFailure(error, reparsePointUnremovable),
        };
      }
      // Already gone (a concurrent cleanup, a previous partial run): nothing to
      // restore, and the delete is still worth doing.
      pointer = null;
    }
  }

  const shellError = await removeWorktreeDirectory(worktreePath);
  if (shellError === null) return { status: "removed" };

  const restoreError =
    pointer === null
      ? null
      : await restoreWorktreePointer(worktreePath, pointer.content);
  return {
    status: "shell-stuck",
    error: shellError,
    reason: describeRemovalFailure(shellError, reparsePointUnremovable),
    pointerRestored: pointer !== null && restoreError === null,
    restoreError,
  };
}

// ---------------------------------------------------------------------------
// Explaining a removal that did not happen
// ---------------------------------------------------------------------------

export interface WorktreeRemovalOutcomeInput {
  /** The directory that is still on disk */
  worktreePath: string;
  /** The repository the worktree was supposed to belong to */
  repoRoot: string;
  /** The branch the removal would have deleted; "" when the caller cannot name it */
  branch: string;
}

/**
 * What to tell the user when the worktree directory is still there, and what —
 * if anything — they should do about it by hand.
 *
 * "The removal returned false" covers two situations that need opposite
 * answers. Either the delete was attempted and failed (a file held open,
 * ENOTEMPTY, an unremovable junction: the two commands below are right), or the
 * removal was *refused* before anything was touched — a locked worktree, a
 * directory that is its own repository, the main working tree. The text used to
 * be written for the first case only and ends in `rm -rf <path>`, so printing it
 * for a refusal told the user to delete an independent clone (destroying the
 * only copy of its history), to bypass a `git worktree lock`, or to remove their
 * own checkout. Users copy these lines out of a terminal.
 *
 * That is why this probes the directory instead of taking a reason argument:
 * callers only have `false`, nothing else. The destructive advice appears in
 * exactly one branch — the one where deleting the directory really is the fix.
 *
 * Synchronous and non-throwing, so every caller (three CLI paths, a tool
 * result, a subagent log line) can share it.
 */
export function describeWorktreeRemovalOutcome(
  input: WorktreeRemovalOutcomeInput,
): string {
  const { worktreePath, repoRoot, branch } = input;

  // The main working tree is not a worktree at all: the containment check
  // callers run is satisfied by the repo root itself, and deleting it takes the
  // user's checkout with it.
  if (isSamePath(worktreePath, repoRoot)) {
    return (
      `Removal refused: ${worktreePath} is the main working tree of ` +
      `${repoRoot}, not a worktree — nothing was deleted\n` +
      `There is nothing to clean up here: this path is your checkout`
    );
  }

  // A `.git` *directory* means the path is a repository root of its own. For a
  // linked worktree `.git` is a gitfile, never a directory.
  if (isGitDirectory(worktreePath)) {
    return independentRepositoryAdvice(worktreePath, repoRoot);
  }

  const probe = probeWorktreePointer(worktreePath);
  if (probe.kind === "pointer") {
    // A gitfile that points outside this repo's worktree registration is the
    // same case as above: somebody else's repository, not ours.
    if (!pointsBackIntoRepo(probe.pointer.gitDir, repoRoot)) {
      return independentRepositoryAdvice(worktreePath, repoRoot);
    }
    // `git worktree lock`: git was told to hold on to this one. `rm -rf` would
    // bypass the lock and leave the registration dangling, so the next step is
    // the unlock command, not a delete.
    const lock = probeWorktreeLock(probe.pointer.gitDir);
    if (lock.locked) {
      return (
        `Removal refused: ${worktreePath} is locked` +
        (lock.reason === "" ? "" : ` (${lock.reason})`) +
        ` — nothing was deleted\n` +
        `Unlock it first: git worktree unlock ${worktreePath}`
      );
    }
  } else if (probe.kind === "unreadable") {
    // Nothing on disk says what this directory is, and hand-deleting something
    // unverified is exactly how the refusals above become data loss.
    return (
      `Removal refused: could not verify what ${worktreePath} is ` +
      `(${probe.reason}) — nothing was deleted\n` +
      `Check it before touching it: git -C ${worktreePath} rev-parse --show-toplevel`
    );
  }

  // The delete was attempted and failed. The directory is a leftover of this
  // repo, its branch was kept on purpose, and these two commands are the fix.
  // Wording unchanged: it is the one users already know.
  const kept = branch ? `branch ${branch}` : "every branch";
  return (
    `Worktree directory survived at ${worktreePath}; kept ${kept} so the ` +
    `leftover checkout stays reachable\n` +
    `Clean up manually: rm -rf ${worktreePath}` +
    (branch ? ` && git -C ${repoRoot} branch -D ${branch}` : "")
  );
}

/**
 * "This is somebody else's repository" — the case where the obvious cleanup
 * command is the destructive one, so no delete command is offered at all.
 *
 * The message deliberately never spells out `rm -rf`: users copy these lines out
 * of a terminal, and the one thing they must not copy here is the delete.
 */
function independentRepositoryAdvice(
  worktreePath: string,
  repoRoot: string,
): string {
  return (
    `Removal refused: ${worktreePath} is an independent repository, not a ` +
    `worktree of ${repoRoot} — nothing was deleted\n` +
    `Do not delete it: its objects and history exist only in that directory, ` +
    `so deleting it would destroy the repository. Inspect it instead with ` +
    `git -C ${worktreePath} log`
  );
}

/** Is `<worktreePath>/.git` a directory (i.e. a repository root, not a worktree)? */
function isGitDirectory(worktreePath: string): boolean {
  try {
    return fs.lstatSync(path.join(worktreePath, ".git")).isDirectory();
  } catch {
    // Missing, a gitfile, or unreadable — not decidable here, and the probe
    // below has better answers for those.
    return false;
  }
}
