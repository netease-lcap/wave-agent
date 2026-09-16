/**
 * The MCP catalog, announced in the conversation instead of the `Exec` tool
 * description. opencode only made this move on its v2 line (v1 shipped the catalog
 * inside `execute`'s description, which is what this repo did until now).
 *
 * Why it cannot stay in the description: `tools[]` sits inside the cached prefix,
 * and the catalog is a function of the pool. Every server that connects, drops, or
 * changes its `tools/list` would rewrite the declaration and take the whole cached
 * prefix with it. The description is a pool-independent constant now; the catalog is
 * appended at the tail, where an addition invalidates nothing that already went out.
 *
 * State lives in the history, not in the process (same rule as
 * `utils/mcpInstructions.ts`): each announcement leads with a marker line carrying
 * the hash of a full catalog body. Three consequences, all deliberate:
 *  - Once the marker is gone (compaction, rewind), the next turn announces the full
 *    catalog again. A duplicate is better than a loss.
 *  - A delta is only emitted while the full catalog it is relative to is still in
 *    the history. The marker carries that baseline's hash (`bh`) so the check stays
 *    local: a delta is relative, and without its basis it says nothing.
 *  - The hash covers rendered text, so editing the renderer re-announces the catalog
 *    once for existing sessions. That is what buys the invariant "same hash ⇒ the
 *    same bytes the model read". It is also why a full catalog carries no "this
 *    supersedes the previous one" preamble: such a line would depend on history, and
 *    a history-dependent body can never compare equal to a freshly rendered one —
 *    the session would re-announce on every single turn.
 */

import { createHash } from "node:crypto";
import type { Message } from "../types/messaging.js";
import { renderSearchSignature } from "./catalog.js";
import type { RenderedCatalog } from "./catalog.js";

/** Marks an announcement so the history scan can find it. */
export const EXEC_CATALOG_MARKER_PREFIX = "<!-- exec-catalog ";
export const EXEC_CATALOG_MARKER_SUFFIX = " -->";

/** Which body a marker leads. */
type ExecCatalogAnnouncementKind = "full" | "delta" | "removed";

/**
 * A marker's payload: what a later turn needs to *compare* against, never the body
 * itself. The body is the message the marker leads.
 */
export interface ExecCatalogMarker {
  kind: ExecCatalogAnnouncementKind;
  /**
   * Hash of the full catalog body as of this announcement — for a delta too, where
   * it is the hash of what a full catalog would say right now. That is what lets the
   * next turn (whose pool has not moved on since) recognise the delta as current and
   * stay silent.
   */
  hash?: string;
  /** 1 when the catalog was truncated at that moment. */
  truncated?: number;
  /** Namespace → how many tools it held. The only material a delta can be built from. */
  namespaces?: Record<string, number>;
  /** Delta only: the hash of the full catalog this delta is relative to. */
  base?: string;
}

/** What the history says: its last announcement, and every full catalog hash in it. */
export interface ExecCatalogState {
  last: ExecCatalogMarker | null;
  fullHashes: Set<string>;
}

/** The wire shape. Short keys: the marker rides in every announcement. */
interface MarkerPayload {
  k?: unknown;
  h?: unknown;
  t?: unknown;
  ns?: unknown;
  bh?: unknown;
}

/** Opens a full catalog body; the entries follow. */
const CATALOG_HEADER =
  "MCP tools reachable inside a sandbox script, called as `tools.<name>` (no other name resolves):";

/**
 * What the model is told when a pool it has seen empties. It names no tool on purpose:
 * with an empty pool `Exec` is not even declared, so naming it would point at something
 * the model cannot call.
 *
 * This text is only ever reached by a session that already read a catalog, which is why
 * it says "updates may add or remove tools" rather than introducing the concept: to a
 * session that never had one, "no MCP tools are available" describes a capability it had
 * no reason to expect (see the `last === null` branch).
 */
const EMPTY_POOL_NOTE =
  "No MCP tools are currently available. Later catalog updates may add or remove tools.";

/**
 * What the model is told when the channel closes: `Exec` was switched off, excluded
 * or denied, so the catalog's calling form no longer exists and the flat
 * declarations are back. The listed tools are not gone — the way they were listed is.
 */
const REMOVED_NOTE =
  "The MCP tool catalog is no longer available, so the tools an earlier catalog listed cannot be called this way any more. The tool declarations of this session are the current source of truth.";

const DELTA_HEADER = "The MCP tool catalog has changed:";

/**
 * A full catalog body: the header, the rendered entries, and — only when the budget
 * truncated them — how to reach the rest.
 *
 * The search section is the single place the call form is taught (the entry point
 * stays registered either way, it is merely not advertised). Making it conditional
 * is what keeps the two statements from drifting: while the catalog is complete,
 * nothing anywhere claims a search is needed.
 */
export function renderFullCatalogNote(catalog: RenderedCatalog): string {
  if (catalog.total === 0) return EMPTY_POOL_NOTE;

  const parts = [CATALOG_HEADER, catalog.text];
  if (catalog.truncated) {
    parts.push(
      "",
      "The catalog above is partial. Call this to list or search the complete pool:",
      "",
      ...renderSearchSignature()
        .split("\n")
        .map((line) => `  ${line}`),
    );
  }
  return parts.join("\n");
}

/** `h` in the marker payload, and the value `bh` points back at. */
function hashNote(note: string): string {
  return createHash("sha256").update(note).digest("hex").slice(0, 12);
}

/** `{ k, h, t, ns, bh }` — the marker, as one line. */
function renderMarker(marker: ExecCatalogMarker): string {
  const payload: MarkerPayload = { k: marker.kind };
  if (marker.hash !== undefined) payload.h = marker.hash;
  if (marker.truncated !== undefined) payload.t = marker.truncated;
  if (marker.namespaces !== undefined) payload.ns = marker.namespaces;
  if (marker.base !== undefined) payload.bh = marker.base;
  return `${EXEC_CATALOG_MARKER_PREFIX}${JSON.stringify(payload)}${EXEC_CATALOG_MARKER_SUFFIX}`;
}

/**
 * Read the announcement state out of the history.
 *
 * Only this module's own messages are read: a marker quoted anywhere else — a reply
 * explaining the mechanism, a hook echoing one — is prose *about* a marker, not a
 * statement about the pool. Counting it would invent an announcement, and the
 * invented state then misleads every later turn. A marker that cannot be parsed is
 * skipped for the same reason (worst case: one duplicate announcement).
 */
export function collectExecCatalogState(messages: Message[]): ExecCatalogState {
  const fullHashes = new Set<string>();
  let last: ExecCatalogMarker | null = null;

  for (const message of messages) {
    if (message.isMeta !== true) continue;
    for (const block of message.blocks) {
      if (block.type !== "text") continue;
      for (const line of block.content.split("\n")) {
        const marker = parseMarkerLine(line);
        if (!marker) continue;
        last = marker;
        if (marker.kind === "full" && marker.hash) fullHashes.add(marker.hash);
      }
    }
  }

  return { last, fullHashes };
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
    if (kind !== "full" && kind !== "delta" && kind !== "removed") return null;
    return {
      kind,
      hash: typeof parsed.h === "string" ? parsed.h : undefined,
      truncated: parsed.t === 1 ? 1 : 0,
      namespaces: readNamespaceCounts(parsed.ns),
      base: typeof parsed.bh === "string" ? parsed.bh : undefined,
    };
  } catch {
    // A marker we cannot read (hand-edited or truncated history) must not take the
    // turn down; the worst case is announcing the catalog once more.
    return null;
  }
}

function readNamespaceCounts(
  value: unknown,
): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const counts: Record<string, number> = {};
  for (const [name, count] of Object.entries(value)) {
    if (typeof count !== "number" || !Number.isFinite(count)) return undefined;
    counts[name] = count;
  }
  return counts;
}

/**
 * The next announcement for this turn, or null when there is nothing to say.
 *
 * The decision table, in order: a channel that was never open says nothing; a closed
 * channel is announced once; a session that has announced nothing (or whose last word
 * was the closing notice) gets the full catalog; an unchanged hash says nothing; a
 * changed pool with its basis still present may go out as a namespace-level delta;
 * anything else is the full catalog.
 */
export function buildExecCatalogAnnouncement(
  state: ExecCatalogState,
  current: RenderedCatalog | undefined,
): string | null {
  const last = state.last;

  if (current === undefined) {
    // Nothing was ever announced, so there is nothing to retract: most sessions have
    // no `Exec` at all, and a closing notice there would be a message about a channel
    // the model never saw. Silence, not "observed absence".
    if (last === null) return null;
    // `removed` carries no hash: the channel is not a catalog, so there is nothing
    // to compare. Re-opening it therefore always re-announces in full, even when the
    // pool never moved — going by content here would leave the session mute forever
    // after a switch was flipped off and back on.
    if (last.kind === "removed") return null;
    return envelope({ kind: "removed" }, REMOVED_NOTE);
  }

  const note = renderFullCatalogNote(current);
  const hash = hashNote(note);
  const namespaces = namespaceCounts(current);
  const full: ExecCatalogMarker = {
    kind: "full",
    hash,
    truncated: current.truncated ? 1 : 0,
    namespaces,
  };

  if (last === null) {
    // A session that never had a catalog has nothing to learn from "there is nothing":
    // with an empty pool `Exec` is not even declared, so the note points at no tool the
    // model can see or call. It is announced only to a session that has already seen a
    // catalog, where "the catalog is now empty" is a change rather than a first word.
    return current.total === 0 ? null : envelope(full, note);
  }

  if (last.kind === "removed") return envelope(full, note);

  if (last.hash === hash) {
    // The pool renders identically, so an unchanged turn stays silent — unless the
    // last word was a delta whose basis has since been compacted away: nothing the
    // model can still see describes the catalog then, so it is re-announced in full.
    if (last.kind === "delta" && !hasBasis(last, state)) {
      return envelope(full, note);
    }
    return null;
  }

  if (!hasBasis(last, state)) return envelope(full, note);

  const changed = chooseChangedAnnouncement(
    last,
    current,
    note,
    namespaces,
    hash,
  );
  return changed;
}

/**
 * Is the full catalog a delta would be relative to still in the history? For a
 * `full` last word that is the message itself; for a delta it is the anchor it
 * passed along its chain.
 */
function hasBasis(last: ExecCatalogMarker, state: ExecCatalogState): boolean {
  const anchor = last.kind === "full" ? last.hash : last.base;
  return anchor !== undefined && state.fullHashes.has(anchor);
}

/**
 * Delta or full catalog, for a pool that changed while the basis is still present.
 *
 * Namespace counts are all a marker carries, so a delta can only say "this server
 * appeared / changed size / went away" — never a signature. That is enough only
 * while the catalog is truncated (the model already has the entries it can see) and
 * only when some count actually moved. Otherwise the entries themselves are what
 * changed, and only the full catalog can say how.
 */
function chooseChangedAnnouncement(
  last: ExecCatalogMarker,
  current: RenderedCatalog,
  note: string,
  namespaces: Record<string, number>,
  hash: string,
): string {
  const full: ExecCatalogMarker = {
    kind: "full",
    hash,
    truncated: current.truncated ? 1 : 0,
    namespaces,
  };
  const truncated = current.truncated ? 1 : 0;

  if (last.truncated !== truncated || !current.truncated) {
    return envelope(full, note);
  }

  const delta = renderDeltaNote(last, current);
  // A delta is a means, not an end: when it is no longer the shorter of the two
  // (a wholesale server swap, say) the full catalog wins.
  if (delta === null || delta.length >= note.length) {
    return envelope(full, note);
  }

  return envelope(
    {
      kind: "delta",
      hash,
      truncated,
      namespaces,
      base: last.kind === "full" ? last.hash : last.base,
    },
    delta,
  );
}

/**
 * The namespace-level differences between two snapshots, or null when the counts
 * are identical (nothing a delta could say).
 */
function renderDeltaNote(
  last: ExecCatalogMarker,
  current: RenderedCatalog,
): string | null {
  const before = last.namespaces;
  if (!before) return null;

  const after = namespaceCounts(current);
  const lines: string[] = [];

  for (const [name, count] of Object.entries(after)) {
    const previous = before[name];
    if (previous === undefined) {
      lines.push(
        `- \`mcp__${name}\` is now available (${tools(count)}). Search it for signatures.`,
      );
    } else if (previous !== count) {
      lines.push(
        `- \`mcp__${name}\` now has ${tools(count)} (was ${previous}). ` +
          "Search it again before relying on results from before this change.",
      );
    }
  }

  for (const name of Object.keys(before)) {
    if (after[name] === undefined) {
      lines.push(
        `- \`mcp__${name}\` is no longer available and must not be used.`,
      );
    }
  }

  if (lines.length === 0) return null;
  return [DELTA_HEADER, ...lines].join("\n");
}

function tools(count: number): string {
  return `${count} tool${count === 1 ? "" : "s"}`;
}

function namespaceCounts(catalog: RenderedCatalog): Record<string, number> {
  return Object.fromEntries(
    catalog.namespaces.map((namespace) => [namespace.name, namespace.count]),
  );
}

function envelope(marker: ExecCatalogMarker, body: string): string {
  return `${renderMarker(marker)}\n${body}`;
}
