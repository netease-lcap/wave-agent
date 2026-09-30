/**
 * The on-demand tool pool, announced in the conversation instead of inside
 * `Exec`'s tool description.
 *
 * Why it cannot live in the description: `tools[]` sits in the cached prefix, and
 * the pool is a function of the session's servers and configuration. Every server
 * that connects, drops or changes its `tools/list` would rewrite the declaration
 * and take the whole cached prefix with it. The description is a pool-independent
 * constant now; the list is appended at the tail, where an addition invalidates
 * nothing that already went out.
 *
 * The announcement carries names and nothing else, and that is a correctness
 * constraint rather than a size one: names make the body a pure function of the
 * pool. Prose that describes *how* the pool got here — a delta, a "the following
 * are new" preamble — depends on the history, and a history-dependent body can
 * never compare equal to a freshly rendered one, so the session would re-announce
 * on every single turn. Names also happen to be all the model needs in order to
 * ask for one: `search` hands back the signature.
 *
 * State lives in the history, not in the process (same rule as
 * `utils/mcpInstructions.ts`): each announcement leads with a marker line carrying
 * the hash of the body. The marker is therefore an *interface* to the state, not a
 * copy of it — "did the model read this exact list, and is that list still
 * current" is answerable with nothing remembered between turns. Two consequences,
 * both deliberate:
 *  - Once the marker is gone (compaction, rewind), the next turn announces the
 *    full list again. A duplicate is better than a loss.
 *  - The hash covers rendered text, so editing the renderer re-announces the list
 *    once for existing sessions. That is what buys the invariant "same hash ⇒ the
 *    same bytes the model read".
 */

import { createHash } from "node:crypto";
import type { Message } from "../types/messaging.js";
import { EXEC_SEARCH_EXPRESSION } from "./catalog.js";

/** Marks an announcement so the history scan can find it. */
export const EXEC_CATALOG_MARKER_PREFIX = "<!-- exec-catalog ";
export const EXEC_CATALOG_MARKER_SUFFIX = " -->";

/** Which body a marker leads. */
type ExecCatalogAnnouncementKind = "full" | "removed";

/**
 * A marker's payload: what a later turn needs to *compare* against, never the
 * body itself. The body is the message the marker leads.
 */
export interface ExecCatalogMarker {
  kind: ExecCatalogAnnouncementKind;
  /** Hash of the announcement body as of this announcement. */
  hash?: string;
}

/** The wire shape. Short keys: the marker rides in every announcement. */
interface MarkerPayload {
  k?: unknown;
  h?: unknown;
}

/**
 * Opens the list of names; the names follow, one per line.
 *
 * "No other tool name" rather than "no other name": the search entry below is
 * reachable as `tools.<name>` too, and it is the one thing on that object that is
 * not a tool from the pool.
 */
const POOL_HEADER =
  "Tools reachable inside a sandbox script as `tools.<name>` (no other tool name resolves):";

/**
 * How the model gets from a name to a call. The signatures are deliberately not
 * listed here — `search` is the only place a schema appears, so the two can never
 * disagree about a parameter.
 */
const SEARCH_POINTER = `Call \`${EXEC_SEARCH_EXPRESSION}(...)\` for any of their parameters and return types.`;

/**
 * What the model is told when the channel closes: `Exec` was switched off,
 * excluded, or denied, or the pool emptied, so the calling form no longer exists
 * and the flat declarations are back. The listed tools are not gone — the way they
 * were listed is.
 *
 * This text is only ever reached by a session that already read a list, which is
 * why it says "an earlier list" rather than introducing the concept.
 */
const REMOVED_NOTE =
  "The on-demand tool list is no longer available, so the tools an earlier list named cannot be called this way any more. The tool declarations of this session are the current source of truth.";

/**
 * The announcement body for a non-empty pool: a header, one line per name, and how
 * to get a signature.
 *
 * Names are sorted rather than listed in pool order, which makes the body — and so
 * the hash — a function of the *set* of names. Pool order is "registry order then
 * whatever order the MCP servers connected in", which is not something a turn's
 * hash should depend on; without the sort, two sessions with the same tools could
 * disagree about whether anything changed.
 *
 * No count, no grouping, no truncation. A count would be derivable from the list;
 * a grouping would have to key off the name (which is wrong for built-ins, whose
 * names carry no server segment); and a truncated list is the one thing that must
 * not happen here — a tool missing from the list is indistinguishable from a tool
 * that does not exist, and the model has no second source to check against.
 */
export function renderPoolNote(names: readonly string[]): string {
  return [
    POOL_HEADER,
    ...[...names].sort().map((name) => `- \`${name}\``),
    SEARCH_POINTER,
  ].join("\n");
}

/** `h` in the marker payload. */
function hashNote(note: string): string {
  return createHash("sha256").update(note).digest("hex").slice(0, 12);
}

/** `{ k, h }` — the marker, as one line. */
function renderMarker(marker: ExecCatalogMarker): string {
  const payload: MarkerPayload = { k: marker.kind };
  if (marker.hash !== undefined) payload.h = marker.hash;
  return `${EXEC_CATALOG_MARKER_PREFIX}${JSON.stringify(payload)}${EXEC_CATALOG_MARKER_SUFFIX}`;
}

/**
 * Read the last announcement out of the history, or null when there is none.
 *
 * Scanned from the tail and stopped at the first hit: the answer is the newest
 * marker, and this runs on every turn against a history that only grows.
 *
 * Only this module's own messages are read: a marker quoted anywhere else — a
 * reply explaining the mechanism, a hook echoing one — is prose *about* a marker,
 * not a statement about the pool. Counting it would invent an announcement, and
 * the invented state then misleads every later turn. A marker that cannot be
 * parsed is skipped for the same reason (worst case: one duplicate
 * announcement).
 */
export function collectExecCatalogState(
  messages: Message[],
): ExecCatalogMarker | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.isMeta !== true) continue;
    for (const block of message.blocks) {
      if (block.type !== "text") continue;
      if (!block.content.includes(EXEC_CATALOG_MARKER_PREFIX)) continue;
      for (const line of block.content.split("\n")) {
        const marker = parseMarkerLine(line);
        if (marker) return marker;
      }
    }
  }

  return null;
}

function parseMarkerLine(line: string): ExecCatalogMarker | null {
  const trimmed = line.trim();
  if (
    !trimmed.startsWith(EXEC_CATALOG_MARKER_PREFIX) ||
    !trimmed.endsWith(EXEC_CATALOG_MARKER_SUFFIX)
  ) {
    return null;
  }
  const payload = trimmed.slice(
    EXEC_CATALOG_MARKER_PREFIX.length,
    trimmed.length - EXEC_CATALOG_MARKER_SUFFIX.length,
  );
  try {
    const parsed = JSON.parse(payload) as MarkerPayload;
    const kind = parsed.k;
    if (kind !== "full" && kind !== "removed") return null;
    return {
      kind,
      hash: typeof parsed.h === "string" ? parsed.h : undefined,
    };
  } catch {
    // A marker we cannot read (hand-edited or truncated history) must not take the
    // turn down; the worst case is announcing the list once more.
    return null;
  }
}

/**
 * The next announcement for this turn, or null when there is nothing to say.
 *
 * The decision table, in order:
 *  - the channel is closed (no pool to announce) → silence if nothing was ever
 *    announced or the closure is already on record, else the closing notice;
 *  - nothing announced yet → the full list;
 *  - the last word was the closing notice → the full list (the channel is not a
 *    list, so there is nothing to compare; going by content would leave a session
 *    mute forever after a switch was flipped off and back on);
 *  - the same hash → silence;
 *  - anything else → the full list.
 *
 * There is no delta, and the reason is arithmetic rather than taste: the body *is*
 * the name list, so a delta would have to carry the previously-announced set
 * somewhere in order to describe a change to it, and that set is the same size as
 * the list it replaces. Nothing is saved and a second state to keep in sync is
 * gained.
 *
 * `pool` is the deferred tool names, or `undefined` when the channel is closed —
 * which includes "the pool rendered empty", because an empty pool means no
 * `Exec` declaration either (see `renderPoolNote`'s caller).
 */
export function buildExecCatalogAnnouncement(
  last: ExecCatalogMarker | null,
  pool: readonly string[] | undefined,
): string | null {
  if (pool === undefined || pool.length === 0) {
    // Nothing was ever announced, so there is nothing to retract: most sessions
    // have no `Exec` at all, and a closing notice there would be a message about
    // a channel the model never saw. Silence, not "observed absence".
    if (last === null || last.kind === "removed") return null;
    return envelope({ kind: "removed" }, REMOVED_NOTE);
  }

  const note = renderPoolNote(pool);
  const hash = hashNote(note);
  if (last !== null && last.kind === "full" && last.hash === hash) return null;

  return envelope({ kind: "full", hash }, note);
}

function envelope(marker: ExecCatalogMarker, body: string): string {
  return `${renderMarker(marker)}\n${body}`;
}
