import { describe, it, expect } from "vitest";
import {
  EXEC_CATALOG_MARKER_PREFIX,
  EXEC_CATALOG_MARKER_SUFFIX,
  buildExecCatalogAnnouncement,
  collectExecCatalogState,
  renderPoolNote,
} from "../../src/exec/catalogAnnouncement.js";
import type { Message } from "../../src/types/messaging.js";

/** A pool as the announcement sees it: names, and nothing else. */
function poolOf(...names: string[]): string[] {
  return names;
}

/** Two names from one server, the shape a real pool mostly has. */
const ALPHA = poolOf("mcp__alpha__tool0", "mcp__alpha__tool1");

function meta(content: string, isMeta = true): Message {
  return {
    id: content.slice(0, 12),
    role: "user",
    timestamp: "2026-09-15T00:00:00.000Z",
    isMeta,
    blocks: [{ type: "text", content }],
  };
}

/** The marker payload of an announcement, as it rides in the message. */
function markerOf(text: string): Record<string, unknown> {
  const line = text.split("\n")[0];
  expect(line.startsWith(EXEC_CATALOG_MARKER_PREFIX)).toBe(true);
  expect(line.endsWith(EXEC_CATALOG_MARKER_SUFFIX)).toBe(true);
  return JSON.parse(
    line.slice(
      EXEC_CATALOG_MARKER_PREFIX.length,
      line.length - EXEC_CATALOG_MARKER_SUFFIX.length,
    ),
  );
}

/** The announcement a session with no history receives for this pool. */
function announce(pool: readonly string[] | undefined): string | null {
  return buildExecCatalogAnnouncement(null, pool);
}

describe("renderPoolNote", () => {
  it("lists every name, one per line, with no other content", () => {
    const note = renderPoolNote(["mcp__alpha__tool0", "WebFetch"]);
    expect(note).toBe(
      [
        "Tools reachable inside a sandbox script as `tools.<name>` (no other tool name resolves):",
        "- `WebFetch`",
        "- `mcp__alpha__tool0`",
        "Call `tools.ToolSearch(...)` for any of their parameters and return types.",
      ].join("\n"),
    );
  });

  it("renders no signature, no count and no budget", () => {
    // A name is what the model needs to search for; a signature here would be a
    // second spelling of what search returns, and a count is derivable. Two framing
    // lines plus one per name is the whole body.
    const note = renderPoolNote(ALPHA);
    expect(note).not.toContain("Promise<");
    expect(note).not.toContain("tools.mcp__");
    expect(note.split("\n")).toHaveLength(ALPHA.length + 2);
  });

  it("is a function of the name set, not of the order it arrived in", () => {
    // Pool order is registry order then connection order, which a turn's hash must
    // not depend on: two sessions with the same tools would otherwise disagree about
    // whether anything changed.
    expect(renderPoolNote(["b", "a"])).toBe(renderPoolNote(["a", "b"]));
  });
});

describe("collectExecCatalogState", () => {
  it("takes the last announcement in the history, not the first", () => {
    const first = announce(ALPHA)!;
    const second = announce(poolOf("mcp__beta__tool0"))!;

    const state = collectExecCatalogState([meta(first), meta(second)]);

    expect(state?.kind).toBe("full");
    expect(state?.hash).toBe(markerOf(second).h);
    expect(markerOf(first).h).not.toBe(markerOf(second).h);
  });

  it("reports no announcement for a history that has none", () => {
    expect(collectExecCatalogState([])).toBeNull();
    expect(collectExecCatalogState([meta("hello")])).toBeNull();
  });

  it("ignores a marker that is not in a meta message", () => {
    // A reply explaining the mechanism quotes a marker verbatim. Reading it as state
    // would invent an announcement, and the invented state misleads every later turn.
    expect(collectExecCatalogState([meta(announce(ALPHA)!, false)])).toBeNull();
  });

  it("skips a marker it cannot parse without losing the last good one", () => {
    const good = announce(ALPHA)!;

    const state = collectExecCatalogState([
      meta(good),
      meta(
        `${EXEC_CATALOG_MARKER_PREFIX}{"k":"fu${EXEC_CATALOG_MARKER_SUFFIX}`,
      ),
      meta(
        `${EXEC_CATALOG_MARKER_PREFIX}{"k":"sideways"}${EXEC_CATALOG_MARKER_SUFFIX}`,
      ),
    ]);

    expect(state?.kind).toBe("full");
    expect(state?.hash).toBe(markerOf(good).h);
  });

  it("skips a marker from an older format, which is a full re-announcement once", () => {
    // The delta kinds are gone; a history carrying one describes a pool this code
    // cannot reconstruct, and the worst case is announcing the list again.
    const legacy = `${EXEC_CATALOG_MARKER_PREFIX}{"k":"delta","h":"abc","bh":"def"}${EXEC_CATALOG_MARKER_SUFFIX}`;
    expect(collectExecCatalogState([meta(legacy)])).toBeNull();
  });
});

describe("buildExecCatalogAnnouncement", () => {
  it("announces the pool for a session that has announced nothing", () => {
    const text = announce(ALPHA)!;

    expect(markerOf(text)).toMatchObject({ k: "full" });
    expect(typeof markerOf(text).h).toBe("string");
    expect(text).toContain("- `mcp__alpha__tool0`");
    expect(text).toContain("- `mcp__alpha__tool1`");
  });

  it("stays silent for a closed channel it has never announced", () => {
    // Most sessions have no `Exec` at all. A closing notice there would announce the
    // disappearance of a channel the model never saw — and "nothing to read" is not
    // "observed absence".
    expect(announce(undefined)).toBeNull();
    expect(announce([])).toBeNull();
  });

  it("stays silent while the pool is unchanged", () => {
    const first = announce(ALPHA)!;
    const state = collectExecCatalogState([meta(first)]);

    expect(buildExecCatalogAnnouncement(state, ALPHA)).toBeNull();
    // The same names in a different order are the same pool: the hash covers the
    // sorted body, so nothing about arrival order can leak into it.
    expect(
      buildExecCatalogAnnouncement(state, [...ALPHA].reverse()),
    ).toBeNull();
  });

  it("re-announces in full when a tool appears or goes away", () => {
    const first = announce(ALPHA)!;
    const state = collectExecCatalogState([meta(first)]);

    const added = buildExecCatalogAnnouncement(
      state,
      poolOf(...ALPHA, "mcp__alpha__tool2"),
    )!;
    expect(markerOf(added)).toMatchObject({ k: "full" });
    expect(added).toContain("- `mcp__alpha__tool2`");

    // Removals are the case the model would otherwise keep acting on: a tool named
    // by an earlier list must not survive anywhere.
    const gone = buildExecCatalogAnnouncement(state, poolOf(ALPHA[0]))!;
    expect(gone).toContain("- `mcp__alpha__tool0`");
    expect(gone).not.toContain("tool1");
  });

  it("says the list no longer applies when the channel closes, once", () => {
    const first = announce(ALPHA)!;
    const state = collectExecCatalogState([meta(first)]);

    const removed = buildExecCatalogAnnouncement(state, undefined)!;
    expect(removed).toContain("no longer available");
    // No hash: a closed channel has no list to compare, which is also why re-opening
    // always re-announces in full.
    expect(markerOf(removed)).toEqual({ k: "removed" });

    // The history's last word is already "there is no channel": saying it again every
    // turn would be noise.
    expect(
      buildExecCatalogAnnouncement(
        collectExecCatalogState([meta(first), meta(removed)]),
        undefined,
      ),
    ).toBeNull();
  });

  it("treats an emptied pool as a closed channel", () => {
    // An empty pool means no `Exec` declaration either, so the calling form is gone
    // exactly as it is when the switch is flipped off.
    const first = announce(ALPHA)!;
    const state = collectExecCatalogState([meta(first)]);

    const removed = buildExecCatalogAnnouncement(state, [])!;
    expect(removed).toContain("no longer available");
    expect(markerOf(removed)).toEqual({ k: "removed" });
  });

  it("re-announces in full when the channel re-opens unchanged", () => {
    // Not compared by hash: a closed channel has no list to hash, so going by content
    // would leave the session mute forever after a switch off and back on.
    const first = announce(ALPHA)!;
    const removed = buildExecCatalogAnnouncement(
      collectExecCatalogState([meta(first)]),
      undefined,
    )!;

    const text = buildExecCatalogAnnouncement(
      collectExecCatalogState([meta(first), meta(removed)]),
      ALPHA,
    )!;

    expect(markerOf(text)).toMatchObject({ k: "full" });
    expect(text).toContain("- `mcp__alpha__tool0`");
  });

  it("re-announces the full list once the history it was compared against is gone", () => {
    // Compaction removes the announcement but leaves the pool untouched. There is
    // nothing left for the model to have read, so "unchanged" is not knowable — and a
    // duplicate is better than a loss.
    const first = announce(ALPHA)!;
    expect(collectExecCatalogState([meta(first)])).not.toBeNull();
    expect(collectExecCatalogState([meta("compacted away")])).toBeNull();

    const text = announce(ALPHA)!;
    expect(text).toContain("- `mcp__alpha__tool0`");
  });

  it("announces the same pool byte-for-byte, so a session can tell it did not move", () => {
    expect(announce(ALPHA)).toBe(announce(ALPHA));
  });
});
