/**
 * The available-subagent list, announced in the conversation instead of inside
 * the `Agent` tool description.
 *
 * Same argument as `utils/skillListing.ts`, with a trigger that fires more
 * often: the subagent set moves while a session runs — an MCP server connecting
 * or dropping takes its agents with it, an in-place plugin reload rebuilds the
 * table, and a permission-rule change narrows what may be dispatched. While the
 * list lived in the description, every one of those rewrote `tools[]` and
 * re-billed the whole tool-schema prefix. Claude Code measures that cost at
 * ~10.2% of fleet cache_creation tokens and moved the list into an attachment
 * behind `tengu_agent_list_attach`; the `REPL` catalog and the skill listing
 * already work this way here.
 *
 * State lives in the history, not in the process: each announcement leads with
 * a marker line carrying the hash of the body it introduces, which makes
 * "has the model read this exact list, and is it still current" answerable
 * without remembering anything between turns. Compaction, rewind and process
 * restart all degrade to "nothing announced yet ⇒ announce the full list".
 *
 * There is no delta, for the reason spelled out in `skillListing.ts`: a delta
 * only describes a change *relative to what was announced before*, so a freshly
 * rendered line can never compare equal to the one the model read, and the
 * session would re-announce on every single turn.
 */
import { createHash } from "node:crypto";
import type { Message } from "../types/messaging.js";
import type { SubagentConfiguration } from "./subagentParser.js";

/** Marks a subagent listing so the history scan can find it. */
export const AGENT_LISTING_MARKER_PREFIX = "<!-- agent-listing ";
export const AGENT_LISTING_MARKER_SUFFIX = " -->";

/** A marker's payload: what a later turn needs to compare against. */
export interface AgentListingMarker {
  /** Hash of the listing body as of this announcement. */
  hash: string;
}

interface MarkerPayload {
  h?: unknown;
}

/** Opens the list; one subagent per line follows. */
const LISTING_HEADER =
  "Subagents available for use with the Agent tool (name: when to use it):";

/** Shown when the list is empty but an earlier one had been announced. */
const EMPTY_NOTE =
  "No subagents are currently available. The subagent list an earlier message showed is no longer current.";

/**
 * Hard cap on one entry's description, in every tier and for every source.
 * Same number as the skill listing (Claude Code's `MAX_LISTING_DESC_CHARS`):
 * the list is for discovery, the agent's own prompt is loaded on dispatch.
 */
export const MAX_LISTING_DESC_CHARS = 250;

/**
 * Below this per-entry allowance the compact tier drops descriptions instead of
 * keeping a shred of one. Same 20 as the skill listing.
 */
const MIN_DESCRIPTION_CHARS = 20;

/**
 * Character budget used when the caller has no context window to scale from.
 * Roughly 2K tokens. Kept equal to the skill listing's floor so the two
 * announcements grow at the same rate as a session gets busier.
 */
export const DEFAULT_AGENT_LISTING_CHAR_BUDGET = 8_000;

/** Same rule as the skill listing: ~2% of the window in characters, with a floor. */
export function resolveAgentListingCharBudget(contextWindow: number): number {
  return Math.max(
    DEFAULT_AGENT_LISTING_CHAR_BUDGET,
    Math.floor(contextWindow * 4 * 0.02),
  );
}

/** Squash a description onto one line and cap it. */
function formatDescription(description: string, maxChars: number): string {
  const oneLine = description.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/** What a subagent can reach, plus whether it isolates itself. */
function toolsSuffix(config: SubagentConfiguration): string {
  const tools = config.tools?.length
    ? ` (Tools: ${config.tools.join(", ")})`
    : config.disallowedTools?.length
      ? ` (Tools: All except ${config.disallowedTools.join(", ")})`
      : " (Tools: *)";
  const isolation =
    config.isolation === "worktree" ? " (isolation: worktree)" : "";
  return `${tools}${isolation}`;
}

/**
 * One subagent as a listing line: name, when to use it, what it can reach, and
 * whether it isolates itself. Mirrors what the inline description used to say —
 * a listing that dropped the tool pool would make two agents with different
 * reach unselectable from each other.
 */
export function formatAgentLine(config: SubagentConfiguration): string {
  return `- ${config.name}: ${config.description}${toolsSuffix(config)}`;
}

function renderLine(
  config: SubagentConfiguration,
  maxDescription: number | null,
): string {
  const suffix = toolsSuffix(config);
  if (maxDescription === null) return `- ${config.name}${suffix}`;
  const description = formatDescription(
    config.description,
    Math.min(maxDescription, MAX_LISTING_DESC_CHARS),
  );
  return description
    ? `- ${config.name}: ${description}${suffix}`
    : `- ${config.name}${suffix}`;
}

/** Width of one entry's line before its description: `- name: ` plus the tools suffix. */
function prefixLength(config: SubagentConfiguration): number {
  return `- ${config.name}: `.length + toolsSuffix(config).length;
}

/**
 * Render the listing body, trimming descriptions until it fits `budgetChars`.
 *
 * Order of sacrifice matches the skill listing: descriptions trimmed to the
 * 250-char cap → non-builtin descriptions allowed an equal share of the
 * remainder → descriptions dropped (names + tool pools only) → the tail of the
 * list dropped with an explicit count. Names and tool pools survive longest: a
 * subagent the model never sees cannot be dispatched at all.
 *
 * Sorted by name so the body — and therefore the hash — is a function of the
 * subagent *set*, not of discovery order.
 */
export function formatAgentsWithinBudget(
  configs: readonly SubagentConfiguration[],
  budgetChars: number = DEFAULT_AGENT_LISTING_CHAR_BUDGET,
): { body: string; omitted: number } {
  const sorted = [...configs].sort((a, b) => a.name.localeCompare(b.name));
  const assemble = (lines: string[], omitted = 0): string => {
    const tail =
      omitted > 0 ? [`- (${omitted} more subagents not listed)`] : [];
    return [LISTING_HEADER, ...lines, ...tail].join("\n");
  };

  const full = sorted.map((config) =>
    renderLine(config, MAX_LISTING_DESC_CHARS),
  );
  const fullBody = assemble(full);
  if (fullBody.length <= budgetChars) return { body: fullBody, omitted: 0 };

  // Same allocation as the skill listing: builtin subagents keep their
  // description, the rest split what is left over evenly instead of taking a
  // fixed cut each — a fixed one makes the budget a cliff (see skillListing.ts).
  const isBuiltin = (config: SubagentConfiguration) =>
    config.scope === "builtin";
  const builtins = sorted.filter(isBuiltin);
  const rest = sorted.filter((config) => !isBuiltin(config));

  let reserved = LISTING_HEADER.length;
  for (const config of builtins) {
    reserved += 1 + renderLine(config, MAX_LISTING_DESC_CHARS).length;
  }
  const restOverhead = rest.reduce(
    (sum, config) => sum + 1 + prefixLength(config),
    0,
  );
  const maxDescChars =
    rest.length === 0
      ? 0
      : Math.floor((budgetChars - reserved - restOverhead) / rest.length);

  if (maxDescChars >= MIN_DESCRIPTION_CHARS) {
    const shared = sorted.map((config) =>
      renderLine(
        config,
        isBuiltin(config) ? MAX_LISTING_DESC_CHARS : maxDescChars,
      ),
    );
    const sharedBody = assemble(shared);
    if (sharedBody.length <= budgetChars)
      return { body: sharedBody, omitted: 0 };
  }

  const names = sorted.map((config) => renderLine(config, null));
  const nameBody = assemble(names);
  if (nameBody.length <= budgetChars) return { body: nameBody, omitted: 0 };

  const kept: string[] = [];
  let used = LISTING_HEADER.length + 1;
  for (const line of names) {
    if (used + line.length + 1 > budgetChars) break;
    kept.push(line);
    used += line.length + 1;
  }
  const omitted = names.length - kept.length;
  return { body: assemble(kept, omitted), omitted };
}

/** The marker line for a body: its hash is the identity a later turn compares. */
function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 12);
}

function renderMarker(marker: AgentListingMarker): string {
  const payload: MarkerPayload = { h: marker.hash };
  return `${AGENT_LISTING_MARKER_PREFIX}${JSON.stringify(payload)}${AGENT_LISTING_MARKER_SUFFIX}`;
}

/**
 * Read the last subagent listing out of the history, or null when there is none.
 *
 * Scanned from the tail and stopped at the first hit, for the same reasons as
 * `collectSkillListingState`: only meta messages count (a marker quoted in prose
 * is *about* a marker), and an unparseable marker is skipped — the worst case is
 * one extra listing.
 */
export function collectAgentListingState(
  messages: Message[],
): AgentListingMarker | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.isMeta !== true) continue;
    for (const block of message.blocks) {
      if (block.type !== "text") continue;
      if (!block.content.includes(AGENT_LISTING_MARKER_PREFIX)) continue;
      for (const line of block.content.split("\n")) {
        const marker = parseMarkerLine(line);
        if (marker) return marker;
      }
    }
  }

  return null;
}

function parseMarkerLine(line: string): AgentListingMarker | null {
  const trimmed = line.trim();
  if (
    !trimmed.startsWith(AGENT_LISTING_MARKER_PREFIX) ||
    !trimmed.endsWith(AGENT_LISTING_MARKER_SUFFIX)
  ) {
    return null;
  }
  const payload = trimmed.slice(
    AGENT_LISTING_MARKER_PREFIX.length,
    trimmed.length - AGENT_LISTING_MARKER_SUFFIX.length,
  );
  try {
    const parsed = JSON.parse(payload) as MarkerPayload;
    if (typeof parsed.h !== "string") return null;
    return { hash: parsed.h };
  } catch {
    return null;
  }
}

/**
 * The next listing for this turn, or null when there is nothing to say.
 *
 * Decision table:
 *  - no subagents and nothing ever announced → silence (the model is told
 *    nothing about a list it never had);
 *  - no subagents but a list is on record → say so once, so a model still
 *    holding the old list is corrected;
 *  - nothing announced yet → the full list;
 *  - the same hash → silence;
 *  - anything else → the full list.
 */
export function buildAgentListingAnnouncement(
  last: AgentListingMarker | null,
  configs: readonly SubagentConfiguration[],
  budgetChars: number = DEFAULT_AGENT_LISTING_CHAR_BUDGET,
): string | null {
  if (configs.length === 0) {
    if (last === null) return null;
    const emptyMarker = { hash: hashBody(EMPTY_NOTE) };
    if (last.hash === emptyMarker.hash) return null;
    return `${renderMarker(emptyMarker)}\n${EMPTY_NOTE}`;
  }

  const { body } = formatAgentsWithinBudget(configs, budgetChars);
  const hash = hashBody(body);
  if (last !== null && last.hash === hash) return null;

  return `${renderMarker({ hash })}\n${body}`;
}
