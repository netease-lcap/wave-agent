import * as fs from "node:fs";
import * as path from "node:path";

/**
 * A linked git worktree and the main checkout it belongs to.
 *
 * Mirrors Claude Code's worktree↔checkout mapping (`worktreeRoot` / `checkout`):
 * path-scoped memory rules live in whichever tree the rules directory was found
 * in, while the agent may be reading files from the other tree (a session that
 * entered a worktree mid-flight, or a worktree nested inside the checkout).
 * Relativizing both sides through this mapping keeps the patterns meaningful.
 */
export interface WorktreeMapping {
  /** Root of the linked worktree (`<checkout>/.wave/worktrees/<name>` or similar) */
  worktreeRoot: string;
  /** Root of the main checkout that owns that worktree */
  checkout: string;
}

const WORKTREE_GITDIR_PATTERN = /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/;

/** True when `target` is `parent` or sits under it (pure string math, no fs). */
function isWithin(target: string, parent: string): boolean {
  const rel = path.relative(parent, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Read `<dir>/.git` as a gitfile (`gitdir: <checkout>/.git/worktrees/<name>`)
 * and return the checkout root. A normal repository (`.git` is a directory) and
 * anything unreadable return null.
 */
function checkoutOfWorktreeRoot(dir: string): string | null {
  const dotGit = path.join(dir, ".git");
  try {
    if (!fs.statSync(dotGit).isFile()) return null;
    const content = fs.readFileSync(dotGit, "utf8").trim();
    const prefix = "gitdir:";
    if (!content.startsWith(prefix)) return null;
    const gitDir = path.resolve(dir, content.slice(prefix.length).trim());
    const match = WORKTREE_GITDIR_PATTERN.exec(gitDir);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Cache of `.git` probes, keyed by directory. Negative results are cached too —
 * memory-rule matching runs per read, per pattern source, and probing the same
 * ancestors on every read is pure waste.
 */
const worktreeRootCache = new Map<string, WorktreeMapping | null>();

function mappingForWorktreeRoot(dir: string): WorktreeMapping | null {
  const cached = worktreeRootCache.get(dir);
  if (cached !== undefined) return cached;
  const checkout = checkoutOfWorktreeRoot(dir);
  const mapping = checkout === null ? null : { worktreeRoot: dir, checkout };
  worktreeRootCache.set(dir, mapping);
  return mapping;
}

/** Drop the `.git` probe cache (worktrees that were removed/re-created). */
export function resetWorktreePathCache(): void {
  worktreeRootCache.clear();
}

/**
 * Find the worktree the target path lives in, walking up until `baseDir`.
 * Returns null when the target is not inside a linked worktree related to
 * `baseDir` (the common case: no fs traffic beyond the stat/read of `.git`).
 */
export function findWorktreeMapping(
  targetPath: string,
  baseDir: string,
): WorktreeMapping | null {
  const base = path.resolve(baseDir);
  let current = path.dirname(path.resolve(targetPath));
  while (current !== base && current !== path.dirname(current)) {
    const mapping = mappingForWorktreeRoot(current);
    if (mapping !== null) {
      const related =
        isWithin(mapping.checkout, base) ||
        isWithin(base, mapping.checkout) ||
        isWithin(base, mapping.worktreeRoot);
      if (related) return mapping;
    }
    current = path.dirname(current);
  }
  return null;
}

/** Translate a path inside the worktree into its checkout counterpart. */
export function toCheckoutPath(
  targetPath: string,
  mapping: WorktreeMapping,
): string {
  const resolved = path.resolve(targetPath);
  if (!isWithin(resolved, mapping.worktreeRoot)) return resolved;
  return path.join(
    mapping.checkout,
    path.relative(mapping.worktreeRoot, resolved),
  );
}

/** Translate a path inside the checkout into its worktree counterpart. */
export function toWorktreePath(
  targetPath: string,
  mapping: WorktreeMapping,
): string {
  const resolved = path.resolve(targetPath);
  if (!isWithin(resolved, mapping.checkout)) return resolved;
  return path.join(
    mapping.worktreeRoot,
    path.relative(mapping.checkout, resolved),
  );
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Base-relative, forward-slash path of `targetPath`, or null when it cannot be
 * expressed relative to `baseDir` (outside it, on another drive, or the base
 * itself). Callers treat null as "this rule cannot apply" instead of letting a
 * `../…` path silently fail every glob.
 */
export function relativeToBase(
  targetPath: string,
  baseDir: string,
): string | null {
  const rel = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

/**
 * Relativize a trigger path (the file the agent just read/edited) against the
 * rule's base directory.
 *
 * A path inside a linked worktree is mapped back to its checkout counterpart
 * *first* — a worktree nested inside the checkout (wave's own
 * `.wave/worktrees/<name>` layout) is technically "inside" the base, so
 * relativizing before mapping would yield `.wave/worktrees/wt/src/a.ts` and
 * every `src/**` rule would silently stop matching.
 *
 * Non-absolute inputs are treated as already base-relative (that is how legacy
 * callers pass `@mention` targets), matching the pre-mapping behavior.
 */
export function relativizeTriggerPath(
  targetPath: string,
  baseDir: string,
): string | null {
  if (!path.isAbsolute(targetPath)) {
    const legacy = toPosix(targetPath).replace(/^\.\//, "");
    return legacy === "" || legacy === "." || legacy.startsWith("../")
      ? null
      : legacy;
  }
  const mapping = findWorktreeMapping(targetPath, baseDir);
  const resolved =
    mapping === null
      ? path.resolve(targetPath)
      : toCheckoutPath(targetPath, mapping);
  return relativeToBase(resolved, baseDir);
}
