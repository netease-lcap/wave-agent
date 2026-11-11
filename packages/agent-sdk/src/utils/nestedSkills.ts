/**
 * Subtree skill discovery: skills that live next to the code an agent is
 * actually working on, pulled in when work reaches that subtree.
 *
 * Startup discovery scans one level — `<workdir>/.wave/skills` and its
 * `.claude` / `.agents` siblings. In a monorepo the interesting skills usually
 * live further down (`packages/api/.wave/skills/…`), and recursively walking the
 * whole tree at startup would be both slow and noisy: every subsystem's skills
 * would land in the list whether or not this conversation ever touches them.
 *
 * So discovery is triggered by file operations instead, exactly like nested
 * `AGENTS.md` (`utils/nestedMemory.ts`) — a file the agent reads, writes or
 * edits makes its ancestor chain interesting, and the walk stops at the workdir
 * because the workdir's own skills are already loaded eagerly.
 *
 * The walk is deliberately bounded:
 *  - only ancestors strictly inside the workdir (the root level is eager);
 *  - dot-prefixed ancestors are skipped (`.cache`, `.venv` … are never a
 *    project's skill home);
 *  - dependency / build-output ancestors are skipped (`node_modules`,
 *    `dist`, …): reading a vendored file must not turn a half-written
 *    `.claude/skills` inside a dependency into a callable skill.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EXCLUDED_DIRS } from "./fileIndex.js";
import {
  findWorktreeMapping,
  isPathWithin,
  resolveForComparison,
  toCheckoutPath,
  toWorktreePath,
} from "./worktreePaths.js";

/**
 * Config directories that may hold skills, **lowest priority first**: a
 * `.wave/skills` overrides a `.claude/skills` in the same directory, matching
 * the startup scan's precedence.
 */
const SKILL_CONFIG_DIRS = [".agents", ".claude", ".wave"] as const;

/** Directory name that is never an ancestor worth probing. */
function isExcludedDirName(name: string): boolean {
  if (name.startsWith(".")) return true;
  return (EXCLUDED_DIRS as readonly string[]).includes(name);
}

/**
 * Whether any path segment of `target` (relative to `root`) is an excluded
 * directory name. Checked per ancestor, so `repo/node_modules/.cache` is skipped
 * as a whole rather than only at its dot-prefixed tail.
 */
function hasExcludedSegment(target: string, root: string): boolean {
  const relativePath = path.relative(root, target);
  if (!relativePath) return false;
  return relativePath.split(path.sep).some(isExcludedDirName);
}

/**
 * Find the skill roots above a file that the agent just operated on.
 *
 * Returns the skill root directories that exist, **outermost first** — the
 * caller merges them in order, so a deeper directory's skill wins over a
 * shallower one with the same name (the more specific context wins, same as
 * nested memory), and within one directory `.wave` wins over `.claude`/`.agents`.
 *
 * `probed` is the session-level "already checked" set, and it records misses as
 * well as hits: the common case is "no skills anywhere down here", and without
 * that record every Read in the same subtree would re-stat the same absent
 * directories.
 */
export async function findNestedSkillRoots(
  filePath: string,
  workdir: string,
  probed: Set<string>,
): Promise<string[]> {
  const root = path.resolve(workdir);

  // The walk runs in whichever coordinate system makes the ancestor chain one
  // tree. A file inside a linked worktree is walked in checkout coordinates (the
  // directories above it only exist as one tree), then each directory is mapped
  // back so the worktree's own copy is what gets loaded — the same treatment
  // nested memory gives it. The session root is mapped along so that "stop at
  // the session's starting directory" still means the worktree the session was
  // opened in, and so the exclusion check reads the real project hierarchy
  // rather than the `.wave/worktrees/<name>` prefix the worktree physically sits
  // under.
  const mapping = findWorktreeMapping(path.resolve(filePath), root);
  // Identity today: `findWorktreeMapping` scans upwards only as far as `root`,
  // so a mapping is reported only when the worktree sits *below* it — i.e. the
  // session root is already in checkout coordinates. Mapped anyway so both ends
  // of the walk are read in one coordinate system.
  const walkRoot = mapping === null ? root : toCheckoutPath(root, mapping);
  const walkFile =
    mapping === null
      ? path.resolve(filePath)
      : toCheckoutPath(filePath, mapping);
  const walkRootResolved = resolveForComparison(walkRoot);

  const directories: string[] = [];
  let current = path.dirname(walkFile);
  while (
    resolveForComparison(current) !== walkRootResolved &&
    isPathWithin(current, walkRoot)
  ) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Outermost first: the caller's later writes (deeper) override earlier ones.
  directories.reverse();

  const found: string[] = [];
  for (const walkDir of directories) {
    if (hasExcludedSegment(walkDir, walkRoot)) continue;
    const directory =
      mapping === null ? walkDir : toWorktreePath(walkDir, mapping);

    for (const configDir of SKILL_CONFIG_DIRS) {
      const skillsRoot = path.join(directory, configDir, "skills");
      if (probed.has(skillsRoot)) continue;
      probed.add(skillsRoot);
      try {
        const stats = await fs.stat(skillsRoot);
        if (stats.isDirectory()) found.push(skillsRoot);
      } catch {
        // No skills here; the miss is recorded above so we never ask again.
      }
    }
  }

  return found;
}
