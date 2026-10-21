/**
 * Conversation file list (spec: 文件展示优化).
 *
 * The desktop file panel used to open empty: it could only show the single file
 * a user had clicked. It now lists "this conversation's files" on its own, so
 * the question "which files has this conversation touched" is answered here.
 *
 * Derived from the message stream rather than asked of the host: the agent's
 * file tools already record every file it read or wrote, the panel auto-refresh
 * (`fileAutoRefresh.ts`) parses those blocks the same way, and a derived list
 * keeps the panel working on remote sessions and on every host with no extra
 * RPC. Pure and unit-tested on purpose — the ordering and dedupe rules are the
 * whole contract.
 *
 * Artifacts are deliberately absent: an artifact is a URL, not a file with a
 * folder, so it has no place in a file list (the panel offers no reveal/open
 * -with actions for it). A published `.html` still shows up here as the plain
 * file the agent wrote.
 */

import {
  EDIT_TOOL_NAME,
  READ_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "wave-agent-sdk/constants";
import type { Message } from "../types";
import { extractToolTargetPath } from "./fileAutoRefresh";
import { toAbsoluteFilePath, toRelativePath } from "./messageUtils";

/** One file this conversation touched. */
export interface ConversationFileEntry {
  /**
   * Workdir-resolved absolute path — the dedupe key, and what the panel would
   * hand to a host that needs an absolute path.
   */
  absolutePath: string;
  /** Path as the tool wrote it: what `openFile` is given (hosts resolve it). */
  path: string;
  /**
   * The list row's label: the file name, or the relative path when two files
   * share a name (otherwise two rows would read identically).
   */
  name: string;
  /** Workdir-relative display path (falls back to the absolute path). */
  displayPath: string;
}

/** The tools whose target file belongs in "this conversation's files". */
const FILE_TOOLS: ReadonlySet<string> = new Set([
  READ_TOOL_NAME,
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
]);

const basename = (p: string): string => {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
};

/**
 * This conversation's files, most recently touched first.
 *
 * A block counts once it finished successfully (`stage === "end"` with no
 * error) — a call that is still streaming, or that failed (a Read of a missing
 * path, a rejected Edit), never puts a file in the list. A file hit several
 * times keeps one entry, moved to the front by its latest hit.
 */
export const collectConversationFiles = (
  messages: Message[],
  workdir?: string,
): ConversationFileEntry[] => {
  // Insertion order doubles as recency order: re-inserting on every hit keeps
  // the last hit last, so the final reverse() reads "newest first".
  const byPath = new Map<string, ConversationFileEntry>();

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== "tool") continue;
      if (!block.name || !FILE_TOOLS.has(block.name)) continue;
      if (block.stage !== "end" || block.success === false) continue;
      const path = extractToolTargetPath(block);
      if (!path) continue;
      // Without a workdir a relative path cannot be resolved; it is then its
      // own key and its own display path (same fallback as the click path).
      const absolutePath = toAbsoluteFilePath(path, workdir) ?? path;
      byPath.delete(absolutePath);
      byPath.set(absolutePath, {
        absolutePath,
        path,
        name: basename(path),
        displayPath: toRelativePath(absolutePath, workdir),
      });
    }
  }

  const files = Array.from(byPath.values()).reverse();

  // Same file name from different folders: fall back to the relative path for
  // every member of that name group, so no two rows look identical.
  const nameCounts = new Map<string, number>();
  for (const file of files) {
    nameCounts.set(file.name, (nameCounts.get(file.name) ?? 0) + 1);
  }
  for (const file of files) {
    if ((nameCounts.get(file.name) ?? 0) > 1) file.name = file.displayPath;
  }

  return files;
};
