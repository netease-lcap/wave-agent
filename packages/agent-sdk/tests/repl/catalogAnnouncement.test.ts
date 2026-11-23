import { describe, it, expect } from "vitest";
import {
  REPL_CATALOG_MARKER_PREFIX,
  REPL_CATALOG_MARKER_SUFFIX,
  buildReplCatalogAnnouncement,
  collectReplCatalogState,
  renderPoolNote,
} from "../../src/repl/catalogAnnouncement.js";
import { renderToolSignature } from "../../src/repl/catalog.js";
import type { ReplPoolEntry } from "../../src/repl/catalog.js";
import type { Message } from "../../src/types/messaging.js";

/** A tier-1 entry: pooled, flagged core by the deferral judgment, with a schema. */
function core(
  name: string,
  description: string,
  schema?: Record<string, unknown>,
): ReplPoolEntry {
  return { name, tier: "core", description, inputSchema: schema };
}

/** A tier-2 entry: pooled, name only. */
function named(name: string, description?: string): ReplPoolEntry {
  return { name, description };
}

/** Two names from one server, the shape a real pool mostly has. */
const ALPHA: ReplPoolEntry[] = [
  named("mcp__alpha__tool0"),
  named("mcp__alpha__tool1"),
];

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
  expect(line.startsWith(REPL_CATALOG_MARKER_PREFIX)).toBe(true);
  expect(line.endsWith(REPL_CATALOG_MARKER_SUFFIX)).toBe(true);
  return JSON.parse(
    line.slice(
      REPL_CATALOG_MARKER_PREFIX.length,
      line.length - REPL_CATALOG_MARKER_SUFFIX.length,
    ),
  );
}

/** The announcement a session with no history receives for this pool. */
function announce(pool: readonly ReplPoolEntry[] | undefined): string | null {
  return buildReplCatalogAnnouncement(null, pool);
}

/** The three-tier body for one mixed pool, spelled out. */
const MIXED: ReplPoolEntry[] = [
  core("Read", "Read a file from disk.", {
    type: "object",
    properties: { file_path: { type: "string" } },
    required: ["file_path"],
  }),
  named("WebFetch", "Fetch a URL and extract its text as markdown."),
  ...ALPHA,
  named("mcp__beta__tool0"),
];

describe("renderPoolNote", () => {
  it("renders the three tiers: signatures, names, server names", () => {
    expect(renderPoolNote(MIXED)).toBe(
      [
        "Tools reachable inside a sandbox script as `tools.<name>` (no other tool name resolves; a tool this session declares outside this list is called as a tool, not from inside a script):",
        "```ts",
        "// Read a file from disk.",
        "tools.Read({",
        "  file_path: string,",
        "}): Promise<string>",
        "```",
        "Also callable as `tools.<name>(input)`; `describeTool(name)` returns the full shape: `WebFetch`.",
        'MCP tools: connected servers are `alpha`, `beta`. Find one with `searchTools("...")` and call it with the shape it returns.',
      ].join("\n"),
    );
  });

  it("renders tier 1 through the same renderer searchTools and describeTool use", () => {
    const entry = core("Bash", "Run a shell command.", {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    });
    const note = renderPoolNote([entry]);
    // Copyable, and the one renderer: a hand-written signature would drift on the
    // first schema change.
    expect(note).toContain(renderToolSignature(entry));
  });

  it("cuts a tier-1 description to one line, preferring a sentence end", () => {
    const sentence =
      "First sentence that carries real information about what this tool does with the file it is given.";
    const note = renderPoolNote([
      core("Read", `${sentence} ${"x".repeat(400)}`),
    ]);

    expect(note).toContain(`// ${sentence}\n`);
    expect(note).not.toContain("xxxx");
  });

  it("cuts a tier-1 description with no sentence end at a word, with an ellipsis", () => {
    const note = renderPoolNote([core("Read", "y".repeat(400))]);
    const comment = note.split("\n").find((line) => line.startsWith("// "))!;

    expect(comment.endsWith("…")).toBe(true);
    expect(comment.length).toBeLessThanOrEqual(123);
  });

  it("lists tier 2 by name only: no signature, no description, no headings", () => {
    const note = renderPoolNote([
      named("WebFetch", "Fetch a URL and extract its text as markdown."),
      named("TaskCreate", "Create a task."),
    ]);

    expect(note).toContain("`WebFetch`");
    expect(note).toContain("`TaskCreate`");
    // A description here would be a second, drifting spelling of what search
    // returns; the names are the whole of what tier 2 owes the model.
    expect(note).not.toContain("Fetch a URL");
    expect(note).not.toContain("Promise<");
    expect(note).not.toContain("```");
  });

  it("never lists an MCP tool name — only its servers", () => {
    const note = renderPoolNote(MIXED);

    for (const tool of MIXED.filter((entry) =>
      entry.name.startsWith("mcp__"),
    )) {
      expect(note).not.toContain(tool.name);
    }
    expect(note).not.toContain("mcp__");
    expect(note).toContain("`alpha`");
    expect(note).toContain("`beta`");
  });

  it("keeps the body the same length however many tools one server brings", () => {
    // The reason tier 3 is servers and not tools: a server with thirty tools must
    // not make the announcement thirty lines longer.
    const few = ALPHA;
    const many = Array.from({ length: 30 }, (_, index) =>
      named(`mcp__alpha__tool${index}`),
    );

    expect(renderPoolNote(many)).toBe(renderPoolNote(few));
  });

  it("caps the server list at 40 and says how many it left out", () => {
    const pool = Array.from({ length: 41 }, (_, index) =>
      named(`mcp__srv${String(index).padStart(2, "0")}__tool`),
    );
    const note = renderPoolNote(pool);

    expect(note).toContain("and 1 more");
    // The omission marker is the one number this body may carry.
    expect(note.split("\n").at(-1)).toMatch(/and 1 more/);
    expect(note).not.toContain("srv40");
    expect(note).toContain("srv39");
  });

  it("accepts bare names and puts them in tier 2", () => {
    // The channel that diffs the pool is keyed by name; a name has no schema, so a
    // signature cannot be rendered for it.
    expect(renderPoolNote(["WebFetch"])).toBe(
      [
        "Tools reachable inside a sandbox script as `tools.<name>` (no other tool name resolves; a tool this session declares outside this list is called as a tool, not from inside a script):",
        "Also callable as `tools.<name>(input)`; `describeTool(name)` returns the full shape: `WebFetch`.",
      ].join("\n"),
    );
  });

  it("carries no count, budget, character length, timestamp or connection state", () => {
    const note = renderPoolNote([
      core("Read", "Read a file from disk."),
      named("WebFetch"),
      ...ALPHA,
    ]);

    // Every digit in this body would be a measurement the model could reason about
    // instead of about the tools.
    expect(note).not.toMatch(/\d/);
    expect(note).not.toMatch(/budget|truncat|characters|limit/i);
  });

  it("is a function of the pool's names, not of the order they arrived in", () => {
    const reversed = [...MIXED].reverse();
    expect(renderPoolNote(reversed)).toBe(renderPoolNote(MIXED));
    expect(renderPoolNote(MIXED)).toBe(renderPoolNote(MIXED));
  });
});

describe("collectReplCatalogState", () => {
  it("takes the last announcement in the history, not the first", () => {
    const first = announce(ALPHA)!;
    const second = announce([named("mcp__beta__tool0")])!;

    const state = collectReplCatalogState([meta(first), meta(second)]);

    expect(state?.kind).toBe("full");
    expect(state?.body).toBe(renderPoolNote([named("mcp__beta__tool0")]));
  });

  it("reads the body back through the wrapper the message actually carries", () => {
    // The announcement rides in a `<system-reminder>`. If the wrapper leaked into
    // the body, every turn would compare two different strings and re-announce.
    const wrapped = `<system-reminder>\n${announce(ALPHA)!}\n</system-reminder>`;

    const state = collectReplCatalogState([meta(wrapped)]);

    expect(state?.body).toBe(renderPoolNote(ALPHA));
  });

  it("reports no announcement for a history that has none", () => {
    expect(collectReplCatalogState([])).toBeNull();
    expect(collectReplCatalogState([meta("hello")])).toBeNull();
  });

  it("ignores a marker that is not in a meta message", () => {
    // A reply explaining the mechanism quotes a marker verbatim. Reading it as state
    // would invent an announcement, and the invented state misleads every later turn.
    expect(collectReplCatalogState([meta(announce(ALPHA)!, false)])).toBeNull();
  });

  it("skips a marker it cannot parse without losing the last good one", () => {
    const good = announce(ALPHA)!;

    const state = collectReplCatalogState([
      meta(good),
      meta(
        `${REPL_CATALOG_MARKER_PREFIX}{"k":"fu${REPL_CATALOG_MARKER_SUFFIX}`,
      ),
      meta(
        `${REPL_CATALOG_MARKER_PREFIX}{"k":"sideways"}${REPL_CATALOG_MARKER_SUFFIX}`,
      ),
    ]);

    expect(state?.kind).toBe("full");
    expect(state?.body).toBe(renderPoolNote(ALPHA));
  });

  it("skips a marker from an older format, which is a full re-announcement once", () => {
    // The delta kinds are gone; a history carrying one describes a pool this code
    // cannot reconstruct, and the worst case is announcing the list again.
    const legacy = `${REPL_CATALOG_MARKER_PREFIX}{"k":"delta","h":"abc","bh":"def"}${REPL_CATALOG_MARKER_SUFFIX}`;
    expect(collectReplCatalogState([meta(legacy)])).toBeNull();
  });
});

describe("buildReplCatalogAnnouncement", () => {
  it("announces the pool for a session that has announced nothing", () => {
    const text = announce(ALPHA)!;

    expect(markerOf(text)).toMatchObject({ k: "full" });
    // Nothing but the kind rides in the marker: whatever it carried would be text
    // the model reads on every turn.
    expect(markerOf(text)).toEqual({ k: "full" });
    expect(text).toContain("`alpha`");
  });

  it("stays silent for a closed channel it has never announced", () => {
    // Most sessions have no `REPL` at all. A closing notice there would announce the
    // disappearance of a channel the model never saw — and "nothing to read" is not
    // "observed absence".
    expect(announce(undefined)).toBeNull();
    expect(announce([])).toBeNull();
  });

  it("stays silent while the pool is unchanged", () => {
    const first = announce(MIXED)!;
    const state = collectReplCatalogState([meta(first)]);

    expect(buildReplCatalogAnnouncement(state, MIXED)).toBeNull();
    // The same tools in a different order are the same pool: the comparison runs
    // on the sorted body, so nothing about arrival order can leak into it.
    expect(
      buildReplCatalogAnnouncement(state, [...MIXED].reverse()),
    ).toBeNull();
  });

  it("re-announces in full when a tool, a tier or a server appears or goes away", () => {
    const first = announce(MIXED)!;
    const state = collectReplCatalogState([meta(first)]);

    const added = buildReplCatalogAnnouncement(state, [
      ...MIXED,
      named("TaskCreate"),
    ])!;
    expect(markerOf(added)).toMatchObject({ k: "full" });
    expect(added).toContain("`TaskCreate`");

    const gone = buildReplCatalogAnnouncement(state, [
      core("Read", "Read a file from disk."),
      ...ALPHA,
    ])!;
    expect(gone).not.toContain("WebFetch");

    // A tool leaving the core tier re-renders as a name, and the body moves.
    const demoted = buildReplCatalogAnnouncement(state, [
      named("Read", "Read a file from disk."),
      ...MIXED.slice(1),
    ])!;
    expect(demoted).not.toContain("tools.Read(");
    expect(demoted).toContain("`Read`");
  });

  it("says the list no longer applies when the channel closes, once", () => {
    const first = announce(ALPHA)!;
    const state = collectReplCatalogState([meta(first)]);

    const removed = buildReplCatalogAnnouncement(state, undefined)!;
    expect(removed).toContain("no longer available");
    // Only the kind: a closed channel has no list to compare, which is also why
    // re-opening always re-announces in full.
    expect(markerOf(removed)).toEqual({ k: "removed" });

    // The history's last word is already "there is no channel": saying it again every
    // turn would be noise.
    expect(
      buildReplCatalogAnnouncement(
        collectReplCatalogState([meta(first), meta(removed)]),
        undefined,
      ),
    ).toBeNull();
  });

  it("treats an emptied pool as a closed channel", () => {
    // An empty pool means no `REPL` declaration either, so the calling form is gone
    // exactly as it is when the switch is flipped off.
    const first = announce(ALPHA)!;
    const state = collectReplCatalogState([meta(first)]);

    const removed = buildReplCatalogAnnouncement(state, [])!;
    expect(removed).toContain("no longer available");
    expect(markerOf(removed)).toEqual({ k: "removed" });
  });

  it("re-announces in full when the channel re-opens unchanged", () => {
    // Not compared by body: a closed channel has no list to compare, so going by
    // content would leave the session mute forever after a switch off and back on.
    const first = announce(ALPHA)!;
    const removed = buildReplCatalogAnnouncement(
      collectReplCatalogState([meta(first)]),
      undefined,
    )!;

    const text = buildReplCatalogAnnouncement(
      collectReplCatalogState([meta(first), meta(removed)]),
      ALPHA,
    )!;

    expect(markerOf(text)).toMatchObject({ k: "full" });
    expect(text).toContain("`alpha`");
  });

  it("re-announces the full list once the history it was compared against is gone", () => {
    // Compaction removes the announcement but leaves the pool untouched. There is
    // nothing left for the model to have read, so "unchanged" is not knowable — and a
    // duplicate is better than a loss.
    const first = announce(ALPHA)!;
    expect(collectReplCatalogState([meta(first)])).not.toBeNull();
    expect(collectReplCatalogState([meta("compacted away")])).toBeNull();

    expect(announce(ALPHA)).toContain("`alpha`");
  });

  it("announces the same pool byte-for-byte, so a session can tell it did not move", () => {
    expect(announce(MIXED)).toBe(announce(MIXED));
  });
});
