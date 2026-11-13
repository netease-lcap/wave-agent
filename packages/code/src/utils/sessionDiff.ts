/**
 * Per-turn file diffs for the CLI `/diff` overlay (the "each turn" half of
 * Claude Code's `/diff`; the other half — uncommitted changes — comes from
 * `utils/workspaceDiff.ts`).
 *
 * The data has to be rebuilt from the conversation: a tool block keeps the
 * tool's *parameters* and a one-line result, not a patch (the SDK reports only
 * `linesAdded`/`linesRemoved` metadata), so an Edit is re-diffed from
 * `old_string`/`new_string` and a Write renders its content as additions. That
 * is what `DiffDisplay` already does for one tool block; this module aggregates
 * it per turn, the way `/diff` lists "Turn N" entries.
 */

import { diffLines } from "diff";
import {
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
  type EditToolParameters,
  type Message,
  type ToolBlock,
  type WriteToolParameters,
} from "wave-agent-sdk";
import { relative, isAbsolute } from "node:path";

export type DiffLineKind = "add" | "remove" | "context" | "hunk";

export interface DiffLine {
  kind: DiffLineKind;
  /** Content without the unified-diff prefix (`+`, `-`, ` `). */
  text: string;
}

export interface DiffFileEntry {
  path: string;
  additions: number;
  deletions: number;
  /** Rendered rows, in file order, hunk headers included. */
  lines: DiffLine[];
  /** The file has no textual patch (binary or oversized). */
  binary?: boolean;
  /** The hunks were cut short by a line cap. */
  truncated?: boolean;
  /** Why there is nothing to show — rendered in place of the hunks. */
  note?: string;
}

export interface SessionTurnDiff {
  /** 1-based index over the conversation's user prompts. */
  turnIndex: number;
  promptPreview: string;
  files: DiffFileEntry[];
}

/** Longest prompt preview a turn header carries, ellipsis included. */
export const PROMPT_PREVIEW_MAX = 40;

function splitLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  // `diffLines` keeps the trailing newline in the value, so the last element of
  // a block that ends with "\n" is an empty string rather than a row.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Split a unified-diff body (as `getWorkspaceDiff` returns it: rows from the
 * first `@@` on) into renderable lines. The `\ No newline at end of file`
 * marker is not a content row and is dropped.
 */
export function parseUnifiedDiff(hunks: string): DiffLine[] {
  if (!hunks) return [];
  const lines: DiffLine[] = [];
  for (const raw of hunks.split("\n")) {
    if (raw.startsWith("@@")) {
      lines.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "remove", text: raw.slice(1) });
    } else if (raw.startsWith("\\")) {
      continue;
    } else {
      // Context rows carry a single leading space; git always emits it, but a
      // hand-trimmed patch may not, so the space is optional here.
      lines.push({
        kind: "context",
        text: raw.startsWith(" ") ? raw.slice(1) : raw,
      });
    }
  }
  return lines;
}

function countLines(value: string): number {
  return splitLines(value).length;
}

/** The hunk header an Edit produces: both sides start at the same file line. */
function editHunkHeader(
  startLineNumber: number,
  oldContent: string,
  newContent: string,
): string {
  return `@@ -${startLineNumber},${countLines(oldContent)} +${startLineNumber},${countLines(newContent)} @@`;
}

function writeHunkHeader(content: string): string {
  return `@@ -0,0 +1,${countLines(content)} @@`;
}

function buildLines(block: ToolBlock, edit: ParsedEdit): DiffLine[] {
  const lines: DiffLine[] = [
    {
      kind: "hunk",
      text:
        block.name === WRITE_TOOL_NAME
          ? writeHunkHeader(edit.newContent)
          : editHunkHeader(
              edit.startLineNumber ?? 1,
              edit.oldContent,
              edit.newContent,
            ),
    },
  ];
  for (const part of diffLines(edit.oldContent, edit.newContent)) {
    const kind: DiffLineKind = part.added
      ? "add"
      : part.removed
        ? "remove"
        : "context";
    for (const text of splitLines(part.value)) {
      lines.push({ kind, text });
    }
  }
  return lines;
}

interface ParsedEdit {
  path: string;
  oldContent: string;
  newContent: string;
  startLineNumber?: number;
}

function parseParameters(parameters: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(parameters);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The file edit a tool block stands for, or null when it is not one: a
 * different tool, an unfinished call, a failed one, or unreadable parameters.
 */
function editFromBlock(block: ToolBlock): ParsedEdit | null {
  if (!block.name || !block.parameters) return null;
  if (block.name !== EDIT_TOOL_NAME && block.name !== WRITE_TOOL_NAME) {
    return null;
  }
  if (block.stage !== "end" || block.success === false) return null;

  const params = parseParameters(block.parameters);
  if (!params) return null;

  if (block.name === WRITE_TOOL_NAME) {
    const write = params as unknown as WriteToolParameters;
    if (
      typeof write.file_path !== "string" ||
      typeof write.content !== "string"
    ) {
      return null;
    }
    // A Write has no previous content to compare against: the parameters carry
    // the new content only, so the file renders as pure additions (same
    // rendering `DiffDisplay` gives a Write block).
    return { path: write.file_path, oldContent: "", newContent: write.content };
  }

  const edit = params as unknown as EditToolParameters;
  if (
    typeof edit.file_path !== "string" ||
    typeof edit.old_string !== "string" ||
    typeof edit.new_string !== "string"
  ) {
    return null;
  }
  return {
    path: edit.file_path,
    oldContent: edit.old_string,
    newContent: edit.new_string,
    startLineNumber: block.startLineNumber,
  };
}

/** Repo-relative display path; absolute paths outside `workdir` are kept as-is. */
function displayPath(filePath: string, workdir?: string): string {
  if (!workdir || !isAbsolute(filePath)) return filePath;
  const rel = relative(workdir, filePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return filePath;
  return rel.split("\\").join("/");
}

function promptPreview(message: Message): string {
  const text = message.blocks
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.content : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= PROMPT_PREVIEW_MAX) return text;
  return text.slice(0, PROMPT_PREVIEW_MAX - 1) + "…";
}

function countKinds(lines: DiffLine[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === "add") additions++;
    else if (line.kind === "remove") deletions++;
  }
  return { additions, deletions };
}

/**
 * One entry per user prompt that changed at least one file, most recent first.
 *
 * A turn starts at a user message and collects the Edit/Write blocks of every
 * assistant message after it; the same file edited twice in one turn appends
 * both hunks, the way Claude Code accumulates a turn's patches.
 */
export function collectTurnDiffs(
  messages: Message[],
  workdir?: string,
): SessionTurnDiff[] {
  const turns: SessionTurnDiff[] = [];
  let current: SessionTurnDiff | null = null;
  let files: Map<string, DiffFileEntry> | null = null;
  let turnIndex = 0;

  const flush = () => {
    if (current && current.files.length > 0) turns.push(current);
  };

  for (const message of messages) {
    if (message.isMeta) continue;

    if (message.role === "user") {
      flush();
      turnIndex++;
      current = {
        turnIndex,
        promptPreview: promptPreview(message),
        files: [],
      };
      files = new Map();
      current.files = [];
      continue;
    }

    if (!files) continue;

    for (const block of message.blocks) {
      if (block.type !== "tool") continue;
      const edit = editFromBlock(block);
      if (!edit) continue;

      const path = displayPath(edit.path, workdir);
      let entry = files.get(path);
      if (!entry) {
        entry = { path, additions: 0, deletions: 0, lines: [] };
        files.set(path, entry);
        current?.files.push(entry);
      }
      const lines = buildLines(block, edit);
      entry.lines.push(...lines);
      const { additions, deletions } = countKinds(lines);
      entry.additions += additions;
      entry.deletions += deletions;
    }
  }

  flush();
  return turns.reverse();
}
