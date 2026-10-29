/**
 * Reserved (non-message) entry types found in a session JSONL file.
 *
 * A session file is an append-only log of messages plus a few reserved
 * bookkeeping entries: the `metadata` header written once at creation, and a
 * `custom-title` entry appended on every rename. Every reader must skip all of
 * them — a reserved entry parsed as a message yields `lastActiveAt: Invalid
 * Date`, corrupts the token scan, or surfaces in the conversation.
 *
 * Lives in its own dependency-free module because the writer
 * (`jsonlHandler.ts`) and the whole-file reader (`session.ts`) both need it,
 * and the session tests mock `jsonlHandler` wholesale.
 *
 * Add a new file-level entry type here when adding one.
 */
import type { Message } from "../types/messaging.js";
import { forEachLine } from "../utils/fileUtils.js";

const RESERVED_ENTRY_TYPES = new Set(["metadata", "custom-title"]);

/** True when a parsed JSONL line is a reserved (non-message) entry. */
export function isReservedEntry(type: string | undefined): boolean {
  return type !== undefined && RESERVED_ENTRY_TYPES.has(type);
}

/**
 * One parsed transcript line. The three readers (whole file, tail window,
 * paged) all classify a line the same way, so the rules live here once:
 *
 * - `custom-title` — a rename entry; only its title is of interest, and an
 *   empty title is dropped (never a message).
 * - `reserved` — the metadata header or any other non-message entry.
 * - `message` — anything carrying a `timestamp`. Entries without one are not
 *   messages (the metadata header relies on exactly that).
 *
 * Throws on malformed JSON. Whether a bad line is tolerable depends on where
 * it sits — a partial line at the end of a file that does not end with a
 * newline is the residue of an interrupted append — so the callers decide.
 */
export type ParsedTranscriptLine =
  | { kind: "custom-title"; customTitle: string }
  | { kind: "reserved" }
  | { kind: "message"; message: Message };

export function parseTranscriptLine(line: string): ParsedTranscriptLine {
  const parsed = JSON.parse(line) as Message & {
    type?: string;
    customTitle?: unknown;
  };
  if (parsed.type === "custom-title") {
    return typeof parsed.customTitle === "string" && parsed.customTitle
      ? { kind: "custom-title", customTitle: parsed.customTitle }
      : { kind: "reserved" };
  }
  if (isReservedEntry(parsed.type)) return { kind: "reserved" };
  if (!parsed.timestamp) return { kind: "reserved" };
  return { kind: "message", message: parsed };
}

/**
 * 正读扫描转录：逐行分类后交给 `onEntry`，顺手替调用方守住两条行规则——
 * 空行跳过；坏行只在「文件不以换行结尾 + 正好是最后一行」时容忍（被中断的
 * append 残留），其它位置照旧抛 `Invalid JSON at line N`（N 是非空行序号，从
 * 1 起数）。
 *
 * 「一次性读」的几个调用方（整份读、检查点投影）共用它，行规则只写一处。
 * 它只负责喂行，攒不攒、攒多少由调用方决定——这正是这条路径能一边扫一边丢的
 * 原因。
 */
export async function forEachTranscriptEntry(
  filePath: string,
  onEntry: (entry: ParsedTranscriptLine) => void,
): Promise<void> {
  let nonEmptyLine = 0;
  let brokenLine: { line: number; error: unknown } | undefined;
  const { endsWithNewline } = await forEachLine(filePath, (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    nonEmptyLine++;
    let parsed: ParsedTranscriptLine;
    try {
      parsed = parseTranscriptLine(trimmed);
    } catch (error) {
      // 只留第一条坏行：后面的报错信息要指向真正出错的位置。
      if (brokenLine) {
        throw new Error(
          `Invalid JSON at line ${brokenLine.line}: ${brokenLine.error}`,
        );
      }
      brokenLine = { line: nonEmptyLine, error };
      return;
    }
    if (brokenLine) {
      throw new Error(
        `Invalid JSON at line ${brokenLine.line}: ${brokenLine.error}`,
      );
    }
    onEntry(parsed);
  });
  // 坏行之后没有好行可对照：文件本身以换行结尾，说明这不是被中断的 append。
  if (brokenLine && endsWithNewline) {
    throw new Error(
      `Invalid JSON at line ${brokenLine.line}: ${brokenLine.error}`,
    );
  }
}

/**
 * 扫一遍转录里的消息（跳过保留条目），并给出每条消息在**完整线程**里的位置，
 * 从 0 起——与 `getFullMessageThread()` 返回数组的下标同义，所以能直接喂给
 * `truncateHistory(index)`。
 *
 * 不攒消息：调用方要什么就当场投影成什么，扫描期间的峰值只与投影本身有关。
 */
export async function scanTranscriptMessages(
  filePath: string,
  onMessage: (message: Message, index: number) => void,
): Promise<void> {
  let index = 0;
  await forEachTranscriptEntry(filePath, (entry) => {
    if (entry.kind !== "message") return;
    onMessage(entry.message, index++);
  });
}
