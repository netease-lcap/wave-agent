import { describe, it, expect } from "vitest";
import {
  buildReplPool,
  describeTool,
  listToolNames,
  renderSearchCallForm,
  renderSearchSignature,
  renderToolSignature,
  searchTools,
} from "../../src/repl/catalog.js";
import type { ReplPoolEntry } from "../../src/repl/catalog.js";
import {
  REPL_SEARCH_NAME,
  REPL_SEARCH_DEFAULT_MAX_RESULTS,
  REPL_SEARCH_MAX_RESULTS_LIMIT,
} from "../../src/repl/constants.js";

/** A pool entry, with the fields a test cares about set. */
function entry(
  name: string,
  fields: Partial<Omit<ReplPoolEntry, "name">> = {},
): ReplPoolEntry {
  return { name, ...fields };
}

/** An object schema nested `levels` deep; the innermost field is a string at that depth. */
function nestedSchema(levels: number): Record<string, unknown> {
  let schema: Record<string, unknown> = { type: "string" };
  for (let i = 0; i < levels; i += 1) {
    schema = { type: "object", properties: { [`p${i}`]: schema } };
  }
  return schema;
}

/** The names of a search's hits, in the order it returned them. */
function hitNames(
  pool: readonly ReplPoolEntry[],
  query: string,
  max?: number,
): string[] {
  return searchTools(pool, query, max).map((hit) => hit.name);
}

describe("buildReplPool", () => {
  const none = new Set<string>();

  it("deferring nothing yields an empty pool", () => {
    // The default for a candidate is "declared flat", so a pool only exists where
    // something said otherwise — which is what keeps this from widening access.
    expect(buildReplPool([{ name: "Read" }, { name: "Write" }], none)).toEqual(
      [],
    );
  });

  it("keeps a tool that claimed defer, in declaration order", () => {
    const pool = buildReplPool(
      [
        { name: "Bash" },
        { name: "WebFetch", defer: true, description: "Fetch a URL" },
        { name: "TaskCreate", defer: true },
      ],
      none,
    );

    expect(pool.map((each) => each.name)).toEqual(["WebFetch", "TaskCreate"]);
    expect(pool[0].description).toBe("Fetch a URL");
  });

  it("defers every MCP tool, whether or not it claimed defer", () => {
    const pool = buildReplPool(
      [{ name: "mcp__srv__run", isMcp: true }, { name: "Glob" }],
      none,
    );
    expect(pool.map((each) => each.name)).toEqual(["mcp__srv__run"]);
  });

  it("lets alwaysLoad override even the unconditional MCP rule", () => {
    // The escape hatch is the first condition of the judgment precisely so a server
    // can keep a tool it is called for every turn out of the pool.
    const pool = buildReplPool(
      [
        { name: "mcp__srv__ping", isMcp: true, alwaysLoad: true },
        { name: "WebFetch", defer: true, alwaysLoad: true },
        { name: "WebSearch", defer: true },
      ],
      none,
    );
    expect(pool.map((each) => each.name)).toEqual(["WebSearch"]);
  });

  it("cancels a defer claim with the non-deferrable list", () => {
    const pool = buildReplPool(
      [
        { name: "WebFetch", defer: true },
        { name: "LSP", defer: true },
      ],
      new Set(["WebFetch"]),
    );
    expect(pool.map((each) => each.name)).toEqual(["LSP"]);
  });

  it("cancels a defer claim with the non-deferrable list even for MCP", () => {
    const pool = buildReplPool(
      [{ name: "mcp__srv__run", isMcp: true }],
      new Set(["mcp__srv__run"]),
    );
    expect(pool).toEqual([]);
  });

  it("drops the deferral-only fields from the entries it produces", () => {
    // The pool is what the sandbox may call, not a record of the decision: carrying
    // `defer`/`alwaysLoad` through would invite a later reader to re-decide.
    const [pooled] = buildReplPool(
      [{ name: "WebFetch", defer: true, alwaysLoad: false }],
      none,
    );
    expect(pooled).toEqual({ name: "WebFetch" });
  });

  it("copies the announcement tier the deferral judgment assigned", () => {
    // The announcement splits on `tier`; re-deriving it there is how the two would
    // eventually disagree about which tools get an inline signature.
    const pool = buildReplPool(
      [
        { name: "Read", defer: true, tier: "core" },
        { name: "WebFetch", defer: true },
      ],
      none,
    );
    expect(pool.map((each) => each.tier)).toEqual(["core", undefined]);
  });

  it("carries each tool's declared output schema for the signature", () => {
    const outputSchema = {
      type: "object",
      properties: { id: { type: "string" } },
    };
    const pool = buildReplPool(
      [
        { name: "mcp__srv__run", isMcp: true, outputSchema },
        { name: "mcp__srv__quiet", isMcp: true },
      ],
      none,
    );

    expect(pool[0].outputSchema).toBe(outputSchema);
    expect(pool[1].outputSchema).toBeUndefined();
  });

  it("refuses a pooled tool named like the sandbox's own search entry", () => {
    // The sandbox assigns its search entry under that key after filling the pool,
    // so a member carrying the name would be shadowed rather than called: the model
    // would read the tool in the announcement and silently reach search. `$codemode`
    // could not collide because of its `$`; this name can, and refusing to build the
    // pool is what replaces that prefix.
    expect(() =>
      buildReplPool([{ name: REPL_SEARCH_NAME, defer: true }], none),
    ).toThrow(`Tool "${REPL_SEARCH_NAME}" cannot be loaded on demand`);
  });

  it("leaves a tool with that name alone while it stays out of the pool", () => {
    // Only a pooled member can shadow anything: declared flat, the name is the
    // model's own call and the sandbox never sees it.
    expect(
      buildReplPool(
        [{ name: REPL_SEARCH_NAME }, { name: REPL_SEARCH_NAME, defer: true }],
        new Set([REPL_SEARCH_NAME]),
      ),
    ).toEqual([]);
  });

  it("takes the background lane away from a shell tool it pools", () => {
    // The pool is the sync lane by construction — every call in it answers inside
    // the fixed wait window, and the async lane is `Poll`'s. Leaving
    // `run_in_background` declared would describe a parameter the pooled lane
    // cannot honour, so the pooled schema loses it (Claude Code does the same).
    const shellSchema = () => ({
      type: "object",
      properties: {
        command: { type: "string" },
        run_in_background: { type: "boolean" },
      },
      required: ["command", "run_in_background"],
    });

    for (const name of ["Bash", "PowerShell"]) {
      const [pooled] = buildReplPool(
        [{ name, inputSchema: shellSchema() }],
        none,
        true,
      );
      expect(pooled.inputSchema).toEqual({
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      });
    }

    // Pooled only because it claimed defer, with the core switch off: `Bash` is
    // still reachable flat as well, so its declaration keeps the parameter.
    const [byClaim] = buildReplPool(
      [{ name: "Bash", inputSchema: shellSchema(), defer: true }],
      none,
    );
    expect(byClaim.inputSchema).toHaveProperty("properties.run_in_background");

    // A core tool that is not a shell is copied as declared.
    const readSchema = { type: "object", properties: { path: {} } };
    const [read] = buildReplPool(
      [{ name: "Read", inputSchema: readSchema }],
      none,
      true,
    );
    expect(read.inputSchema).toEqual(readSchema);
  });

  it("pools the folded search pair by name, whatever the core switch says", () => {
    // core/repl-tool.md「搜索折叠态下的 Grep / Glob 只在脚本里可达」: the fold is
    // an input of its own, not a core-pool membership. With the switch on `Read`
    // gets the signature tier and the pair stays a name — a signature would be
    // advertising the way round the fold. With it off the pair is still pooled,
    // while `WebFetch` (which only claimed defer) and `Read` keep their answers.
    const folded = new Set(["Grep", "Glob"]);
    const candidates = [
      { name: "Read" },
      { name: "Grep" },
      { name: "Glob" },
      { name: "WebFetch" },
    ];

    const on = buildReplPool(candidates, none, true, undefined, folded);
    expect(on.map((pooled) => pooled.name)).toEqual(["Read", "Grep", "Glob"]);
    expect(on.find((pooled) => pooled.name === "Read")?.tier).toBe("core");
    expect(on.find((pooled) => pooled.name === "Grep")?.tier).toBeUndefined();
    expect(on.find((pooled) => pooled.name === "Glob")?.tier).toBeUndefined();

    const off = buildReplPool(candidates, none, false, undefined, folded);
    expect(off.map((pooled) => pooled.name)).toEqual(["Grep", "Glob"]);
    for (const pooled of off) expect(pooled.tier).toBeUndefined();
  });
});

describe("renderToolSignature", () => {
  it("renders identifier-safe names as property access", () => {
    const line = renderToolSignature(
      entry("mcp__srv__run", {
        isMcp: true,
        inputSchema: {
          type: "object",
          properties: { cmd: { type: "string" }, cwd: { type: "string" } },
          required: ["cmd"],
        },
      }),
    );

    expect(line).toBe(
      [
        "tools.mcp__srv__run({",
        "  cmd: string,",
        "  cwd?: string,",
        "}): Promise<unknown>",
      ].join("\n"),
    );
  });

  it("falls back to bracket access when the name is not a valid identifier", () => {
    expect(renderToolSignature({ name: "mcp__my-srv__x", isMcp: true })).toBe(
      'tools["mcp__my-srv__x"](unknown): Promise<unknown>',
    );
  });

  it("renders a declared output schema as the return type", () => {
    const line = renderToolSignature(
      entry("mcp__srv__a", {
        isMcp: true,
        outputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "the id" },
            count: { type: "number" },
          },
          required: ["id"],
        },
      }),
    );

    expect(line).toBe(
      [
        "tools.mcp__srv__a(unknown): Promise<{",
        "  /** the id */",
        "  id: string,",
        "  count?: number,",
        "}>",
      ].join("\n"),
    );
  });

  it("renders a degenerate output schema as what it says, not as a guess", () => {
    // `{ type: "object" }` declares "some object, shape unspecified" — the
    // lifetime of a real server declaring that. Rendering `{}` says exactly that;
    // inventing a narrower shape would be a lie the model could act on.
    expect(
      renderToolSignature(
        entry("mcp__srv__a", {
          isMcp: true,
          outputSchema: { type: "object" },
        }),
      ),
    ).toBe("tools.mcp__srv__a(unknown): Promise<{}>");
  });

  it("renders enum, array and union types", () => {
    expect(
      renderToolSignature(
        entry("a", {
          inputSchema: {
            type: "object",
            properties: { mode: { enum: ["fast", "slow"] } },
          },
        }),
      ),
    ).toBe(
      ["tools.a({", '  mode?: "fast" | "slow",', "}): Promise<unknown>"].join(
        "\n",
      ),
    );

    expect(
      renderToolSignature(
        entry("b", {
          inputSchema: {
            type: "object",
            properties: { items: { type: "array", items: { type: "string" } } },
          },
        }),
      ),
    ).toBe(
      ["tools.b({", "  items?: Array<string>,", "}): Promise<unknown>"].join(
        "\n",
      ),
    );

    expect(
      renderToolSignature(
        entry("c", {
          inputSchema: { anyOf: [{ type: "string" }, { type: "number" }] },
        }),
      ),
    ).toBe("tools.c(string | number): Promise<unknown>");
  });

  it("renders every property of a wide schema", () => {
    // No per-level property cap: a wide schema is exactly where the model would
    // otherwise have to guess which parameter to pass.
    const wide = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`p${i}`, { type: "string" }]),
      ),
    };
    const line = renderToolSignature(entry("e", { inputSchema: wide }));
    expect(line).toContain("  p9?: string,");
    expect(line).not.toContain("...");
  });

  it("renders every enum variant", () => {
    const line = renderToolSignature(
      entry("en", {
        inputSchema: {
          type: "object",
          properties: {
            mode: {
              enum: [
                "alpha",
                "bravo",
                "charlie",
                "delta",
                "echo",
                "foxtrot",
                "golf",
              ],
            },
          },
        },
      }),
    );
    expect(line).toContain(
      '  mode?: "alpha" | "bravo" | "charlie" | "delta" | "echo" | "foxtrot" | "golf",',
    );
  });

  it("renders every union branch", () => {
    // Like properties and enum variants, a union is a list of choices the model
    // has to pick from, so no branch may be dropped. opencode's renderer, whose
    // depth ceiling this one borrows, caps neither.
    const line = renderToolSignature(
      entry("u", {
        inputSchema: {
          anyOf: ["a", "b", "c", "d", "e", "f"].map((kind) => ({
            type: "object",
            properties: { kind: { enum: [kind] } },
          })),
        },
      }),
    );
    expect(line).toContain('"f"');
    expect(line.match(/kind/g) ?? []).toHaveLength(6);
    expect(line).not.toContain("...");
  });

  it("expands nested schemas until the depth ceiling, then degrades to unknown", () => {
    // `nestedSchema(n)` puts the innermost string at depth n.
    expect(
      renderToolSignature(entry("d", { inputSchema: nestedSchema(8) })),
    ).toContain("p0?: string,");
    // One level past the ceiling the field renders as `unknown` rather than
    // expanding further or overflowing the stack.
    const past = renderToolSignature(
      entry("d", { inputSchema: nestedSchema(9) }),
    );
    expect(past).toContain("p0?: unknown,");
    // Only the argument type is under test here; the return type is `string`
    // for every built-in, so it must not count as a failure to degrade.
    expect(past.split("): Promise<")[0]).not.toContain("string");
  });

  it("renders per-field JSDoc for descriptions, defaults and constraints", () => {
    const line = renderToolSignature(
      entry("g", {
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner" },
            perPage: {
              type: "number",
              description: "Results per page",
              default: 30,
            },
            labels: {
              type: "array",
              items: { type: "string" },
              description: "Filter by labels",
              minItems: 1,
              maxItems: 10,
            },
            home: { type: "string", format: "uri" },
            legacy: { type: "string", deprecated: true },
            plain: { type: "boolean" },
          },
        },
      }),
    );

    expect(line).toBe(
      [
        "tools.g({",
        "  /** Repository owner */",
        "  owner?: string,",
        "  /**",
        "   * Results per page",
        "   * @default 30",
        "   */",
        "  perPage?: number,",
        "  /**",
        "   * Filter by labels",
        "   * @minItems 1",
        "   * @maxItems 10",
        "   */",
        "  labels?: Array<string>,",
        "  /** @format uri */",
        "  home?: string,",
        "  /** @deprecated */",
        "  legacy?: string,",
        // No description and no tag -> no comment line at all.
        "  plain?: boolean,",
        "}): Promise<unknown>",
      ].join("\n"),
    );
  });

  it("keeps a field description verbatim, multi-line and uncapped", () => {
    // Field text is decision guidance ("which variant, and why"), so it arrives
    // whole: multi-line, no width cap, nothing dropped.
    const line = renderToolSignature(
      entry("gl", {
        inputSchema: {
          type: "object",
          properties: {
            p: {
              type: "string",
              description: `${"d".repeat(200)}\nsecond line`,
            },
          },
        },
      }),
    );
    const lines = line.split("\n");

    expect(lines).toEqual([
      "tools.gl({",
      "  /**",
      `   * ${"d".repeat(200)}`,
      "   * second line",
      "   */",
      "  p?: string,",
      "}): Promise<unknown>",
    ]);
  });

  it("renders no tool description at all", () => {
    // The tool's own prose is not part of a signature: it is returned as search's
    // `description` field, unwrapped and whole. Appending it here would be a second
    // spelling of the same text, drifting on the first edit.
    const line = renderToolSignature(
      entry("gd", { description: "Fetch a URL and extract its text" }),
    );
    expect(line).toBe("tools.gd(unknown): Promise<unknown>");
  });

  it("emits a tag even when the field has no description", () => {
    const line = renderToolSignature(
      entry("gt", {
        inputSchema: {
          type: "object",
          properties: { limit: { type: "number", default: 30000 } },
        },
      }),
    );
    expect(line).toContain("  /** @default 30000 */\n  limit?: number,");
  });

  it("neutralizes a comment terminator inside a description", () => {
    const line = renderToolSignature(
      entry("gs", {
        inputSchema: {
          type: "object",
          properties: {
            note: { type: "string", description: "Ends */ early" },
          },
        },
      }),
    );
    expect(line).toContain("/** Ends * / early */");
    expect(line).not.toContain("Ends */");
  });
});
describe("search entry", () => {
  it("renders the positional signature the sandbox entry point takes", () => {
    // One form for the prose, the error text and the host: the bare global, a
    // positional query with an optional cap, returning the hits themselves.
    const signature = renderSearchSignature();
    expect(signature.split("\n")[0]).toBe(
      "searchTools(query: string, max?: number): Promise<Array<{",
    );
    expect(signature).toContain("name: string,");
    expect(signature).toContain("about: string,");
    expect(signature).toContain("input: string,");
    // Three fields, nothing else: no return type (that is `describeTool`'s job) and
    // no `total` (that is the separate `ToolSearch` tool's result shape).
    expect(signature).not.toContain("total");
    expect(signature).not.toContain("Promise<Promise");
    expect(renderSearchCallForm()).toBe(`searchTools("...")`);
  });

  it("fits model-visible text: no three-digit numbers sneak in", () => {
    // The description the signature is pasted into must stay free of budgets.
    expect(renderSearchSignature()).not.toMatch(/\b\d{3,}\b/);
  });
});

describe("searchTools", () => {
  /** `count` tools sharing one name segment, so a query can match all of them. */
  function manyNames(count: number): ReplPoolEntry[] {
    return Array.from({ length: count }, (_, index) =>
      entry(`alpha_${String(index).padStart(2, "0")}`, {
        description: "a tool",
      }),
    );
  }

  it("defaults to 8 hits", () => {
    expect(hitNames(manyNames(40), "alpha")).toHaveLength(8);
    expect(REPL_SEARCH_DEFAULT_MAX_RESULTS).toBe(8);
  });

  it("takes a positive integer cap and honours it", () => {
    expect(hitNames(manyNames(40), "alpha", 3)).toHaveLength(3);
  });

  it("never returns more than 25, whatever the caller asks for", () => {
    // The limit is the model's to set, so without a ceiling one call could dump the
    // whole pool into the context.
    expect(hitNames(manyNames(40), "alpha", 26)).toHaveLength(25);
    expect(hitNames(manyNames(40), "alpha", 1_000)).toHaveLength(25);
    expect(REPL_SEARCH_MAX_RESULTS_LIMIT).toBe(25);
  });

  it("treats a cap that is not a positive integer as absent", () => {
    expect(hitNames(manyNames(20), "alpha", 0)).toHaveLength(8);
    expect(hitNames(manyNames(20), "alpha", -3)).toHaveLength(8);
    expect(hitNames(manyNames(20), "alpha", 2.7)).toHaveLength(8);
  });

  it("refuses an empty or non-string query instead of dumping the pool", () => {
    // "Here is everything" dresses a typo up as a successful search, and the model
    // has no way to tell the two apart.
    const usage =
      "searchTools: pass the words to look for, e.g. searchTools('slack message')";
    expect(() => searchTools(manyNames(3), "")).toThrow(usage);
    expect(() => searchTools(manyNames(3), "   ")).toThrow(usage);
    expect(() => searchTools(manyNames(3), 42 as unknown as string)).toThrow(
      usage,
    );
  });

  it("short-circuits an exact name: that one tool, first and only", () => {
    // The model read the name in the announcement; fuzzy neighbours would only
    // dilute the answer it asked for.
    const pool = [
      entry("slack", { description: "Send a Slack message" }),
      entry("slack_post_message", { description: "Post to a Slack channel" }),
      entry("mcp__slack__list", { isMcp: true }),
    ];
    expect(hitNames(pool, "SLACK")).toEqual(["slack"]);
    expect(hitNames(pool, " slack ")).toEqual(["slack"]);
  });

  it("matches an `mcp__` query as a name prefix", () => {
    const pool = [
      entry("mcp__slack__post_message", { isMcp: true }),
      entry("mcp__slack__list_channels", { isMcp: true }),
      entry("mcp__github__create_issue", { isMcp: true }),
      entry("SlackPost", { description: "not an mcp tool" }),
    ];
    expect(hitNames(pool, "mcp__slack__")).toEqual([
      "mcp__slack__list_channels",
      "mcp__slack__post_message",
    ]);
    expect(hitNames(pool, "MCP__GITHUB__")).toEqual([
      "mcp__github__create_issue",
    ]);
  });

  it("requires every `+term` to match, and only scores the rest", () => {
    const pool = [
      entry("mcp__slack__post_message", {
        isMcp: true,
        description: "Send a message to a channel",
      }),
      entry("slack_upload", { description: "Upload a file to Slack" }),
      entry("message_search", { description: "Search messages" }),
    ];
    // `+slack +message`: both words have to land somewhere in the same tool.
    expect(hitNames(pool, "+slack +message")).toEqual([
      "mcp__slack__post_message",
    ]);
    // The unprefixed query is a ranking rather than a filter: both name-word matches
    // survive, and the MCP entry wins the same-tier tie-break.
    expect(hitNames(pool, "message")).toEqual([
      "mcp__slack__post_message",
      "message_search",
    ]);
  });

  it("ranks a name word above a substring, a hint and a description", () => {
    // No entry is named exactly `git`, so this is the ranking and not the
    // exact-name short-circuit: one whole name word, then a substring of a name,
    // then the curated hint, then prose.
    const pool = [
      entry("git_status", {}),
      entry("digit", {}),
      entry("hinted", { searchHint: "inspect git state" }),
      entry("described", { description: "runs git commands" }),
      entry("irrelevant", { description: "unrelated" }),
    ];
    expect(hitNames(pool, "git")).toEqual([
      "git_status",
      "digit",
      "hinted",
      "described",
    ]);
  });

  it("lets a multi-word query reach prose that separates the words", () => {
    // The description is matched as a pattern, so "read file" finds a tool whose
    // description says "Reads a file from disk" — the words are not adjacent there.
    const pool = [
      entry("Read", { description: "Reads a file from disk" }),
      entry("Write", { description: "Writes a file to disk" }),
    ];
    expect(hitNames(pool, "read file")).toEqual(["Read"]);
  });

  it("weights an MCP tool above a built-in at the same tier", () => {
    const pool = [
      entry("post_message", {}),
      entry("mcp__srv__post_message", { isMcp: true }),
    ];
    // The same two name words for both, so the MCP bonus decides the tie.
    expect(hitNames(pool, "post message")).toEqual([
      "mcp__srv__post_message",
      "post_message",
    ]);
  });

  it("breaks a score tie by name, so the order never depends on the pool", () => {
    const tied = [entry("mcp__b__x"), entry("mcp__a__x")];
    expect(hitNames(tied, "x")).toEqual(["mcp__a__x", "mcp__b__x"]);
    expect(hitNames([...tied].reverse(), "x")).toEqual([
      "mcp__a__x",
      "mcp__b__x",
    ]);
  });

  it("returns nothing for a query that matches nothing, without throwing", () => {
    expect(searchTools(manyNames(3), "zzz")).toEqual([]);
  });

  it("returns hits with exactly four fields and no total", () => {
    // `total` belongs to the separate `ToolSearch` tool's result shape, not to the
    // sandbox global: a capped list is not a count of matches. The four fields are
    // name / about / input / output — the return type is what decides whether the
    // model can write the next step without another round-trip (spec
    // core/repl-tool.md「在沙箱内搜索工具形状」场景 2).
    const [hit] = searchTools(manyNames(3), "alpha");
    expect(Object.keys(hit).sort()).toEqual([
      "about",
      "input",
      "name",
      "output",
    ]);
    expect(searchTools(manyNames(3), "alpha")).not.toHaveProperty("total");
  });

  it("returns the argument type as `input` and the return type as `output`", () => {
    const [hit] = searchTools(
      [
        entry("reader", {
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          outputSchema: {
            type: "object",
            properties: { content: { type: "string" } },
          },
        }),
      ],
      "reader",
    );

    expect(hit.input).toBe(["{", "  path: string,", "}"].join("\n"));
    // The return type travels beside the arguments rather than instead of them:
    // `input` stays the argument object, and `output` is the resolved value.
    expect(hit.input).not.toContain("content");
    expect(hit.output).toContain("content");
  });

  it("cuts `about` to 160 characters and keeps the tool's own words", () => {
    const [hit] = searchTools(
      [entry("verbose", { description: `${"word ".repeat(100)}tail` })],
      "verbose",
    );
    expect(hit.about.length).toBe(160);
    expect(hit.about.startsWith("word word")).toBe(true);
    expect(hit.about.endsWith("…")).toBe(true);
  });

  it("does not leak the curated searchHint into its answer", () => {
    // The hint is for matching only: it never appears in the announcement, and a hit
    // is the tool's own description.
    const [hit] = searchTools(
      [
        entry("hidden", {
          searchHint: "private phrase",
          description: "public",
        }),
      ],
      "private",
    );
    expect(hit?.name).toBe("hidden");
    expect(hit.about).toBe("public");
    expect(JSON.stringify(hit)).not.toContain("private phrase");
  });

  it("is a pure function of the pool and the query", () => {
    const pool = manyNames(5);
    expect(searchTools(pool, "alpha")).toEqual(searchTools(pool, "alpha"));
    expect(searchTools(pool, "alpha")).toEqual(
      searchTools([...pool].reverse(), "alpha"),
    );
  });
});

describe("describeTool", () => {
  /** `describeTool`, narrowed to the answer a pooled name gets. */
  function descriptionOf(
    pool: readonly ReplPoolEntry[],
    name: string,
  ): {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    output: string;
  } {
    const answer = describeTool(pool, name);
    if ("error" in answer) throw new Error(answer.error);
    return answer;
  }

  it("returns the name, the description and the argument schema", () => {
    const schema = {
      type: "object",
      properties: { path: { type: "string", description: "the file" } },
      required: ["path"],
    };
    expect(
      descriptionOf(
        [entry("Read", { description: "Read a file", inputSchema: schema })],
        "Read",
      ),
    ).toEqual({
      name: "Read",
      description: "Read a file",
      // The tool's own JSON Schema, not a rendering of it: a caller can walk an
      // object, and a string would be an answer it can only read.
      inputSchema: schema,
      // The return type is the rendered form, because nothing walks or validates it:
      // the sandbox hands the script `data` as it came. `unknown` when the tool
      // declared no output schema — never `string`.
      output: "unknown",
    });
  });

  it("renders the declared output schema as the return type", () => {
    const described = descriptionOf(
      [
        entry("Glob", {
          outputSchema: {
            type: "object",
            properties: {
              filenames: { type: "array", items: { type: "string" } },
            },
            required: ["filenames"],
          },
        }),
      ],
      "Glob",
    );
    expect(described.output).toBe(
      ["{", "  filenames: Array<string>,", "}"].join("\n"),
    );
  });

  it("answers an empty object for a tool that declares no schema", () => {
    // One shape for `inputSchema` in every case: mixed object/string would force
    // every caller to branch before it can read anything.
    expect(descriptionOf([entry("bare")], "bare").inputSchema).toEqual({});
  });

  it("finds a name whatever its case, because search matching is case-insensitive", () => {
    expect(describeTool([entry("WebFetch")], "webfetch")).toMatchObject({
      name: "WebFetch",
    });
  });

  it("reports a name outside the pool instead of throwing", () => {
    const missing = describeTool([entry("Read")], "Nope");
    expect(missing).toEqual({ error: expect.stringContaining('"Nope"') });
  });

  it("cuts the description at 4000 characters", () => {
    const { description } = descriptionOf(
      [entry("chatty", { description: "d".repeat(9_000) })],
      "chatty",
    );
    expect(description.length).toBe(4_000);
    expect(description.endsWith("…")).toBe(true);
  });

  /** `count` arguments, each with a description long enough to spend the budget. */
  function describedSchema(count: number): Record<string, unknown> {
    return {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `property_${index}`,
          {
            type: "string",
            description: "a long enough field description to spend the budget",
          },
        ]),
      ),
    };
  }

  /** A schema with more arguments than any budget can carry in full. */
  function hugeSchema(): Record<string, unknown> {
    return {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 400 }, (_, index) => [
          `property_${index}`,
          { type: "string", description: "a long enough field description" },
        ]),
      ),
    };
  }

  it("spends the budget on prose first, and stays an object", () => {
    const { inputSchema } = descriptionOf(
      [entry("wide", { inputSchema: describedSchema(100) })],
      "wide",
    );
    expect(JSON.stringify(inputSchema).length).toBeLessThanOrEqual(6_000);
    const properties = inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    // Every argument survived, with its type; only its prose was dropped — the
    // names and types are what the model cannot guess.
    expect(Object.keys(properties)).toHaveLength(100);
    expect(properties.property_0).toEqual({ type: "string" });
    expect(inputSchema.$comment).toBeTypeOf("string");
  });

  it("keeps the argument names when even that does not fit", () => {
    const { inputSchema } = descriptionOf(
      [entry("huge", { inputSchema: hugeSchema() })],
      "huge",
    );
    expect(typeof inputSchema).toBe("object");
    const properties = inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toHaveLength(400);
    expect(inputSchema.type).toBe("object");
    expect(inputSchema.$comment).toBeTypeOf("string");
  });

  it("never spends more than 15000 characters on inputs in one search", () => {
    // Five oversized schemas, eight-hit budget: the per-hit cap alone would let a
    // single search answer with 48000 characters.
    const pool = Array.from({ length: 5 }, (_, index) =>
      entry(`huge_${index}`, { inputSchema: hugeSchema() }),
    );
    const hits = searchTools(pool, "huge");

    let remaining = 15_000;
    for (const hit of hits) {
      const noteOnly = hit.input.startsWith("\n// 这部分被省略了");
      if (noteOnly) continue;
      expect(hit.input.length).toBeLessThanOrEqual(Math.min(6_000, remaining));
      remaining -= hit.input.length;
    }
    // Spending is complete, modulo the line-boundary cut: the last hits have no
    // room left and say only where the full schema is.
    expect(remaining).toBeLessThan(200);
    expect(hits[hits.length - 1].input).toContain("这部分被省略了");
  });
});

describe("listToolNames", () => {
  it("returns every name in the pool, sorted", () => {
    expect(
      listToolNames([entry("WebFetch"), entry("Bash"), entry("mcp__a__b")]),
    ).toEqual(["Bash", "WebFetch", "mcp__a__b"]);
  });

  it("is a function of the set, not of the order it arrived in", () => {
    const names = ["Read", "Glob", "Grep"];
    expect(listToolNames(names.map((name) => entry(name)))).toEqual(
      [...names].sort(),
    );
  });
});
