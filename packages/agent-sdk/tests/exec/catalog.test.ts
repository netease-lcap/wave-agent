import { describe, it, expect } from "vitest";
import {
  buildExecPool,
  renderSearchCallForm,
  renderSearchSignature,
  renderToolSignature,
  resolveSearchArgs,
  searchPool,
} from "../../src/exec/catalog.js";
import type { ExecPoolEntry } from "../../src/exec/catalog.js";
import {
  EXEC_SEARCH_NAME,
  EXEC_SEARCH_DEFAULT_MAX_RESULTS,
  EXEC_SEARCH_MAX_RESULTS_LIMIT,
} from "../../src/exec/constants.js";

/** A pool entry, with the fields a test cares about set. */
function entry(
  name: string,
  fields: Partial<Omit<ExecPoolEntry, "name">> = {},
): ExecPoolEntry {
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
  pool: readonly ExecPoolEntry[],
  args: Record<string, unknown>,
): string[] {
  return searchPool(pool, resolveSearchArgs(args)).matches.map(
    (hit) => hit.name,
  );
}

describe("buildExecPool", () => {
  const none = new Set<string>();

  it("deferring nothing yields an empty pool", () => {
    // The default for a candidate is "declared flat", so a pool only exists where
    // something said otherwise — which is what keeps this from widening access.
    expect(buildExecPool([{ name: "Read" }, { name: "Write" }], none)).toEqual(
      [],
    );
  });

  it("keeps a tool that claimed defer, in declaration order", () => {
    const pool = buildExecPool(
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
    const pool = buildExecPool(
      [{ name: "mcp__srv__run", isMcp: true }, { name: "Glob" }],
      none,
    );
    expect(pool.map((each) => each.name)).toEqual(["mcp__srv__run"]);
  });

  it("lets alwaysLoad override even the unconditional MCP rule", () => {
    // The escape hatch is the first condition of the judgment precisely so a server
    // can keep a tool it is called for every turn out of the pool.
    const pool = buildExecPool(
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
    const pool = buildExecPool(
      [
        { name: "WebFetch", defer: true },
        { name: "LSP", defer: true },
      ],
      new Set(["WebFetch"]),
    );
    expect(pool.map((each) => each.name)).toEqual(["LSP"]);
  });

  it("cancels a defer claim with the non-deferrable list even for MCP", () => {
    const pool = buildExecPool(
      [{ name: "mcp__srv__run", isMcp: true }],
      new Set(["mcp__srv__run"]),
    );
    expect(pool).toEqual([]);
  });

  it("drops the deferral-only fields from the entries it produces", () => {
    // The pool is what the sandbox may call, not a record of the decision: carrying
    // `defer`/`alwaysLoad` through would invite a later reader to re-decide.
    const [pooled] = buildExecPool(
      [{ name: "WebFetch", defer: true, alwaysLoad: false }],
      none,
    );
    expect(pooled).toEqual({ name: "WebFetch" });
  });

  it("carries each tool's declared output schema for the signature", () => {
    const outputSchema = {
      type: "object",
      properties: { id: { type: "string" } },
    };
    const pool = buildExecPool(
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
      buildExecPool([{ name: EXEC_SEARCH_NAME, defer: true }], none),
    ).toThrow(`Tool "${EXEC_SEARCH_NAME}" cannot be loaded on demand`);
  });

  it("leaves a tool with that name alone while it stays out of the pool", () => {
    // Only a pooled member can shadow anything: declared flat, the name is the
    // model's own call and the sandbox never sees it.
    expect(
      buildExecPool(
        [{ name: EXEC_SEARCH_NAME }, { name: EXEC_SEARCH_NAME, defer: true }],
        new Set([EXEC_SEARCH_NAME]),
      ),
    ).toEqual([]);
  });
});

describe("renderToolSignature", () => {
  it("renders identifier-safe names as property access", () => {
    const line = renderToolSignature(
      entry("mcp__srv__run", {
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
    expect(renderToolSignature({ name: "mcp__my-srv__x" })).toBe(
      'tools["mcp__my-srv__x"](unknown): Promise<unknown>',
    );
  });

  it("renders a declared output schema as the return type", () => {
    const line = renderToolSignature(
      entry("mcp__srv__a", {
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
        entry("mcp__srv__a", { outputSchema: { type: "object" } }),
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
    expect(past).not.toContain("string");
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
  it("renders its signature and its one-line call form from the same schema", () => {
    // The sandbox entry point is documented in two places with different room: the
    // multi-line signature in the Exec description and the one-line form in error
    // messages. Both come from one schema, so they cannot disagree.
    const signature = renderSearchSignature();
    expect(signature.split("\n")[0]).toBe(`tools.${EXEC_SEARCH_NAME}({`);
    expect(signature).toContain("  query?: string,");
    // JSON Schema's `integer` renders as `number`: TypeScript has no such type, and
    // a signature must be copyable as written.
    expect(signature).toContain("  max_results?: number,");
    // The return type is the object a hit comes back in, not an array of hits:
    // `total` is what tells a capped result from a small pool.
    expect(signature).toContain("  matches: Array<{");
    expect(signature).toContain("  total: number,");
    expect(renderSearchCallForm()).toBe(
      `tools.${EXEC_SEARCH_NAME}({ query: "...", max_results: 0 })`,
    );
  });

  it("advertises exactly the arguments the validator accepts", () => {
    // Only the parameter block: the return type's fields are addresses into a
    // result, not arguments, and reading them as arguments would make this test
    // assert its own drift rather than catch it.
    const signature = renderSearchSignature();
    const block = signature.slice(0, signature.indexOf("}): ") + 1);
    const advertised = block
      .split("\n")
      .map((line) => /^\s*([A-Za-z_$][\w$]*)\??:/.exec(line)?.[1])
      .filter((key): key is string => key !== undefined);

    expect(advertised).toEqual(["query", "max_results"]);
    // The form taught to the model, fed straight back in: drift between the prose
    // and the host is what this catches.
    expect(() =>
      resolveSearchArgs({ query: "...", max_results: 0 }),
    ).not.toThrow();
  });

  it("rejects an argument the schema does not declare instead of searching", () => {
    // `{ q: "..." }` used to read as "no query" and answer with the whole pool,
    // dressing a typo up as a successful search.
    expect(() => resolveSearchArgs({ q: "sum" })).toThrow(
      `${EXEC_SEARCH_NAME}() does not take "q". Expected ${renderSearchCallForm()}`,
    );
  });

  it("rejects a non-string query", () => {
    expect(() => resolveSearchArgs({ query: 42 })).toThrow(
      `${EXEC_SEARCH_NAME}() expects "query" to be a string, got number. Expected ${renderSearchCallForm()}`,
    );
  });

  it("rejects a non-numeric max_results", () => {
    expect(() => resolveSearchArgs({ query: "a", max_results: "3" })).toThrow(
      `${EXEC_SEARCH_NAME}() expects "max_results" to be a number, got string.`,
    );
  });

  it("trims and lower-cases the query, and treats an omission as empty", () => {
    expect(resolveSearchArgs({ query: "  Sum  " }).query).toBe("sum");
    expect(resolveSearchArgs({ query: "" }).query).toBe("");
    expect(resolveSearchArgs({}).query).toBe("");
  });

  it("defaults the result cap and clamps what the caller asks for", () => {
    expect(resolveSearchArgs({}).maxResults).toBe(
      EXEC_SEARCH_DEFAULT_MAX_RESULTS,
    );
    // The limit is the model's to set, so without a ceiling one call could dump the
    // whole pool into the context.
    expect(resolveSearchArgs({ max_results: 1000 }).maxResults).toBe(
      EXEC_SEARCH_MAX_RESULTS_LIMIT,
    );
    expect(resolveSearchArgs({ max_results: 0 }).maxResults).toBe(1);
    expect(resolveSearchArgs({ max_results: -5 }).maxResults).toBe(1);
    expect(resolveSearchArgs({ max_results: 2.7 }).maxResults).toBe(2);
  });

  it("reads `select:` as a list of exact names, not as a keyword", () => {
    expect(resolveSearchArgs({ query: "select: Read, Write" })).toEqual({
      query: "",
      select: ["Read", "Write"],
      maxResults: EXEC_SEARCH_DEFAULT_MAX_RESULTS,
    });
    // An empty entry is dropped rather than turned into a name.
    expect(resolveSearchArgs({ query: "select:,Read," }).select).toEqual([
      "Read",
    ]);
  });
});

describe("searchPool", () => {
  const pool = [
    entry("mcp__srv__read_file", { isMcp: true, description: "Read a file" }),
    entry("mcp__srv__write_file", { isMcp: true, description: "Write a file" }),
    entry("WebFetch", {
      description: "Fetch a URL",
      searchHint: "fetch a url",
    }),
  ];

  it("returns every match for an empty query, capped", () => {
    const result = searchPool(pool, resolveSearchArgs({}));
    expect(result.matches).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it("matches name, hint and description case-insensitively", () => {
    expect(hitNames(pool, { query: "WRITE" })).toEqual([
      "mcp__srv__write_file",
    ]);
    expect(hitNames(pool, { query: "fetch" })).toEqual(["WebFetch"]);
    expect(hitNames(pool, { query: "a file" })).toEqual([
      "mcp__srv__read_file",
      "mcp__srv__write_file",
    ]);
  });

  it("requires every keyword to match somewhere", () => {
    // Otherwise "write file" would return everything that mentions either word, and
    // the model would have to read the hits to find out which one it asked for.
    expect(hitNames(pool, { query: "write nonexistent" })).toEqual([]);
  });

  it("ranks an exact name above a name word, a substring, a hint and a description", () => {
    const ranked = [
      entry("git", { description: "nothing here" }),
      entry("git_status", {}),
      entry("digit", {}),
      entry("hinted", { searchHint: "inspect git state" }),
      entry("described", { description: "runs git commands" }),
    ];
    expect(hitNames(ranked, { query: "git" })).toEqual([
      "git",
      "git_status",
      "digit",
      "hinted",
      "described",
    ]);
  });

  it("breaks a score tie by name, so the order never depends on the pool", () => {
    const tied = [entry("mcp__b__x"), entry("mcp__a__x")];
    expect(hitNames(tied, { query: "x" })).toEqual(["mcp__a__x", "mcp__b__x"]);
  });

  it("reports the total before the cap, so a capped query does not look small", () => {
    const many = Array.from({ length: 8 }, (_, i) => entry(`tool_${i}`));
    const result = searchPool(many, resolveSearchArgs({ query: "tool" }));
    expect(result.matches).toHaveLength(EXEC_SEARCH_DEFAULT_MAX_RESULTS);
    expect(result.total).toBe(8);
  });

  it("honours max_results", () => {
    const many = Array.from({ length: 8 }, (_, i) => entry(`tool_${i}`));
    expect(
      searchPool(many, resolveSearchArgs({ query: "tool", max_results: 3 }))
        .matches,
    ).toHaveLength(3);
  });

  it("returns nothing for a query that matches nothing, without throwing", () => {
    const result = searchPool(pool, resolveSearchArgs({ query: "zzz" }));
    expect(result.matches).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("answers select: with exactly the names named, in the order named", () => {
    // Naming tools is not fuzzy matching: the order is the caller's, the cap does
    // not apply, and nothing else comes along.
    const result = searchPool(
      pool,
      resolveSearchArgs({ query: "select:WebFetch,mcp__srv__read_file" }),
    );
    expect(result.matches.map((hit) => hit.name)).toEqual([
      "WebFetch",
      "mcp__srv__read_file",
    ]);
    expect(result.total).toBe(2);
  });

  it("matches select: names case-insensitively and drops the ones that do not exist", () => {
    expect(hitNames(pool, { query: "select:webfetch,Nope" })).toEqual([
      "WebFetch",
    ]);
  });

  it("returns a selected name once even when it is named twice", () => {
    expect(hitNames(pool, { query: "select:WebFetch,webfetch" })).toEqual([
      "WebFetch",
    ]);
  });

  it("hands back the same signature renderToolSignature produces", () => {
    const [hit] = searchPool(
      pool,
      resolveSearchArgs({ query: "webfetch" }),
    ).matches;
    expect(hit.signature).toBe(renderToolSignature(pool[2]));
    expect(hit.description).toBe("Fetch a URL");
  });

  it("is a pure function of the pool and the query", () => {
    const once = searchPool(pool, resolveSearchArgs({ query: "file" }));
    const twice = searchPool(pool, resolveSearchArgs({ query: "file" }));
    expect(once).toEqual(twice);
  });
});
