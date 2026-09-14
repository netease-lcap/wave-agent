/**
 * External file-change detection for the main agent loop (aligned with Claude
 * Code's `changed_files` attachment).
 *
 * For every file recorded in the session read state by a *full* read/write,
 * this compares the on-disk mtime against the mtime recorded at read time and,
 * when the file is newer AND the content actually differs, produces a short
 * changed-lines summary. The read state entry is then refreshed to the new
 * mtime/hash/content so that (a) the same change is reported only once, and
 * (b) a subsequent Edit/Write passes the staleness check — the agent has just
 * been told the new content.
 *
 * The writers this surfaces are the ones other than the main agent: the
 * auto-memory extraction fork, an external editor, another session. The main
 * agent's own Write/Edit refresh the read state on write, so they never show up
 * here.
 */
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ReadFileState } from "../tools/types.js";

/** Max number of changed files reported in a single reminder. */
export const CHANGED_FILES_MAX_FILES = 10;
/** Max bytes of the changed-lines snippet rendered for a single file. */
export const CHANGED_FILES_SNIPPET_MAX_BYTES = 2048;
/** Max bytes of the whole reminder (all reported files combined). */
export const CHANGED_FILES_TOTAL_MAX_BYTES = 8192;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** UTF-8 byte length — CJK content is ~3 bytes/char, so `.length` would under-count. */
function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

/**
 * Build a compact "what changed" snippet from the new file content: trim the
 * common prefix/suffix, then render the differing region with line numbers.
 * A deletion-only region renders as a removal note. Truncates at a line
 * boundary to `maxBytes`. Returns "" when the contents are identical.
 */
export function buildChangedSnippet(
  oldContent: string,
  newContent: string,
  maxBytes: number = CHANGED_FILES_SNIPPET_MAX_BYTES,
): string {
  const oldLines = oldContent.replace(/\r\n/g, "\n").split("\n");
  const newLines = newContent.replace(/\r\n/g, "\n").split("\n");

  const shared = Math.min(oldLines.length, newLines.length);
  let prefix = 0;
  while (prefix < shared && oldLines[prefix] === newLines[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = shared - prefix;
  while (
    suffix < maxSuffix &&
    oldLines[oldLines.length - 1 - suffix] ===
      newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const changedOld = oldLines.slice(prefix, oldLines.length - suffix);
  const changedNew = newLines.slice(prefix, newLines.length - suffix);
  if (changedOld.length === 0 && changedNew.length === 0) return "";

  if (changedNew.length === 0) {
    const plural = changedOld.length === 1 ? "line" : "lines";
    return `(${changedOld.length} ${plural} removed at line ${prefix + 1})`;
  }

  const rendered: string[] = [];
  let used = 0;
  let truncated = 0;
  for (let i = 0; i < changedNew.length; i++) {
    const line = `${String(prefix + i + 1).padStart(4, " ")} | ${changedNew[i]}`;
    const cost = byteLength(line) + 1; // + trailing newline
    if (used + cost > maxBytes) {
      truncated = changedNew.length - i;
      break;
    }
    rendered.push(line);
    used += cost;
  }

  let snippet = rendered.join("\n");
  if (truncated > 0) {
    snippet += `\n... [${truncated} lines truncated] ...`;
  }
  return snippet;
}

/**
 * Detect files that changed on disk since they were read and return a reminder
 * body for the agent, or null when nothing changed. Refreshes the read state
 * for every detected change (see the module comment).
 */
export async function getChangedFilesReminder(
  readFileState: ReadFileState | undefined,
): Promise<string | null> {
  if (!readFileState || readFileState.size === 0) return null;

  const blocks: string[] = [];
  let totalBytes = 0;

  for (const [filePath, state] of readFileState) {
    if (blocks.length >= CHANGED_FILES_MAX_FILES) break;
    // Partial reads cache only a slice — no reliable diff baseline.
    if (state.offset !== undefined || state.limit !== undefined) continue;

    let mtimeMs: number;
    let newContent: string;
    try {
      const stats = await stat(filePath);
      mtimeMs = stats.mtime.getTime();
      // Not newer than the recorded mtime → untouched, or touched by the main
      // agent's own Write/Edit (which refreshes the entry to the post-write mtime).
      if (mtimeMs <= state.mtime) continue;
      newContent = await readFile(filePath, "utf-8");
    } catch {
      // Deleted or transiently unreadable — leave the entry alone and move on.
      continue;
    }

    // Refresh the baseline so the same observation is not re-processed on every
    // turn and a subsequent Edit passes the staleness check (the agent has just
    // been told the new content).
    const refresh = () => {
      readFileState.set(filePath, {
        mtime: mtimeMs,
        hash: sha256(newContent),
        source: "changed",
        content: newContent,
        offset: undefined,
        limit: undefined,
      });
    };

    const oldContent = state.content;
    // No baseline, or the file was touched but its content is unchanged
    // (git checkout / editor round-trip save / cloud sync / antivirus).
    if (oldContent === undefined || oldContent === newContent) {
      refresh();
      continue;
    }

    const snippet = buildChangedSnippet(oldContent, newContent);
    if (!snippet) {
      refresh();
      continue;
    }

    const block = `${filePath}\n${snippet}`;
    if (totalBytes + byteLength(block) > CHANGED_FILES_TOTAL_MAX_BYTES) {
      // Leave the entry un-refreshed so the change is reported on a later turn
      // rather than silently dropped.
      break;
    }

    refresh();
    blocks.push(block);
    totalBytes += byteLength(block);
  }

  if (blocks.length === 0) return null;

  return [
    "The following files were modified on disk since you last read them — by another process such as a background agent, an external editor, or another session. Your earlier read of these files is out of date; re-read a file before editing it if the changed lines below are not enough.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}
