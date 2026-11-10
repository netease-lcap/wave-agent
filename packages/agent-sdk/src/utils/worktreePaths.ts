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

const realPathCache = new Map<string, string>();

/**
 * Lexical form used for keying dedup sets — Claude Code's
 * `normalizePathForComparison` (`utils/file.ts`), same job: collapse separators
 * and `.`/`..`, and on Windows fold case so two casings of one path land on the
 * same key. Deliberately no filesystem access: it runs once per candidate on a
 * per-read path.
 */
export function normalizePathForComparison(p: string): string {
  const normalized = path.normalize(p);
  return process.platform === "win32"
    ? normalized.replace(/\//g, "\\").toLowerCase()
    : normalized;
}

/**
 * `fs.realpathSync.native` for paths that may not exist yet (a Write target, an
 * `@mention` that has not been created), where the plain call throws and the
 * lexical spelling would be kept — which is exactly the mismatch this module
 * exists to erase. Falls back to the deepest existing ancestor plus the
 * remainder, so the canonical spelling still wins.
 */
function realPathOf(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    // Not a real path yet; resolve its parent instead.
  }
  const { root } = path.parse(p);
  let dir = path.dirname(p);
  let tail = path.basename(p);
  while (dir !== root && dir !== path.dirname(dir)) {
    try {
      return path.join(fs.realpathSync.native(dir), tail);
    } catch {
      tail = path.join(path.basename(dir), tail);
      dir = path.dirname(dir);
    }
  }
  return p;
}

/**
 * Resolve `p` to the one spelling every comparison in this module uses.
 *
 * Two spellings of the same directory compare unequal as strings, and the
 * mapping below is only as good as that comparison: when it fails, the nested
 * memory walk stops translating worktree paths into checkout coordinates and
 * crawls straight into another checkout's root memory. The spellings that
 * actually show up: Windows 8.3 short names (`LIUYIQ~1` vs `liuyiqi02`), drive
 * letter / username casing, and a workdir that was entered through a symlink
 * while git's gitfile records the resolved path (git writes it with
 * `strbuf_realpath`). `realpathSync.native` is the Windows one that expands
 * short names — the JS fallback leaves them as written; lowercasing covers the
 * case-insensitive filesystems when neither is available.
 *
 * Claude Code solves the same problem by realpathing both sides before
 * comparing (`utils/git.ts` `resolveCanonicalRoot`). Missing paths — and a test
 * double without `realpath` — fall back as described in `realPathOf`.
 */
export function resolveForComparison(p: string): string {
  const resolved = path.resolve(p);
  const cached = realPathCache.get(resolved);
  if (cached !== undefined) return cached;

  let real = realPathOf(resolved);
  // macOS hands back decomposed (NFD) names for the same directory that git
  // records precomposed (NFC); Claude Code normalizes its git roots the same
  // way (`utils/git.ts` `.normalize('NFC')`), otherwise the two spellings are
  // byte-different and every comparison below misses.
  real = real.normalize("NFC");
  if (process.platform === "win32") real = real.toLowerCase();

  // Bounded: the cache is a hot-path optimization, not a registry.
  if (realPathCache.size >= 512) realPathCache.clear();
  realPathCache.set(resolved, real);
  return real;
}

/**
 * True when `target` is `parent` or sits under it, ignoring which spelling each
 * side arrived in. Both sides go through `resolveForComparison`, so a short
 * name, a different casing, or a symlinked entry point still compares as the
 * same directory — `path.relative` alone silently mismatches those.
 */
export function isPathWithin(target: string, parent: string): boolean {
  const rel = path.relative(
    resolveForComparison(parent),
    resolveForComparison(target),
  );
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * `path.relative` between two paths that may be spelled differently. Computing
 * it on the raw strings would hand back `..\..\…` garbage for the same
 * directory, so both sides are resolved first.
 */
function relativeResolved(target: string, parent: string): string {
  return path.relative(
    resolveForComparison(parent),
    resolveForComparison(target),
  );
}

/**
 * Read `<dir>/.git` as a gitfile (`gitdir: <checkout>/.git/worktrees/<name>`)
 * and return the checkout root. A normal repository (`.git` is a directory) and
 * anything unreadable return null.
 *
 * The three structure checks mirror Claude Code's `resolveCanonicalRoot`
 * (`utils/git.ts`): both files the chain reads are written by a cloned repo and
 * therefore attacker-controlled, and this mapping decides which `AGENTS.md`
 * gets pulled into the model's context. Without the checks a repo could point
 * `commondir`/`gitdir` at any directory the user can read and have that
 * directory's memory file injected.
 *
 * A structural mismatch returns null rather than "the input root" (what Claude
 * Code returns): the caller here is asking "is this a linked worktree, and of
 * which checkout", and a `null` lets the walk fall back to the plain path.
 */
function checkoutOfWorktreeRoot(dir: string): string | null {
  const dotGit = path.join(dir, ".git");
  try {
    if (!fs.statSync(dotGit).isFile()) return null;
    const content = fs.readFileSync(dotGit, "utf8").trim();
    const prefix = "gitdir:";
    if (!content.startsWith(prefix)) return null;
    const worktreeGitDir = path.resolve(
      dir,
      content.slice(prefix.length).trim(),
    );
    // Both files below are read from a cloned repo, so they are only trusted
    // once each is a plain file: a symlinked `commondir`/`gitdir` is how a repo
    // redirects the read outside the tree it appears to describe (Claude Code
    // rejects the same kinds in `oV`).
    const commondirFile = path.join(worktreeGitDir, "commondir");
    const gitdirFile = path.join(worktreeGitDir, "gitdir");
    if (!isPlainFile(commondirFile) || !isPlainFile(gitdirFile)) return null;
    // `commondir` (relative to the worktree's git dir) leads to the shared
    // `.git`. Submodules have none, which is how they fall out here.
    const commonDir = path.resolve(
      worktreeGitDir,
      fs.readFileSync(commondirFile, "utf8").trim(),
    );
    // (1) The git dir the gitfile pointed at must be a direct child of
    // `<commonDir>/worktrees`, so the commondir we just read lived inside the
    // resolved common dir rather than inside the attacker's tree.
    if (
      path.resolve(path.dirname(worktreeGitDir)) !==
      path.join(commonDir, "worktrees")
    ) {
      return null;
    }
    // (2) The worktree's own gitdir backlink must point at this `.git`, so an
    // attacker cannot borrow an existing worktree entry by guessing its path.
    // Git writes the backlink with `strbuf_realpath`, while `dir` arrives in
    // whatever spelling the host handed us, so both sides go through
    // `resolveForComparison` — Claude Code realpaths both here too, but with
    // the non-native `realpathSync`, which (measured on Windows, Node 25 and
    // Bun 1.4) leaves an 8.3 short-name `dir` (`LIUYIQ~1`) unexpanded while
    // git's backlink carries the long form; that rejects every legitimate
    // worktree created from a short-name cwd. `native` expands both, and the
    // case fold keeps the case-insensitive filesystems honest.
    const backlink = fs.readFileSync(gitdirFile, "utf8").trim();
    if (
      resolveForComparison(backlink) !==
      path.join(resolveForComparison(dir), ".git")
    ) {
      return null;
    }
    // A backslash in any leg of the chain is a Windows path smuggled into a
    // POSIX-resolution chain — every path here is built with `path.sep`.
    if (
      path.sep === "/" &&
      [dir, worktreeGitDir, commonDir, backlink].some((p) => p.includes("\\"))
    ) {
      return null;
    }
    // (3) A bare-repo worktree has no working directory to map paths into, and
    // this mapping exists purely to translate paths between two working trees.
    if (path.basename(commonDir) !== ".git") return null;
    return path.dirname(commonDir);
  } catch {
    return null;
  }
}

/** A regular file, not a symlink/special file and not something unprobeable. */
function isPlainFile(p: string): boolean {
  try {
    return fs.lstatSync(p).isFile();
  } catch {
    return false;
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
  realPathCache.clear();
}

/** True when `dir` is the root of a linked worktree (`.git` is a gitfile). */
export function isLinkedWorktreeRoot(dir: string): boolean {
  return mappingForWorktreeRoot(path.resolve(dir)) !== null;
}

/**
 * Find the worktree the target path lives in, walking up until `baseDir`.
 * Returns null when the target is not inside a linked worktree related to
 * `baseDir` (the common case: no fs traffic beyond the stat/read of `.git`).
 *
 * Both comparisons below go through `resolveForComparison`: git records the
 * worktree's own path resolved, while the caller's `baseDir` arrives with
 * whatever spelling the host handed us, so a lexical compare silently misses
 * its own worktree (`resolveForComparison` has the full list of spellings).
 */
export function findWorktreeMapping(
  targetPath: string,
  baseDir: string,
): WorktreeMapping | null {
  const base = path.resolve(baseDir);
  const baseResolved = resolveForComparison(base);
  let current = path.dirname(path.resolve(targetPath));
  while (
    resolveForComparison(current) !== baseResolved &&
    current !== path.dirname(current)
  ) {
    const mapping = mappingForWorktreeRoot(current);
    if (mapping !== null) {
      const related =
        isPathWithin(mapping.checkout, base) ||
        isPathWithin(base, mapping.checkout) ||
        isPathWithin(base, mapping.worktreeRoot);
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
  if (!isPathWithin(resolved, mapping.worktreeRoot)) return resolved;
  return path.join(
    mapping.checkout,
    relativeResolved(resolved, mapping.worktreeRoot),
  );
}

/** Translate a path inside the checkout into its worktree counterpart. */
export function toWorktreePath(
  targetPath: string,
  mapping: WorktreeMapping,
): string {
  const resolved = path.resolve(targetPath);
  if (!isPathWithin(resolved, mapping.checkout)) return resolved;
  return path.join(
    mapping.worktreeRoot,
    relativeResolved(resolved, mapping.checkout),
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
  // Resolved on both sides: a rule directory reached through one spelling and
  // a trigger file through another would otherwise relativize to `../…` and the
  // rule would silently never match.
  const rel = relativeResolved(targetPath, baseDir);
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
