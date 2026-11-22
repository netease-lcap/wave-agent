/**
 * The on-demand tool pool, announced in the conversation instead of inside
 * `REPL`'s tool description.
 *
 * Why it cannot live in the description: `tools[]` sits in the cached prefix, and
 * the pool is a function of the session's servers and configuration. Every server
 * that connects, drops or changes its `tools/list` would rewrite the declaration
 * and take the whole cached prefix with it. The description is a pool-independent
 * constant now; the pool is appended at the tail, where an addition invalidates
 * nothing that already went out.
 *
 * Three tiers, for three different jobs a name has to do:
 *  1. **core tools** (`entry.tier === "core"`, i.e. the seven `enableReplCoreTools`
 *     pools) carry a copyable signature and a one-line description. They are what a
 *     session calls every turn, so making every new session search before its first
 *     script would put the cost on the most travelled route;
 *  2. **the rest of the deferred built-ins** get their names, one line, with a
 *     pointer at `describeTool`. Naming them is enough to tell the model the
 *     capability exists, which is the whole job here — a missing name reads as "this
 *     tool does not exist";
 *  3. **MCP tools** get neither names nor signatures, only their **servers**. A
 *     single server can bring dozens of tools, so listing them would make the body
 *     grow with every server connected; the server list plus "search for one" is
 *     still a complete map of what is reachable. Server names are capped
 *     (`MCP_SERVER_LIST_MAX`) because that count is not ours to bound, and the
 *     overflow marker `and N more` is the one number this body may carry.
 *
 * Nothing else here is allowed to be a number — not a count, not a budget, not a
 * character length, not a connection state. Names (and the server-name overflow
 * marker) make the body a pure function of the pool, and a body that is a pure
 * function of the pool is what lets a turn compare it and stay silent.
 *
 * State lives in the history, not in the process (same rule as
 * `utils/mcpInstructions.ts`): each announcement leads with a marker line saying
 * which body it leads. The marker is therefore an *interface* to the state, not a
 * copy of it — "did the model read this exact list, and is that list still
 * current" is answerable with nothing remembered between turns.
 *
 * The comparison is the body itself, read straight back out of the history: the
 * model already has those bytes, so nothing about them needs to be summarised —
 * and anything the marker carried would be text the model reads every turn for no
 * reason of its own. (Claude Code computes the same digest and keeps it out of the
 * model's text entirely, in its prompt cache key; our replacement is the history
 * it was written to.) Two consequences, both deliberate:
 *  - Once the marker is gone (compaction, rewind), the next turn announces the
 *    full body again. A duplicate is better than a loss.
 *  - The comparison covers rendered text, so editing the renderer re-announces once
 *    for existing sessions. That is what buys the invariant "same body ⇒ the same
 *    bytes the model read".
 */

import type { Message } from "../types/messaging.js";
import { renderSearchCallForm, renderToolSignature } from "./catalog.js";
import type { ExecPoolEntry } from "./catalog.js";

/** Marks an announcement so the history scan can find it. */
export const EXEC_CATALOG_MARKER_PREFIX = "<!-- exec-catalog ";
export const EXEC_CATALOG_MARKER_SUFFIX = " -->";

/** Which body a marker leads. */
type ExecCatalogAnnouncementKind = "full" | "removed";

/**
 * A marker as the history carries it: which body it led, and that body.
 *
 * The body is not stored *in* the marker — it is the message the marker leads, and
 * `collectExecCatalogState` reads it back from there. Nothing is summarised,
 * because nothing summary-shaped can be compared for equality and no digest needs
 * to be shown to the model.
 */
export interface ExecCatalogMarker {
  kind: ExecCatalogAnnouncementKind;
  /** The body this announcement carried, read back out of the history. */
  body?: string;
}

/**
 * The wire shape. The marker rides in every announcement, so it carries the kind
 * and nothing else — `h` is what an older build wrote there and is ignored.
 */
interface MarkerPayload {
  k?: unknown;
}

/**
 * What the announcement can be handed.
 *
 * `ExecPoolEntry` is the whole answer — it carries the tier the deferral judgment
 * assigned and the schema tier 1 renders. A bare name is accepted for callers that
 * only have names (the channel that diffs the pool is keyed by name), and it lands
 * in tier 2: a signature needs a schema, and a name does not have one.
 *
 * Contract with the deferral judgment: tier membership is *read off `tier`*, never
 * re-derived here. `"core"` is `deferral.toolTier(name, coreToolsEnabled)`, copied
 * onto the entry by `buildExecPool`; anything else is `"named"`. Deriving it a
 * second time is how the two would eventually disagree.
 */
export type ExecCatalogPoolMember = string | ExecPoolEntry;

/** How many server names tier 3 may list before it says `and N more`. */
export const MCP_SERVER_LIST_MAX = 40;

/** The prefix that marks a flattened MCP tool name. */
const MCP_NAME_PREFIX = "mcp__";

/** One tier-1 description: a line, not a paragraph. */
const CORE_DESCRIPTION_MAX_CHARS = 120;

/** Where a tier-1 description was cut. */
const ELLIPSIS = "…";

/**
 * Opens the body; the three tiers follow.
 *
 * "No other tool name" rather than "no other name": the search entry is a sandbox
 * global rather than a member of that object, and tier 3's pointer names it, so the
 * header would otherwise leave the reader guessing whether the pointer is another
 * pool entry.
 *
 * The second clause answers the question the list itself raises. The sandbox
 * installs a global for exactly the names below and for nothing else, so a tool
 * this session declares outside the list is *not* reachable in a script — it is
 * called as a tool. Without that clause "no other tool name resolves" reads as "no
 * other tool exists", and a model that knows `Bash` from `tools[]` has no way to
 * tell which of the two it is.
 */
const POOL_HEADER =
  "Tools reachable inside a sandbox script as `tools.<name>` (no other tool name resolves; a tool this session declares outside this list is called as a tool, not from inside a script):";

/**
 * The whole of a search hit is what makes a deferred tool callable, so tier 3 has
 * to point at search rather than at a schema. Same call form the error text teaches.
 */
const SEARCH_POINTER = `Find one with \`${renderSearchCallForm()}\` and call it with the shape it returns.`;

/**
 * What the model is told when the channel closes: `REPL` was switched off,
 * excluded, or denied, or the pool emptied, so the calling form no longer exists
 * and the flat declarations are back. The listed tools are not gone — the way they
 * were listed is.
 *
 * This text is only ever reached by a session that already read an announcement,
 * which is why it says "an earlier list" rather than introducing the concept.
 */
const REMOVED_NOTE =
  "The on-demand tool list is no longer available, so the tools an earlier list named cannot be called this way any more. The tool declarations of this session are the current source of truth.";

/** The body, as the tiers it was built from. */
interface PoolTiers {
  /** Tier 1: pooled, `tier === "core"`, not MCP. */
  core: ExecPoolEntry[];
  /** Tier 2: every other pooled built-in. */
  named: string[];
  /** Tier 3: the servers MCP tools came from, de-duplicated. */
  servers: string[];
}

/**
 * Where a pooled tool came from, when it came from an MCP server.
 *
 * The flattened name is `mcp__<server>__<tool>`, so the server is the segment after
 * the prefix. `isMcp` is honoured as well as the prefix, because the flag is the
 * judgment's own word while the prefix is a rendering convention — a name that has
 * one but not the other still has to land in the right tier.
 */
function serverOf(entry: ExecPoolEntry): string | undefined {
  const isMcp = entry.isMcp === true || entry.name.startsWith(MCP_NAME_PREFIX);
  if (!isMcp) return undefined;
  const rest = entry.name.startsWith(MCP_NAME_PREFIX)
    ? entry.name.slice(MCP_NAME_PREFIX.length)
    : entry.name;
  const boundary = rest.indexOf("__");
  return boundary > 0 ? rest.slice(0, boundary) : rest;
}

/** A name backticked, since every tier is read by a model that will copy it. */
function quoted(name: string): string {
  return `\`${name}\``;
}

/** One line, whatever the source line breaks were. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Endings a description may be cut after, so a truncated line still reads as one. */
const SENTENCE_ENDS = [". ", "。", "! ", "！", "? ", "？", "; ", "；"];

/**
 * A tier-1 description, cut to one line's worth of text.
 *
 * Sentence end first, word boundary second: the point of the cap is that the
 * signature gets the room, and a description guillotined mid-word reads as a broken
 * schema. The full text is one `describeTool` call away, which is why cutting here
 * costs nothing. The ellipsis counts against the cap, so the line really is one
 * line's worth.
 */
function clampDescription(text: string, limit: number): string {
  const line = flatten(text);
  if (line.length <= limit) return line;
  const head = line.slice(0, limit);
  let sentence = -1;
  for (const end of SENTENCE_ENDS) {
    const at = head.lastIndexOf(end);
    if (at > sentence) sentence = at + end.trimEnd().length;
  }
  // Only trust a sentence end in the last third of the budget: a period at character
  // 8 would leave a fragment of a sentence and no information.
  if (sentence > (limit * 2) / 3) return head.slice(0, sentence).trimEnd();
  const word = head.lastIndexOf(" ");
  const cut = word > 0 ? head.slice(0, word) : head.slice(0, limit - 1);
  return `${cut.trimEnd()}${ELLIPSIS}`;
}

/**
 * Tier 1: signatures plus a one-line description each, in one fenced block.
 *
 * The signature is `renderToolSignature`'s output verbatim, and every other place a
 * shape appears — a search hit's `input`, `describeTool`'s `inputSchema` — is the
 * same schema renderer underneath, so a copied line cannot name a parameter the
 * host does not take.
 */
function renderCoreTier(core: readonly ExecPoolEntry[]): string[] {
  const lines = ["```ts"];
  for (const entry of core) {
    const description = clampDescription(
      entry.description ?? "",
      CORE_DESCRIPTION_MAX_CHARS,
    );
    if (description.length > 0) lines.push(`// ${description}`);
    lines.push(...renderToolSignature(entry).split("\n"));
  }
  lines.push("```");
  return lines;
}

/**
 * Tier 2: names only, one line.
 *
 * No signature, no description, no heading of its own — a heading would be a second
 * grouping key next to "is it core", and the names are the whole of what a tier-2
 * tool owes the model. Not truncated, ever: a name list that stops early is
 * indistinguishable from a capability that does not exist.
 */
function renderNamedTier(names: readonly string[]): string {
  return `Also callable as \`tools.<name>(input)\`; \`describeTool(name)\` returns the full shape: ${names.map(quoted).join(", ")}.`;
}

/**
 * Tier 3: the servers, never the tools on them.
 *
 * `and N more` is the one exception to "no numbers in this body": it is the list's
 * own omission marker, not a measurement of anything, and without it a session with
 * 60 servers would believe it had 40.
 */
function renderServerTier(servers: readonly string[]): string {
  const shown = servers.slice(0, MCP_SERVER_LIST_MAX);
  const omitted = servers.length - shown.length;
  const list = shown.map(quoted).join(", ");
  const body = omitted > 0 ? `${list} and ${omitted} more` : list;
  return `MCP tools: connected servers are ${body}. ${SEARCH_POINTER}`;
}

/** Split the pool into the three tiers, each in a deterministic order. */
function splitTiers(pool: readonly ExecCatalogPoolMember[]): PoolTiers {
  const core: ExecPoolEntry[] = [];
  const named: string[] = [];
  const servers = new Set<string>();

  for (const member of pool) {
    const entry: ExecPoolEntry =
      typeof member === "string" ? { name: member } : member;
    const server = serverOf(entry);
    if (server !== undefined) {
      servers.add(server);
      continue;
    }
    if (entry.tier === "core") core.push(entry);
    else named.push(entry.name);
  }

  // Sorted rather than in pool order: pool order is "registry order then whatever
  // order the MCP servers connected in", which a turn's hash must not depend on.
  // Without the sort, two sessions with the same tools could disagree about whether
  // anything changed.
  core.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  named.sort();
  return { core, named, servers: [...servers].sort() };
}

/**
 * The announcement body for a non-empty pool: the three tiers, nothing else.
 *
 * Everything in it is a function of the pool alone, so two renders of the same pool
 * are byte-identical. That is the property the turn-level hash is built on.
 */
export function renderPoolNote(pool: readonly ExecCatalogPoolMember[]): string {
  const tiers = splitTiers(pool);
  const lines = [POOL_HEADER];
  if (tiers.core.length > 0) lines.push(...renderCoreTier(tiers.core));
  if (tiers.named.length > 0) lines.push(renderNamedTier(tiers.named));
  if (tiers.servers.length > 0) lines.push(renderServerTier(tiers.servers));
  return lines.join("\n");
}

/** `{ k }` — the marker, as one line. */
function renderMarker(marker: ExecCatalogMarker): string {
  const payload: MarkerPayload = { k: marker.kind };
  return `${EXEC_CATALOG_MARKER_PREFIX}${JSON.stringify(payload)}${EXEC_CATALOG_MARKER_SUFFIX}`;
}

/** The tag an announcement is wrapped in before it reaches the history. */
const SYSTEM_REMINDER_CLOSE = "</system-reminder>";

/**
 * The body under a marker line: everything after it, minus the wrapper that
 * carried the whole message.
 *
 * The wrapper is dropped here rather than stored separately because the marker
 * line has to stay the *first* line of what the model reads, and because the only
 * thing being compared is the body the renderer produced.
 */
function bodyUnderMarker(lines: string[], markerIndex: number): string {
  const body = lines.slice(markerIndex + 1);
  while (body.length > 0) {
    const last = body[body.length - 1].trim();
    if (last !== "" && last !== SYSTEM_REMINDER_CLOSE) break;
    body.pop();
  }
  return body.join("\n");
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
      const lines = block.content.split("\n");
      for (let line = 0; line < lines.length; line++) {
        const marker = parseMarkerLine(lines[line]);
        if (marker) return { ...marker, body: bodyUnderMarker(lines, line) };
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
    return { kind };
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
 *  - nothing announced yet → the full body;
 *  - the last word was the closing notice → the full body (the channel is not a
 *    list, so there is nothing to compare; going by content would leave a session
 *    mute forever after a switch was flipped off and back on);
 *  - the same body → silence;
 *  - anything else → the full body.
 *
 * There is no delta, and the reason is arithmetic rather than taste: the body *is*
 * the pool's rendering, so a delta would have to carry the previously-announced set
 * somewhere in order to describe a change to it, and that set is the same size as
 * the body it replaces. Nothing is saved and a second state to keep in sync is
 * gained.
 *
 * `pool` is the deferred tools, or `undefined` when the channel is closed — which
 * includes "the pool rendered empty", because an empty pool means no `REPL`
 * declaration either.
 */
export function buildExecCatalogAnnouncement(
  last: ExecCatalogMarker | null,
  pool: readonly ExecCatalogPoolMember[] | undefined,
): string | null {
  if (pool === undefined || pool.length === 0) {
    // Nothing was ever announced, so there is nothing to retract: most sessions
    // have no `REPL` at all, and a closing notice there would be a message about
    // a channel the model never saw. Silence, not "observed absence".
    if (last === null || last.kind === "removed") return null;
    return envelope({ kind: "removed" }, REMOVED_NOTE);
  }

  const note = renderPoolNote(pool);
  if (last !== null && last.kind === "full" && last.body === note) return null;

  return envelope({ kind: "full" }, note);
}

function envelope(marker: ExecCatalogMarker, body: string): string {
  return `${renderMarker(marker)}\n${body}`;
}
