import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  findWorktreeMapping,
  isLinkedWorktreeRoot,
  isPathWithin,
  normalizePathForComparison,
  resolveForComparison,
  toCheckoutPath,
  toWorktreePath,
} from "./worktreePaths.js";

export interface NestedMemoryFile {
  path: string;
  content: string;
}

/**
 * Memory file names to look for in a directory, in priority order:
 * `AGENTS.md` is the convention, `CLAUDE.md` the compatibility fallback —
 * the same order `MemoryService.readMemoryFile` uses for project memory.
 */
const NESTED_MEMORY_FILENAMES = ["AGENTS.md", "CLAUDE.md"] as const;

/**
 * Collect the memory files that sit in the directories above a file the agent
 * just read, outermost first.
 *
 * The root memory file is loaded eagerly into every request, so putting
 * subdirectory-specific conventions there costs context on every turn; this
 * pulls them in only once work actually reaches that subtree.
 *
 * Aligned with Claude Code's `nested_memory` attachment (attachments.ts
 * `getDirectoriesToProcess` + `memoryFilesToAttachments`): the walk stops at
 * the project root (the root's own memory file is already loaded), only
 * directories inside the project are considered, and the order is root-ward
 * first so the most specific file lands closest to the read.
 *
 * `loadedPaths` is the session-level dedup set, owned by the caller — it must
 * outlive any read-state cache, or an eviction re-injects the same file.
 * `isAlreadyRead` mirrors Claude Code's `readFileState` check in
 * `memoryFilesToAttachments` (attachments.ts): a memory file the model already
 * has in context (it Read the file itself) is not injected a second time.
 */
export async function findNestedMemoryFiles(
  filePath: string,
  workdir: string,
  loadedPaths: Set<string>,
  isAlreadyRead?: (absolutePath: string) => boolean,
): Promise<NestedMemoryFile[]> {
  const root = path.resolve(workdir);
  const rootResolved = resolveForComparison(root);
  // A file read from a linked worktree is walked in checkout coordinates (the
  // directories above it only exist as one tree), then each directory is
  // mapped back into the worktree so the worktree's own copy is what gets
  // injected. Without this a mid-session EnterWorktree silently disabled
  // nested memory: nothing sat inside `workdir` any more.
  const mapping = findWorktreeMapping(path.resolve(filePath), root);
  const walkPath =
    mapping === null
      ? path.resolve(filePath)
      : toCheckoutPath(filePath, mapping);
  const directories: string[] = [];

  let current = path.dirname(walkPath);
  while (
    resolveForComparison(current) !== rootResolved &&
    isPathWithin(current, root)
  ) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Outermost (closest to the project root) first — Claude Code's order.
  directories.reverse();

  const memories: NestedMemoryFile[] = [];

  for (const walkDir of directories) {
    const directory =
      mapping === null ? walkDir : toWorktreePath(walkDir, mapping);

    // Another checkout's root memory. The walk can only reach a linked
    // worktree root when the mapping above failed to recognise the path (a
    // different spelling of the same directory — see `resolveForComparison`),
    // and that root's file is a second copy of the root memory this session
    // already loaded eagerly. Claude Code drops the same directories in its
    // eager walk (`claudemd.ts` `skipProject`, issue #29599); this is the
    // nested-phase equivalent.
    if (
      resolveForComparison(directory) !== rootResolved &&
      isLinkedWorktreeRoot(directory)
    ) {
      continue;
    }

    for (const filename of NESTED_MEMORY_FILENAMES) {
      const candidate = path.join(directory, filename);
      // One memory file per directory: a directory whose AGENTS.md was already
      // injected must not fall through to its CLAUDE.md. The key is the lexical
      // form (`normalizePathForComparison`, as Claude Code keys `processedPaths`)
      // so casing differences on Windows collapse onto one key.
      if (loadedPaths.has(normalizePathForComparison(candidate))) break;

      // Already in the model's context because it read the file itself; the
      // caller's read-state cache is deliberately not consulted, exactly like
      // Claude Code's `loadedNestedMemoryPaths` / `readFileState` split — the
      // read-state side may evict entries and would then re-inject the file.
      if (isAlreadyRead?.(candidate)) break;

      try {
        const content = await fs.readFile(candidate, "utf-8");
        loadedPaths.add(normalizePathForComparison(candidate));
        memories.push({ path: candidate, content });
        break;
      } catch {
        // Try the next candidate name; a missing AGENTS.md falls back to
        // CLAUDE.md, and an unreadable file must not abort the whole chain.
      }
    }
  }

  return memories;
}
