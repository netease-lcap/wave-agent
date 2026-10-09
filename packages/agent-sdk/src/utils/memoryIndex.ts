import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
  MEMORY_CAP_TARGET_RATIO,
  MEMORY_ENTRYPOINT_NAME,
  MEMORY_INDEX_LINE_GUIDANCE_CHARS,
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

/** A filename a markdown link cannot carry: it would break the link itself. */
const UNLINKABLE_FILENAME = /[[\]()\n\r\u2028\u2029]/;
const CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/u;

/**
 * One index entry for a topic file, or null when the file cannot be linked to.
 * The line is `- [title](file.md) — <description>`, with the description
 * trimmed so the whole line stays within the per-line guidance. A file with no
 * frontmatter `description` still gets its link — an unlabelled pointer beats
 * an undiscoverable file.
 */
function buildIndexLine(header: MemoryHeader): string | null {
  const filename = header.filename.split(path.sep).join("/");
  if (UNLINKABLE_FILENAME.test(filename) || CONTROL_CHARS.test(filename)) {
    return null;
  }

  const link = `- [${path.basename(filename, ".md")}](${filename})`;
  // The separator between the link and the description is ` — `, three chars.
  const budget = MEMORY_INDEX_LINE_GUIDANCE_CHARS - link.length - 3;
  const description = (header.description ?? "").replace(/\s+/g, " ").trim();
  if (!description || budget <= 1) return link;

  return `${link} — ${description.slice(0, budget)}`;
}

/**
 * Build a `MEMORY.md` from the topic files already on disk.
 *
 * Used when the index is absent but topic files exist — the state a memory
 * directory is in after it is copied in from elsewhere, or after the model
 * wrote topic files without ever creating the index. The index is the only way
 * a topic file is discovered, so without this those files are invisible.
 *
 * Capped at the same `cap * 0.7` targets the write-time notice compacts towards
 * (140 lines / 17,500 characters) so a backfilled index is never born over the
 * limit. Aligned with Claude Code's memory index backfill.
 */
export function buildMemoryEntrypoint(memories: MemoryHeader[]): string {
  const maxLines = Math.floor(
    MAX_MEMORY_ENTRYPOINT_LINES * MEMORY_CAP_TARGET_RATIO,
  );
  const maxChars = Math.floor(
    MAX_MEMORY_ENTRYPOINT_CHARS * MEMORY_CAP_TARGET_RATIO,
  );

  let content = "";
  let lineCount = 0;
  for (const memory of memories) {
    const line = buildIndexLine(memory);
    if (line === null) continue;
    if (
      lineCount + 1 > maxLines ||
      content.length + line.length + 1 > maxChars
    ) {
      break;
    }
    content += `${line}\n`;
    lineCount++;
  }

  return content;
}
