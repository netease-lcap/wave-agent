/**
 * Reserved (non-message) entry types found in a session JSONL file.
 *
 * A session file is an append-only log of messages plus a few reserved
 * bookkeeping entries: the `metadata` header written once at creation, and a
 * `custom-title` entry appended on every rename. Every reader must skip all of
 * them — a reserved entry parsed as a message yields `lastActiveAt: Invalid
 * Date`, corrupts the token scan, or surfaces in the conversation.
 *
 * Lives in its own dependency-free module because both the writer
 * (`jsonlHandler.ts`) and the reader (`session.ts`) need it, and the session
 * tests mock `jsonlHandler` wholesale.
 *
 * Add a new file-level entry type here when adding one.
 */
const RESERVED_ENTRY_TYPES = new Set(["metadata", "custom-title"]);

/** True when a parsed JSONL line is a reserved (non-message) entry. */
export function isReservedEntry(type: string | undefined): boolean {
  return type !== undefined && RESERVED_ENTRY_TYPES.has(type);
}
