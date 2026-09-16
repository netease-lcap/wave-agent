import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  MEMORY_ENTRYPOINT_NAME,
  parseMemoryType,
  type MemoryType,
} from "../constants/memory.js";
import { parseFrontmatter } from "./markdownParser.js";

export interface MemoryHeader {
  filename: string;
  filePath: string;
  mtimeMs: number;
  description: string | null;
  type: MemoryType | undefined;
}

const MAX_MEMORY_FILES = 200;

/**
 * List the topic files in the auto-memory directory with their frontmatter
 * metadata, newest first.
 *
 * The listing is injected into the extraction fork prompt so the agent can tell
 * whether a memory already exists without spending a turn on `ls`. `MEMORY.md`
 * is excluded — it is the index, not a topic file.
 *
 * Aligned with Claude Code's `memdir/memoryScan.ts`. Two deliberate
 * differences: Wave has a single memory directory (no private/team split), and
 * we read the whole file instead of the first 30 lines — memory topic files are
 * small, and one `readFile` plus one `stat` is simpler than a bounded read that
 * has to return the mtime itself.
 */
export async function scanMemoryFiles(
  memoryDir: string,
): Promise<MemoryHeader[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(memoryDir, { recursive: true });
  } catch {
    // The directory is created lazily; a missing one simply has no memories.
    return [];
  }

  const headers = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.endsWith(".md") &&
          path.basename(entry) !== MEMORY_ENTRYPOINT_NAME,
      )
      .map(async (filename): Promise<MemoryHeader | null> => {
        const filePath = path.join(memoryDir, filename);
        try {
          const [content, stats] = await Promise.all([
            fs.readFile(filePath, "utf-8"),
            fs.stat(filePath),
          ]);
          const { frontmatter } = parseFrontmatter(content);
          return {
            filename,
            filePath,
            mtimeMs: stats.mtimeMs,
            description:
              typeof frontmatter?.description === "string"
                ? frontmatter.description
                : null,
            type: parseMemoryType(frontmatter?.type),
          };
        } catch {
          // A single unreadable file must not hide the rest of the directory.
          return null;
        }
      }),
  );

  return headers
    .filter((header): header is MemoryHeader => header !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_MEMORY_FILES);
}

/**
 * Format memory headers as one line per file:
 * `- [type] filename (timestamp): description`. The type tag and the
 * description are each omitted when absent, so a legacy file without
 * frontmatter degrades to `- filename (timestamp)`.
 */
export function formatMemoryManifest(memories: MemoryHeader[]): string {
  return memories
    .map((memory) => {
      const tag = memory.type ? `[${memory.type}] ` : "";
      const timestamp = new Date(memory.mtimeMs).toISOString();
      return memory.description
        ? `- ${tag}${memory.filename} (${timestamp}): ${memory.description}`
        : `- ${tag}${memory.filename} (${timestamp})`;
    })
    .join("\n");
}
