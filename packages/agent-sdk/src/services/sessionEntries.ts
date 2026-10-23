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
