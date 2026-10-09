import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  MAX_MEMORY_DESCRIPTION_CHARS,
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
  MAX_MEMORY_FILE_BYTES,
  MAX_MEMORY_FILE_LINES,
  MEMORY_CAP_TARGET_RATIO,
  MEMORY_CAP_WARN_RATIO,
  MEMORY_ENTRYPOINT_NAME,
  MEMORY_INDEX_LINE_GUIDANCE_CHARS,
} from "../constants/memory.js";
import { EDIT_TOOL_NAME, WRITE_TOOL_NAME } from "../constants/tools.js";
import type { ToolResult } from "../tools/types.js";
import { parseFrontmatter } from "./markdownParser.js";
import { isPathInside } from "./pathSafety.js";

/**
 * Write-time capacity gate for the auto-memory files.
 *
 * The load-time truncation in `memoryEntrypoint.ts` only ever tells the reader
 * that something is missing, and it runs once per session — by then the write is
 * long done. These notices run in the write's own tool result instead, so the
 * model hears about it while it still has the file in hand.
 *
 * Thresholds and wording follow Claude Code's write-time gate
 * (`iDn=0.8` / `QG=0.7`, targets = cap * 0.7), with one measurement difference:
 * the index cap counts characters (`String.length`, matching the load-time
 * truncation), while the per-file cap counts bytes — a topic file is read whole
 * whenever it is opened, so its cost is bytes, not characters.
 */

interface CapDimension {
  frac: number;
  over: boolean;
  sizeDesc: string;
  capDesc: string;
  targetDesc: string;
}

function targetOf(cap: number): number {
  return Math.floor(cap * MEMORY_CAP_TARGET_RATIO);
}

/**
 * The dimension closest to (or past) its cap, or null when every dimension is
 * still under the warning ratio. Reporting the worst one keeps the notice short
 * and tells the model which limit is actually binding.
 */
function worstDimension(dimensions: CapDimension[]): CapDimension | null {
  const worst = dimensions.reduce((a, b) => (b.frac > a.frac ? b : a));
  return worst.frac < MEMORY_CAP_WARN_RATIO ? null : worst;
}

/** Line numbers of index entries longer than the per-line guidance, if any. */
function overlongIndexLineNotice(raw: string): string | null {
  const overlong: number[] = [];
  raw.split("\n").forEach((line, index) => {
    if (line.length > MEMORY_INDEX_LINE_GUIDANCE_CHARS)
      overlong.push(index + 1);
  });
  if (overlong.length === 0) return null;

  const shown = overlong
    .slice(0, 5)
    .map((line) => `line ${line}`)
    .join(", ");
  const more =
    overlong.length > 5
      ? ` (+${overlong.length - 5} more over-long lines)`
      : "";
  return `${overlong.length} index line(s) exceed the ~${MEMORY_INDEX_LINE_GUIDANCE_CHARS}-character guidance: ${shown}${more}. Derive each line from the topic file's frontmatter \`description\` and move the rest of the detail into that file.`;
}

/**
 * Notice to append to the result of a write that targeted `MEMORY.md`, or null
 * when the index is comfortably within both caps and every line is short.
 *
 * The wording of the over-cap case is deliberate: the write *did* succeed, and
 * saying so while naming the consequence is what makes the model rewrite the
 * file now instead of trusting that the next session will see it.
 */
export function buildEntrypointCapNotice(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lineCount = trimmed.split("\n").length;
  const charCount = trimmed.length;
  const parts: string[] = [];

  const worst = worstDimension([
    {
      frac: charCount / MAX_MEMORY_ENTRYPOINT_CHARS,
      over: charCount > MAX_MEMORY_ENTRYPOINT_CHARS,
      sizeDesc: `${charCount} characters`,
      capDesc: `${MAX_MEMORY_ENTRYPOINT_CHARS}-character`,
      targetDesc: `${targetOf(MAX_MEMORY_ENTRYPOINT_CHARS)} characters`,
    },
    {
      frac: lineCount / MAX_MEMORY_ENTRYPOINT_LINES,
      over: lineCount > MAX_MEMORY_ENTRYPOINT_LINES,
      sizeDesc: `${lineCount} lines`,
      capDesc: `${MAX_MEMORY_ENTRYPOINT_LINES}-line`,
      targetDesc: `${targetOf(MAX_MEMORY_ENTRYPOINT_LINES)} lines`,
    },
  ]);

  if (worst) {
    parts.push(
      worst.over
        ? `Error: this write left ${MEMORY_ENTRYPOINT_NAME} at ${worst.sizeDesc}, over its ${worst.capDesc} read limit. The write succeeded, but everything past the limit is silently dropped each time the index is loaded — entries at the end are already invisible to readers. Rewrite it to under ${worst.targetDesc} now: keep one line per entry, move detail into topic files, and merge or drop stale entries.`
        : `${MEMORY_ENTRYPOINT_NAME} is ${worst.sizeDesc}, approaching the ${worst.capDesc} read limit. Compact it to under ${worst.targetDesc} now: keep one line per entry, move detail into topic files, and merge or drop stale entries.`,
    );
  }

  const overlong = overlongIndexLineNotice(trimmed);
  if (overlong) parts.push(overlong);

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Notice to append to the result of a write that targeted a topic file in the
 * memory directory, or null when the file is small enough and its frontmatter
 * carries a usable `description`.
 */
export function buildMemoryFileCapNotice(
  raw: string,
  displayName: string,
  description: string | null,
): string | null {
  const trimmed = raw.trim();
  const parts: string[] = [];

  if (trimmed) {
    const byteCount = Buffer.byteLength(trimmed, "utf-8");
    const lineCount = trimmed.split("\n").length;

    const worst = worstDimension([
      {
        frac: byteCount / MAX_MEMORY_FILE_BYTES,
        over: byteCount > MAX_MEMORY_FILE_BYTES,
        sizeDesc: `${byteCount} bytes`,
        capDesc: `${MAX_MEMORY_FILE_BYTES}-byte`,
        targetDesc: `${targetOf(MAX_MEMORY_FILE_BYTES)} bytes`,
      },
      {
        frac: lineCount / MAX_MEMORY_FILE_LINES,
        over: lineCount > MAX_MEMORY_FILE_LINES,
        sizeDesc: `${lineCount} lines`,
        capDesc: `${MAX_MEMORY_FILE_LINES}-line`,
        targetDesc: `${targetOf(MAX_MEMORY_FILE_LINES)} lines`,
      },
    ]);

    if (worst) {
      parts.push(
        worst.over
          ? `Error: this write left the memory file ${displayName} at ${worst.sizeDesc}, over its ${worst.capDesc} limit. The write succeeded, but a topic file is read whole whenever it is opened, and ${MEMORY_ENTRYPOINT_NAME} can only point at it — everything past the limit costs context without being summarised. Rewrite it to under ${worst.targetDesc} now: keep one fact per file, split distinct facts into their own files, and summarise instead of appending.`
          : `The memory file ${displayName} is ${worst.sizeDesc}, approaching the ${worst.capDesc} limit. Keep it to one fact under ${worst.targetDesc}: summarise rather than append, and split distinct facts into their own files.`,
      );
    }
  }

  if (!description) {
    parts.push(
      `This memory file has no frontmatter \`description\`, so it cannot be summarised into the ${MEMORY_ENTRYPOINT_NAME} index. Add the frontmatter block (name, description, type) at the top.`,
    );
  } else if (description.length > MAX_MEMORY_DESCRIPTION_CHARS) {
    parts.push(
      `This memory file's \`description\` is ${description.length} characters. It becomes the one-line index entry; shorten it to one specific line (about ${MAX_MEMORY_DESCRIPTION_CHARS / 2} characters) that says what the file answers.`,
    );
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

function readDescription(raw: string): string | null {
  const { frontmatter } = parseFrontmatter(raw);
  const description = frontmatter?.description;
  return typeof description === "string" ? description : null;
}

/**
 * Append the matching capacity notice to a successful write's tool result.
 *
 * Hung off the one funnel every built-in call passes through
 * (`ToolManager.executeTool`), so a write made from the main agent, from the
 * extraction fork, and from inside the Exec sandbox all get the same treatment.
 * The path check runs first and the file is only read once the target is known
 * to be inside the memory directory, so writes elsewhere cost nothing.
 *
 * The notice is advisory: the write has already happened and is left alone.
 */
export async function appendMemoryCapNotice(
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResult,
  workdir: string,
  autoMemoryDir: string | undefined,
): Promise<void> {
  if (!result.success || !autoMemoryDir) return;
  if (toolName !== WRITE_TOOL_NAME && toolName !== EDIT_TOOL_NAME) return;

  const filePath = args.file_path;
  if (typeof filePath !== "string" || !filePath) return;

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(workdir, filePath);
  if (!isPathInside(absolutePath, autoMemoryDir)) return;

  let raw: string;
  try {
    raw = await fs.readFile(absolutePath, "utf-8");
  } catch {
    return;
  }

  const displayName = path.basename(absolutePath);
  const notice =
    displayName === MEMORY_ENTRYPOINT_NAME
      ? buildEntrypointCapNotice(raw)
      : buildMemoryFileCapNotice(raw, displayName, readDescription(raw));

  if (notice) result.content = `${result.content}\n\n${notice}`;
}
