import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isPathInside } from "./pathSafety.js";

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
 */
export async function findNestedMemoryFiles(
  filePath: string,
  workdir: string,
  loadedPaths: Set<string>,
): Promise<NestedMemoryFile[]> {
  const root = path.resolve(workdir);
  const directories: string[] = [];

  let current = path.dirname(path.resolve(filePath));
  while (current !== root && isPathInside(current, root)) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Outermost (closest to the project root) first — Claude Code's order.
  directories.reverse();

  const memories: NestedMemoryFile[] = [];

  for (const directory of directories) {
    for (const filename of NESTED_MEMORY_FILENAMES) {
      const candidate = path.join(directory, filename);
      // One memory file per directory: a directory whose AGENTS.md was already
      // injected must not fall through to its CLAUDE.md.
      if (loadedPaths.has(candidate)) break;

      try {
        const content = await fs.readFile(candidate, "utf-8");
        loadedPaths.add(candidate);
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
