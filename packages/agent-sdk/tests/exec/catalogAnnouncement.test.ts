import { describe, it, expect } from "vitest";
import {
  EXEC_CATALOG_MARKER_PREFIX,
  EXEC_CATALOG_MARKER_SUFFIX,
  buildExecCatalogAnnouncement,
  collectExecCatalogState,
} from "../../src/exec/catalogAnnouncement.js";
import { renderCatalog } from "../../src/exec/catalog.js";
import type { ExecPoolEntry, RenderedCatalog } from "../../src/exec/catalog.js";
import type { Message } from "../../src/types/messaging.js";

/** A pool of `server → how many tools` with no descriptions: each entry is one line. */
function poolOf(counts: Record<string, number>): ExecPoolEntry[] {
  return Object.entries(counts).flatMap(([server, count]) =>
    Array.from({ length: count }, (_, index) => ({
      name: `mcp__${server}__tool${index}`,
    })),
  );
}

/** Truncated: one seat is ~7 estimated tokens, so a 7-token budget shows one entry. */
const STARVED = 7;

function catalogOf(counts: Record<string, number>): RenderedCatalog {
  return renderCatalog(poolOf(counts), 10_000);
}

function starvedCatalogOf(counts: Record<string, number>): RenderedCatalog {
  const rendered = renderCatalog(poolOf(counts), STARVED);
  expect(rendered.truncated).toBe(true);
  return rendered;
}

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

describe("collectExecCatalogState", () => {
  it("takes the last marker in the history, not the first", () => {
    const first = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ alpha: 1 }),
    )!;
    const second = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ beta: 2 }),
    )!;

    const state = collectExecCatalogState([meta(first), meta(second)]);

    expect(state.last?.namespaces).toEqual({ beta: 2 });
    expect(markerOf(first).h).not.toBe(markerOf(second).h);
  });

  it("remembers every full catalog hash in the history", () => {
    const first = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ alpha: 1 }),
    )!;
    const second = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ beta: 2 }),
    )!;

    const state = collectExecCatalogState([meta(first), meta(second)]);

    expect(state.fullHashes.size).toBe(2);
  });

  it("ignores a marker that is not in a meta message", () => {
    // A reply explaining the mechanism quotes a marker verbatim. Reading it as state
    // would invent an announcement, and the invented state misleads every later turn.
    const announcement = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ alpha: 1 }),
    )!;

    const state = collectExecCatalogState([meta(announcement, false)]);

    expect(state.last).toBeNull();
    expect(state.fullHashes.size).toBe(0);
  });

  it("skips a marker it cannot parse without losing the last good one", () => {
    const good = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ alpha: 1 }),
    )!;

    const state = collectExecCatalogState([
      meta(good),
      meta(
        `${EXEC_CATALOG_MARKER_PREFIX}{"k":"fu${EXEC_CATALOG_MARKER_SUFFIX}`,
      ),
      meta(
        `${EXEC_CATALOG_MARKER_PREFIX}{"k":"sideways"}${EXEC_CATALOG_MARKER_SUFFIX}`,
      ),
    ]);

    expect(state.last?.kind).toBe("full");
    expect(markerOf(good).h).toBe(state.last?.hash);
  });
});

describe("buildExecCatalogAnnouncement", () => {
  it("announces the full catalog for a session that has announced nothing", () => {
    const text = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ alpha: 2, beta: 1 }),
    )!;

    expect(markerOf(text)).toMatchObject({
      k: "full",
      t: 0,
      ns: { alpha: 2, beta: 1 },
    });
    expect(text).toContain("tools.mcp__alpha__tool0");
    expect(text).toContain("tools.mcp__beta__tool0");
    // Nothing was truncated, so the call form is not taught anywhere.
    expect(text).not.toContain("PARTIAL");
    expect(text).not.toContain("search(");
  });

  it("teaches the search call form only while the catalog is truncated", () => {
    const truncated = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      starvedCatalogOf({ alpha: 5, beta: 5 }),
    )!;

    expect(markerOf(truncated)).toMatchObject({ k: "full", t: 1 });
    expect(truncated).toContain("PARTIAL — 1 of 10 tools shown");
    expect(truncated).toContain('tools["$codemode"].search(');
    expect(truncated).toMatch(/empty string\) to list the entire pool/);
  });

  it("stays silent for an empty pool it has never announced", () => {
    // With an empty pool `Exec` is not even declared, so there is no tool the note could
    // be about; a session with no MCP servers must not pay a message for it.
    expect(
      buildExecCatalogAnnouncement(
        { last: null, fullHashes: new Set() },
        renderCatalog([], 10_000),
      ),
    ).toBeNull();
  });

  it("tells a session that has seen a catalog when its pool empties", () => {
    const first = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ alpha: 1 }),
    )!;

    const text = buildExecCatalogAnnouncement(
      collectExecCatalogState([meta(first)]),
      renderCatalog([], 10_000),
    )!;

    expect(text).toContain("No MCP tools are currently available");
    // Names no tool: with an empty pool `Exec` is not declared, so naming it would
    // point at something the model cannot call.
    expect(text).not.toContain("Exec");
    expect(markerOf(text)).toMatchObject({ k: "full", t: 0, ns: {} });
  });

  it("stays silent while the pool renders identically", () => {
    const catalog = catalogOf({ alpha: 1 });
    const first = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalog,
    )!;

    const state = collectExecCatalogState([meta(first)]);
    expect(buildExecCatalogAnnouncement(state, catalog)).toBeNull();

    // A fresh rendering of the same pool — not the same object — must also be silent:
    // the hash covers the rendered bytes, so nothing else can leak into it.
    const again = collectExecCatalogState([meta(first)]);
    expect(
      buildExecCatalogAnnouncement(again, catalogOf({ alpha: 1 })),
    ).toBeNull();
  });

  it("announces the full catalog when the pool changed", () => {
    const first = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ alpha: 1 }),
    )!;

    const text = buildExecCatalogAnnouncement(
      collectExecCatalogState([meta(first)]),
      catalogOf({ alpha: 2 }),
    )!;

    expect(text).toContain("tools.mcp__alpha__tool1");
    expect(markerOf(text)).toMatchObject({ k: "full", ns: { alpha: 2 } });
  });

  it("stays silent when the channel was never open", () => {
    // Most sessions have no `Exec` at all (no MCP servers, or the switch off). A
    // closing notice there would announce the disappearance of a channel the model
    // never saw — and "nothing to read" is not "observed absence".
    expect(
      buildExecCatalogAnnouncement(
        { last: null, fullHashes: new Set() },
        undefined,
      ),
    ).toBeNull();
  });

  it("says the catalog no longer applies when the channel closes, once", () => {
    const first = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ alpha: 1 }),
    )!;
    const state = collectExecCatalogState([meta(first)]);

    const removed = buildExecCatalogAnnouncement(state, undefined)!;
    expect(removed).toContain("no longer available");
    expect(markerOf(removed)).toEqual({ k: "removed" });

    // The history's last word is already "there is no catalog": saying it again
    // every turn would be noise.
    expect(
      buildExecCatalogAnnouncement(
        collectExecCatalogState([meta(first), meta(removed)]),
        undefined,
      ),
    ).toBeNull();
  });

  it("re-announces the full catalog when the channel re-opens unchanged", () => {
    // Not compared by hash: a closed channel has no catalog to hash, so going by
    // content would leave the session mute forever after a switch off and on.
    const first = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      catalogOf({ alpha: 1 }),
    )!;
    const removed = buildExecCatalogAnnouncement(
      collectExecCatalogState([meta(first)]),
      undefined,
    )!;

    const text = buildExecCatalogAnnouncement(
      collectExecCatalogState([meta(first), meta(removed)]),
      catalogOf({ alpha: 1 }),
    );

    expect(text).toContain("tools.mcp__alpha__tool0");
    expect(markerOf(text!)).toMatchObject({ k: "full" });
  });
});

describe("buildExecCatalogAnnouncement — namespace deltas", () => {
  /** A full announcement, then its state, for a starved pool. */
  function afterFull(counts: Record<string, number>) {
    const first = buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set() },
      starvedCatalogOf(counts),
    )!;
    return { first, state: collectExecCatalogState([meta(first)]) };
  }

  it("reports a server that appeared, anchored to the catalog it is relative to", () => {
    const { first, state } = afterFull({ alpha: 5, beta: 5 });

    const text = buildExecCatalogAnnouncement(
      state,
      starvedCatalogOf({ alpha: 5, beta: 5, gamma: 5 }),
    )!;

    expect(text).toContain("The MCP tool catalog has changed");
    expect(text).toContain("`mcp__gamma` is now available (5 tools)");
    expect(markerOf(text)).toMatchObject({
      k: "delta",
      bh: markerOf(first).h,
      ns: { alpha: 5, beta: 5, gamma: 5 },
    });
    // The full catalog's own body is not repeated: a delta says only what moved.
    expect(text).not.toContain("tools.mcp__alpha__tool0");
  });

  it("reports a server whose tool count changed, and one that went away", () => {
    const { state } = afterFull({ alpha: 5, beta: 5 });

    const text = buildExecCatalogAnnouncement(
      state,
      starvedCatalogOf({ alpha: 9, gamma: 5 }),
    )!;

    expect(text).toContain("`mcp__alpha` now has 9 tools (was 5)");
    expect(text).toContain("`mcp__beta` is no longer available");
    expect(text).toContain("`mcp__gamma` is now available (5 tools)");
    expect(markerOf(text)).toMatchObject({ k: "delta" });
  });

  it("sends the full catalog when the counts are identical but the text moved", () => {
    // A renamed tool inside one server leaves every namespace count alone, so a
    // namespace-level delta could not say a thing about it.
    const { state } = afterFull({ alpha: 5, beta: 5 });
    const renamed = poolOf({ alpha: 5, beta: 5 }).map((entry) =>
      entry.name === "mcp__alpha__tool0"
        ? { name: "mcp__alpha__renamed" }
        : entry,
    );

    const text = buildExecCatalogAnnouncement(
      state,
      renderCatalog(renamed, STARVED),
    )!;

    expect(markerOf(text)).toMatchObject({ k: "full" });
  });

  it("sends the full catalog when truncation flips", () => {
    const { first, state } = afterFull({ alpha: 5, beta: 5 });
    // Same counts, but now everything fits: the search section appears, and only a
    // full catalog can express that.
    const complete = buildExecCatalogAnnouncement(
      state,
      catalogOf({ alpha: 5, beta: 5 }),
    )!;

    expect(markerOf(complete)).toMatchObject({ k: "full", t: 0 });
    expect(complete).not.toContain("The MCP tool catalog has changed");

    const back = buildExecCatalogAnnouncement(
      collectExecCatalogState([meta(first), meta(complete)]),
      starvedCatalogOf({ alpha: 5, beta: 5 }),
    )!;
    expect(markerOf(back)).toMatchObject({ k: "full", t: 1 });
  });

  it("sends the full catalog when the delta would be the longer message", () => {
    // A wholesale server swap: every namespace is replaced, so a delta is two lines
    // per server against a catalog body that is one entry plus the search section.
    const before = { a: 5, b: 5, c: 5, d: 5, e: 5, f: 5, g: 5, h: 5 };
    const after = { p: 5, q: 5, r: 5, s: 5, t: 5, u: 5, v: 5, w: 5 };
    const { state } = afterFull(before);

    const text = buildExecCatalogAnnouncement(state, starvedCatalogOf(after))!;

    expect(markerOf(text)).toMatchObject({ k: "full" });
  });

  it("carries the baseline forward, so a vanished basis re-announces the full catalog", () => {
    const { first, state } = afterFull({ alpha: 5, beta: 5 });
    const delta = buildExecCatalogAnnouncement(
      state,
      starvedCatalogOf({ alpha: 5, beta: 5, gamma: 5 }),
    )!;
    const second = buildExecCatalogAnnouncement(
      collectExecCatalogState([meta(first), meta(delta)]),
      starvedCatalogOf({ alpha: 5, beta: 5, gamma: 5, delta: 5 }),
    )!;

    // The chain keeps pointing at the one full catalog it started from.
    expect(markerOf(delta)).toMatchObject({ bh: markerOf(first).h });
    expect(markerOf(second)).toMatchObject({
      k: "delta",
      bh: markerOf(first).h,
    });

    // Once compacted away, the basis is gone: a delta relative to nothing says
    // nothing, so the full catalog is re-announced.
    const orphan = collectExecCatalogState([meta(delta), meta(second)]);
    expect(orphan.fullHashes.size).toBe(0);
    const text = buildExecCatalogAnnouncement(
      orphan,
      starvedCatalogOf({ alpha: 5, beta: 5, gamma: 5, delta: 5 }),
    )!;

    expect(markerOf(text)).toMatchObject({ k: "full" });
    expect(text).toContain("tools.mcp__alpha__tool0");
  });

  it("keeps a delta silent on the turn after it was sent", () => {
    // The delta's `h` is the hash of what a full catalog would say right now — not
    // of its own (much shorter) body. Otherwise the next turn would see a mismatch
    // and re-announce on every pass.
    const { first, state } = afterFull({ alpha: 5, beta: 5 });
    const counts = { alpha: 5, beta: 5, gamma: 5 };
    const delta = buildExecCatalogAnnouncement(
      state,
      starvedCatalogOf(counts),
    )!;

    expect(
      buildExecCatalogAnnouncement(
        collectExecCatalogState([meta(first), meta(delta)]),
        starvedCatalogOf(counts),
      ),
    ).toBeNull();
  });
});
