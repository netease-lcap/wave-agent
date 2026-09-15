/**
 * MCP server usage notes, announced in the conversation instead of the system
 * prompt (aligned with Claude Code's `mcp_instructions_delta` attachment).
 *
 * A server's `initialize.instructions` is the one channel for "you need to know
 * this without calling anything" content: rate limits, preconditions, whole-server
 * conventions. It cannot ride in a tool description — the catalog compresses those
 * — and it must not ride in the system prompt: it appears only when a connection
 * happens, and a connection that happens mid-session would rewrite the whole
 * cached prefix (that is exactly the note Claude Code left on the system-prompt
 * variant it replaced: "busts the prompt cache on late MCP connect").
 *
 * So each server's notes are announced once, as a persisted meta message appended
 * at the tail. Two consequences are deliberate:
 *  - History is not rewritten, so a disconnection cannot take the prose back out
 *    of the context. It gets a "no longer applies" notice instead.
 *  - The announced set is derived from the history itself (a marker line), not
 *    from process state, so there is nothing to desync: if the marker is no longer
 *    there (compaction, rewind), the next turn announces the server again. A
 *    duplicate is better than a loss.
 */

import type { Message } from "../types/messaging.js";

/**
 * Per-server cap on announced notes, in characters. Borrowed from Claude Code's
 * `MAX_MCP_DESCRIPTION_LENGTH` (`services/mcp/client.ts`), which caps both MCP tool
 * descriptions and server instructions at this value. Counted in characters like
 * CC, not CJK-aware: what MCP servers write about themselves is overwhelmingly
 * English, the same assumption the catalog budget makes.
 */
export const MCP_INSTRUCTIONS_MAX_CHARS = 2048;

/** Marks an announcement message so the history scan can find it. */
const MARKER_PREFIX = "<!-- mcp-instructions ";
const MARKER_SUFFIX = " -->";

/** What one announcement carries: who appeared, who went away. */
export interface McpInstructionsDelta {
  added: Array<{ name: string; instructions: string }>;
  removed: string[];
}

/** The marker's payload — server names only, so the scan never parses prose. */
interface McpInstructionsMarker {
  added: string[];
  removed: string[];
}

/**
 * Bound a server's notes to the cap, marking the cut so the model knows it is
 * reading an incomplete copy rather than a short one.
 */
export function truncateMcpInstructions(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined || raw.length <= MCP_INSTRUCTIONS_MAX_CHARS) {
    return raw;
  }
  return `${raw.slice(0, MCP_INSTRUCTIONS_MAX_CHARS)}… [truncated]`;
}

/**
 * Servers whose notes the history already contains: markers are folded in message
 * order, so an announced server that later went away stops counting as announced
 * (and is announced again if it comes back).
 *
 * Only the scanner's own messages are read. A marker quoted anywhere else — a
 * reply explaining the mechanism, a hook echoing one — is prose *about* a marker,
 * not a statement of connection state. Counting it invents an announcement, and
 * the invented server is then reported as departed as soon as it is unavailable.
 */
export function collectAnnouncedServers(messages: Message[]): Set<string> {
  const announced = new Set<string>();
  for (const message of messages) {
    if (message.isMeta !== true) continue;
    for (const block of message.blocks) {
      if (block.type !== "text") continue;
      for (const line of block.content.split("\n")) {
        const delta = parseMarkerLine(line);
        if (!delta) continue;
        for (const name of delta.added) announced.add(name);
        for (const name of delta.removed) announced.delete(name);
      }
    }
  }
  return announced;
}

function parseMarkerLine(line: string): McpInstructionsMarker | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(MARKER_PREFIX) || !trimmed.endsWith(MARKER_SUFFIX)) {
    return null;
  }
  const payload = trimmed.slice(
    MARKER_PREFIX.length,
    trimmed.length - MARKER_SUFFIX.length,
  );
  try {
    const parsed = JSON.parse(payload) as {
      added?: unknown;
      removed?: unknown;
    };
    return {
      added: Array.isArray(parsed.added) ? parsed.added.map(String) : [],
      removed: Array.isArray(parsed.removed) ? parsed.removed.map(String) : [],
    };
  } catch {
    // A marker we cannot read (hand-edited or corrupted history) must not take
    // the turn down; the worst case is announcing that server once more.
    return null;
  }
}

/**
 * Render one announcement, or null when there is nothing to say. The marker line
 * leads so the scan reads state without parsing the prose, and the prose keeps
 * opencode's `<mcp_instructions>` envelope so notes stay distinguishable per
 * server and verbatim per line.
 */
export function buildMcpInstructionsAnnouncement(
  delta: McpInstructionsDelta,
): string | null {
  if (delta.added.length === 0 && delta.removed.length === 0) return null;

  const parts: string[] = [
    `${MARKER_PREFIX}${JSON.stringify({
      added: delta.added.map((server) => server.name),
      removed: delta.removed,
    })}${MARKER_SUFFIX}`,
  ];

  if (delta.added.length > 0) {
    parts.push(
      "The following MCP servers have provided instructions for how to use their tools and resources:",
      "",
      renderEnvelope(delta.added),
    );
  }

  if (delta.removed.length > 0) {
    parts.push(
      "The following MCP servers have disconnected. Their instructions above no longer apply:",
      ...delta.removed,
    );
  }

  return parts.join("\n");
}

function renderEnvelope(
  servers: Array<{ name: string; instructions: string }>,
): string {
  return [
    "<mcp_instructions>",
    ...servers.flatMap((server) => [
      `  <server name="${server.name}">`,
      ...server.instructions.split("\n").map((line) => `    ${line}`),
      "  </server>",
    ]),
    "</mcp_instructions>",
  ].join("\n");
}
