/**
 * The Exec pool: which tools the sandbox may reach, how a tool's call shape is
 * rendered, and how the sandbox's `search` entry point answers.
 *
 * "The pool" is the set of tools loaded on demand — see `exec/deferral.ts` for
 * the judgment that decides membership. Everything here is a pure function of the
 * candidates plus that judgment's inputs; no manager is involved, so the same
 * pool can be built for the declaration path, the announcement and the sandbox
 * without any of them drifting.
 *
 * The hard constraint is that the pool must equal the tools the agent could
 * already call directly — if a tool were reachable from the sandbox but hidden
 * from the agent, Exec would be a permission-escalation channel. Candidates are
 * therefore filtered by permission *before* they arrive here (see
 * `toolManager.getExecPool`), and nothing in this module may widen the set.
 *
 * Two things this module deliberately does not have: a size budget and a
 * truncating renderer. The announcement it feeds is a list of names, so a budget
 * would buy nothing and a silent cut would read as "that capability does not
 * exist". What the model needs beyond names — parameter shapes — is what `search`
 * is for, which is why the search index lives here next to the signature renderer
 * that both of them share.
 *
 * The same reasoning makes `search`'s call form a single object: the shape taught
 * in prose and the shape the host validates are derived from one schema, because
 * teaching one form while accepting another is a bug with no diff to review.
 */
import {
  EXEC_SEARCH_DEFAULT_MAX_RESULTS,
  EXEC_SEARCH_MAX_RESULTS_LIMIT,
  EXEC_SEARCH_NAME,
} from "./constants.js";
import { isDeferredTool } from "./deferral.js";
import type { DeferralSubject } from "./deferral.js";

/**
 * One tool the sandbox can call.
 *
 * `inputSchema`/`outputSchema` are the raw JSON Schemas, used only to render a
 * callable signature — the sandbox never sees them.
 */
export interface ExecPoolEntry {
  /** Flattened `mcp__<server>__<tool>` name, or a built-in tool's name — the key on the sandbox `tools` object. */
  name: string;
  description?: string;
  /** Curated one-liner; scored above `description` (see `scoreEntry`). */
  searchHint?: string;
  /** True when this entry came from an MCP server. */
  isMcp?: boolean;
  inputSchema?: Record<string, unknown>;
  /**
   * The schema the server declared for this tool's output, rendered as the
   * signature's return type. Absent for most servers today, and never present for
   * a built-in (its result is a string); a tool without one still gets a return
   * type (`Promise<unknown>`), because leaving it out would read as "this call
   * returns nothing".
   */
  outputSchema?: Record<string, unknown>;
}

/** A pool candidate: the entry data plus the inputs the deferral judgment reads. */
export interface ExecPoolCandidate extends DeferralSubject {
  description?: string;
  searchHint?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

/**
 * The on-demand subset of `candidates`, in the order given.
 *
 * `nonDeferrable` is the resolved non-deferrable list (structural floor already
 * unioned in — see `getNonDeferrableBuiltins`). Candidates are expected to be
 * permission-filtered already; this function only decides deferral.
 *
 * A candidate named like the sandbox's own search entry is refused rather than
 * pooled. The sandbox assigns that entry to the same key the pool is spread
 * across, so a member carrying the name would be shadowed instead of called: the
 * model would read the tool in the announcement, call it, and silently reach
 * search. Refusing here is what keeps such a pool from existing at all — this
 * builder feeds the flat declarations, the announcement and the sandbox alike, so
 * neither of the other two can be handed one either. It also puts the failure on
 * the registration that caused it, at turn assembly, instead of on an unrelated
 * script that happens to run later. Claude Code's `registerTool` takes the same
 * position ("collides with a built-in global"); it keeps the collision away with a
 * reserved prefix on dynamically registered names, which is the option this name
 * deliberately gave up.
 *
 * Only a *pooled* member can shadow anything, so the check sits after the deferral
 * judgment: a tool with that name that is declared flat is left alone, and one
 * that the non-deferrable list exempts is not a reason to fail a turn either.
 */
export function buildExecPool(
  candidates: readonly ExecPoolCandidate[],
  nonDeferrable: ReadonlySet<string>,
): ExecPoolEntry[] {
  const pool: ExecPoolEntry[] = [];
  for (const candidate of candidates) {
    if (!isDeferredTool(candidate, nonDeferrable)) continue;
    if (candidate.name === EXEC_SEARCH_NAME) {
      throw new Error(
        `Tool "${EXEC_SEARCH_NAME}" cannot be loaded on demand, because the sandbox exposes its own search entry under that name. ` +
          `Rename the tool, or mark it \`alwaysLoad\` so it stays out of the Exec pool.`,
      );
    }
    pool.push({
      name: candidate.name,
      description: candidate.description,
      searchHint: candidate.searchHint,
      isMcp: candidate.isMcp,
      inputSchema: candidate.inputSchema,
      outputSchema: candidate.outputSchema,
    });
  }
  return pool;
}

/**
 * Recursion ceiling for signature rendering. Object, array and union recursion all
 * increment depth, so this bounds every path: a pathological or structurally cyclic
 * schema degrades to `unknown` instead of overflowing the stack. Rendering must
 * never throw.
 *
 * This is the *only* silent reduction in the renderer — there is deliberately no
 * cap on properties per level or on enum variants. A wide schema or a long enum is
 * decision-relevant text, and truncating it is how the model ends up guessing which
 * parameter or which variant to use. Depth 8 and `unknown` are opencode's values
 * (`tool-schema.ts`, `MAX_RENDER_DEPTH`).
 */
const MAX_SIGNATURE_DEPTH = 8;

/** A property name that can be written bare in TypeScript. */
const IDENTIFIER_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Render an object key, quoting names that are not valid identifiers. */
function renderKey(name: string): string {
  return IDENTIFIER_SEGMENT.test(name) ? name : JSON.stringify(name);
}

/**
 * The property path the sandbox exposes a tool under. Non-identifier names use
 * bracket form because `tools.mcp__my-srv__x` would parse as a subtraction.
 */
function toolExpression(name: string): string {
  return IDENTIFIER_SEGMENT.test(name)
    ? `tools.${name}`
    : `tools[${JSON.stringify(name)}]`;
}

/**
 * JSDoc tags for a field. Only keywords that survive `cleanSchema` are
 * supported; anything else (`minimum`, `pattern`, `title`, ...) is dropped.
 */
function docTags(schema: unknown): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const typed = schema as Record<string, unknown>;
  const tags: string[] = [];
  if (typed.deprecated === true) tags.push("@deprecated");
  if (typed.default !== undefined) {
    const rendered = JSON.stringify(typed.default);
    if (rendered !== undefined) tags.push(`@default ${rendered}`);
  }
  if (typeof typed.format === "string") tags.push(`@format ${typed.format}`);
  if (typeof typed.minItems === "number") {
    tags.push(`@minItems ${typed.minItems}`);
  }
  if (typeof typed.maxItems === "number") {
    tags.push(`@maxItems ${typed.maxItems}`);
  }
  return tags;
}

/**
 * The JSDoc block rendered above one field, indented to `pad`. Emits nothing
 * when the field has neither a description nor a tag, so plain fields stay
 * unadorned.
 *
 * The description is kept verbatim — multi-line included, no width cap. A field
 * description says what to put in the field ("which of these variants, and why"),
 * so cutting it at a fixed column cuts the guidance and keeps the preamble. The
 * same goes for the tool's own description: it is returned by `search` unClamped,
 * because a search hit is what the model got in exchange for the round-trip.
 */
function jsdoc(schema: unknown, pad: string): string {
  const description =
    schema && typeof schema === "object" && !Array.isArray(schema)
      ? (schema as Record<string, unknown>).description
      : undefined;
  const raw = [
    ...(typeof description === "string" ? description.split("\n") : []),
    ...docTags(schema),
  ]
    // A `*/` inside third-party text would close the comment early. Split/join
    // rather than `replaceAll`: these packages compile against lib ES2020.
    .map((line) => line.split("*/").join("* /").replace(/\s+$/, ""));
  while (raw.length > 0 && raw[0].trim() === "") raw.shift();
  while (raw.length > 0 && raw[raw.length - 1].trim() === "") raw.pop();
  if (raw.length === 0) return "";
  if (raw.length === 1) return `${pad}/** ${raw[0]} */\n`;
  const body = raw
    .map((line) => `${pad} *${line === "" ? "" : ` ${line}`}`)
    .join("\n");
  return `${pad}/**\n${body}\n${pad} */\n`;
}

/**
 * One JSON Schema type name as a TypeScript one.
 *
 * `integer` is the only name that differs: it is a JSON Schema narrowing, not a
 * TypeScript type, and a signature saying `integer` would be teaching the model a
 * type the runtime does not distinguish.
 */
function scalarType(name: unknown): string {
  if (typeof name !== "string") return "unknown";
  return name === "integer" ? "number" : name;
}

/**
 * Render a JSON Schema as TypeScript: a multi-line block whose fields each carry
 * their own JSDoc. Only recursion depth is capped; properties and enum variants
 * are rendered in full.
 */
function renderType(schema: unknown, depth: number): string {
  if (depth > MAX_SIGNATURE_DEPTH) return "unknown";
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return "unknown";
  }
  const typed = schema as Record<string, unknown>;

  if (Array.isArray(typed.enum)) {
    return typed.enum
      .map((value) => JSON.stringify(value) ?? "null")
      .join(" | ");
  }

  const union = Array.isArray(typed.anyOf)
    ? (typed.anyOf as unknown[])
    : Array.isArray(typed.oneOf)
      ? (typed.oneOf as unknown[])
      : undefined;
  if (union) {
    // No cap on branches, for the reason there is none on properties or enum
    // variants: a union is a list of choices, and showing the first few is how
    // the model ends up using a branch that does not exist. opencode's renderer,
    // whose depth ceiling this one borrows, renders every member too.
    return union.map((variant) => renderType(variant, depth + 1)).join(" | ");
  }

  if (Array.isArray(typed.type)) {
    const names = (typed.type as unknown[]).filter(
      (value): value is string => typeof value === "string",
    );
    if (names.length > 0) return names.map(scalarType).join(" | ");
    return "unknown";
  }

  if (typed.type === "array" || typed.items) {
    return `Array<${renderType(typed.items, depth + 1)}>`;
  }

  if (typed.type === "object" || typed.properties) {
    const properties = (typed.properties ?? {}) as Record<string, unknown>;
    const required = new Set(
      Array.isArray(typed.required) ? (typed.required as string[]) : [],
    );
    const keys = Object.keys(properties);
    if (keys.length === 0) return "{}";
    const pad = "  ".repeat(depth + 1);
    const close = "  ".repeat(depth);
    const lines = keys.map(
      (key) =>
        `${jsdoc(properties[key], pad)}${pad}${renderKey(key)}${required.has(key) ? "" : "?"}: ${renderType(properties[key], depth + 1)},`,
    );
    return `{\n${lines.join("\n")}\n${close}}`;
  }

  return scalarType(typed.type);
}

/**
 * The callable signature for one tool: parameters and return type. This is what
 * `search` hands back, so the model can copy it verbatim into a call.
 *
 * The return type comes from the schema the server declared for its output, and a
 * tool that declared none still gets `Promise<unknown>` rather than no return type
 * at all: the sandbox resolves every call to the tool's output (its structured
 * content, else its text, else `null`), and a signature ending at the parameters
 * would read as "calls this, get nothing". Rendering it from the same rule the
 * runtime applies is what keeps a search hit from teaching a shape the host will
 * not deliver.
 */
export function renderToolSignature(entry: ExecPoolEntry): string {
  return `${toolExpression(entry.name)}(${renderType(entry.inputSchema, 0)}): Promise<${renderType(entry.outputSchema, 0)}>`;
}

/**
 * The path the sandbox exposes search under: `tools.ToolSearch`. Rendered by the
 * same function that renders every tool's path — and the sandbox assigns the entry
 * to exactly that key — so prose and runtime cannot drift.
 */
export const EXEC_SEARCH_EXPRESSION = toolExpression(EXEC_SEARCH_NAME);

/**
 * Input schema of the sandbox's `search` entry point.
 *
 * Load-bearing: the call form in the tool description, the call form in error
 * messages and the validation `resolveSearchArgs` runs all come from this object.
 * The description asked for the object form while the host only accepted a
 * positional string, and nothing in the code tied the two together — one object
 * makes that class of drift impossible rather than unlikely.
 */
const SEARCH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        'Keyword(s) matched against tool names, curated hints and descriptions, case-insensitively. Pass "select:<name>[,<name>...]" to fetch exact names instead. Omit it (or pass an empty string) to list the pool.',
    },
    max_results: {
      type: "integer",
      default: EXEC_SEARCH_DEFAULT_MAX_RESULTS,
      description:
        "Maximum hits for a keyword query. Ignored by select:, which returns exactly what it names.",
    },
  },
};

/**
 * Output schema of the sandbox's `search` entry point.
 *
 * The same role `SEARCH_INPUT_SCHEMA` plays at the other end of the call: the
 * return type in the rendered signature and the value the host actually hands back
 * both come from this one object, so "what a hit looks like" cannot drift between
 * the prose and the runtime. It also keeps the sandbox API uniform — every call
 * resolves to its output, so nothing hands back a JSON *string* to parse.
 *
 * `total` is not decoration: a keyword search is capped, and without the count the
 * model reads "five hits" as "five matches" — the same failure a silently
 * truncated announcement would cause.
 */
const SEARCH_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          signature: { type: "string" },
        },
        required: ["name", "signature"],
      },
    },
    total: {
      type: "integer",
      description:
        "Hits found before the limit was applied. Greater than matches.length means the query was narrowed, not that the pool is that small.",
    },
  },
  required: ["matches", "total"],
};

const SEARCH_INPUT_KEYS = Object.keys(
  SEARCH_INPUT_SCHEMA.properties as Record<string, unknown>,
);

/** A type-shaped placeholder for a field, used by the one-line call form. */
function placeholderFor(schema: unknown): string {
  const type =
    schema && typeof schema === "object" && !Array.isArray(schema)
      ? (schema as Record<string, unknown>).type
      : undefined;
  switch (type) {
    case "string":
      return '"..."';
    case "number":
    case "integer":
      return "0";
    case "boolean":
      return "false";
    case "array":
      return "[]";
    case "object":
      return "{}";
    default:
      return "...";
  }
}

/**
 * The callable signature of search, rendered by the very function that renders
 * every tool signature, so its shape cannot drift from what the host accepts or
 * returns. Multi-line, for the tool description where there is room to show the
 * field docs.
 */
export function renderSearchSignature(): string {
  return `${EXEC_SEARCH_EXPRESSION}(${renderType(SEARCH_INPUT_SCHEMA, 0)}): Promise<${renderType(SEARCH_OUTPUT_SCHEMA, 0)}>`;
}

/**
 * The one-line call form of search: the path plus a placeholder per field, all
 * derived from `SEARCH_INPUT_SCHEMA`. For prose that cannot afford the multi-line
 * block — error messages, which must still name a shape the host accepts.
 */
export function renderSearchCallForm(): string {
  const properties = SEARCH_INPUT_SCHEMA.properties as Record<string, unknown>;
  const fields = Object.keys(properties)
    .map((key) => `${renderKey(key)}: ${placeholderFor(properties[key])}`)
    .join(", ");
  return `${EXEC_SEARCH_EXPRESSION}({ ${fields} })`;
}

/** A resolved search call: what to match on and how many hits to allow. */
export interface ExecSearchArgs {
  /** Lower-cased keyword query. Empty when the caller omitted it. */
  query: string;
  /** Exact names named by a `select:` query, in the order given. */
  select?: string[];
  maxResults: number;
}

/** `select:<name>[,<name>...]` — an exact-name query rather than a keyword one. */
const SELECT_PREFIX = "select:";

/**
 * Validate a search call's arguments against `SEARCH_INPUT_SCHEMA` and resolve
 * them into a match plan.
 *
 * The sandbox only guarantees a plain object (see `callHost`); it knows nothing
 * about this schema, so a call naming a field the schema does not have must fail
 * loudly here. Treating `{ q: "..." }` as an empty query would answer "here is the
 * whole pool" and dress a typo up as a successful search.
 */
export function resolveSearchArgs(
  args: Record<string, unknown>,
): ExecSearchArgs {
  const unexpected = Object.keys(args).find(
    (key) => !SEARCH_INPUT_KEYS.includes(key),
  );
  if (unexpected !== undefined) {
    throw new Error(
      `${EXEC_SEARCH_NAME}() does not take "${unexpected}". Expected ${renderSearchCallForm()}`,
    );
  }

  const rawQuery = args.query;
  if (rawQuery !== undefined && typeof rawQuery !== "string") {
    throw new Error(
      `${EXEC_SEARCH_NAME}() expects "query" to be a string, got ${typeof rawQuery}. Expected ${renderSearchCallForm()}`,
    );
  }
  const query = (rawQuery ?? "").trim();

  const rawMax = args.max_results;
  if (rawMax !== undefined && typeof rawMax !== "number") {
    throw new Error(
      `${EXEC_SEARCH_NAME}() expects "max_results" to be a number, got ${typeof rawMax}. Expected ${renderSearchCallForm()}`,
    );
  }
  const maxResults =
    rawMax === undefined
      ? EXEC_SEARCH_DEFAULT_MAX_RESULTS
      : Math.max(
          1,
          Math.min(EXEC_SEARCH_MAX_RESULTS_LIMIT, Math.floor(rawMax) || 1),
        );

  if (query.toLowerCase().startsWith(SELECT_PREFIX)) {
    const select = query
      .slice(SELECT_PREFIX.length)
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    return { query: "", select, maxResults };
  }

  return { query: query.toLowerCase(), maxResults };
}

/** One hit. `signature` is what makes the hit callable without another round. */
export interface ExecSearchHit {
  name: string;
  description?: string;
  signature: string;
}

/** What a search call resolves to. See `SEARCH_OUTPUT_SCHEMA`. */
export interface ExecSearchResult {
  matches: ExecSearchHit[];
  total: number;
}

/** Words inside a tool name: `mcp__github__create_issue` → mcp, github, create, issue. */
const NAME_SEPARATORS = /[^a-z0-9]+/;

function nameSegments(name: string): string[] {
  return name.toLowerCase().split(NAME_SEPARATORS).filter(Boolean);
}

/**
 * How well one entry matches one query, or 0 when it does not.
 *
 * Only ever called with at least one term: "no query" is not a query that matches
 * nothing, it is a request for the whole pool, and it is answered without scoring
 * (see `searchPool`).
 *
 * The scale is the contract, not the numbers: an exact name beats a whole name
 * word beats a name substring, and all three beat a hit in the curated hint,
 * which in turn beats a hit in the full description. The model usually arrives
 * with a name in hand (it read the announcement), so name matches must win;
 * description matches exist so a model that only knows what it wants to *do* can
 * still find the tool.
 *
 * Every keyword must match somewhere — the sum is only taken when no term came up
 * empty. Otherwise "create issue" would return everything that mentions "create".
 */
function scoreEntry(entry: ExecPoolEntry, terms: readonly string[]): number {
  const name = entry.name.toLowerCase();
  const segments = nameSegments(name);
  const hint = (entry.searchHint ?? "").toLowerCase();
  const description = (entry.description ?? "").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name === term) {
      score += 100;
    } else if (segments.includes(term)) {
      score += 60;
    } else if (name.includes(term)) {
      score += 40;
    } else if (hint.includes(term)) {
      score += 25;
    } else if (description.includes(term)) {
      score += 15;
    } else {
      return 0;
    }
  }
  // An MCP name carries the server and the tool, so the model is guessing at two
  // words it did not choose; a built-in name is one word it already knows.
  if (entry.isMcp === true) score += 5;
  return score;
}

/**
 * Answer one search call against the whole pool.
 *
 * Never throws for "no match": an empty result is an answer, and the model acts on
 * it. A `select:` query returns exactly the names it named (in the order named)
 * and ignores the limit — naming tools is not fuzzy matching, and capping it would
 * make "these ones please" inexpressible.
 *
 * Ordering is a pure function of the pool and the query: score descending, then
 * name ascending. Nothing about connection state or arrival order leaks in, so the
 * same query against the same pool always answers the same way.
 */
export function searchPool(
  pool: readonly ExecPoolEntry[],
  args: ExecSearchArgs,
): ExecSearchResult {
  if (args.select) {
    const byName = new Map(
      pool.map((entry) => [entry.name.toLowerCase(), entry]),
    );
    const matches: ExecSearchHit[] = [];
    for (const requested of args.select) {
      const entry = byName.get(requested.toLowerCase());
      if (entry && !matches.some((hit) => hit.name === entry.name)) {
        matches.push(toHit(entry));
      }
    }
    return { matches, total: matches.length };
  }

  const terms = args.query.split(/\s+/).filter(Boolean);
  const scored = (
    terms.length === 0
      ? // An empty query lists the pool rather than searching it, so nothing is
        // filtered out — scoring an empty term list would keep only the entries that
        // happen to earn the MCP tie-break bonus.
        pool.map((entry) => ({ entry, score: 0 }))
      : pool
          .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
          .filter((candidate) => candidate.score > 0)
  ).sort((left, right) =>
    left.score !== right.score
      ? right.score - left.score
      : left.entry.name < right.entry.name
        ? -1
        : left.entry.name > right.entry.name
          ? 1
          : 0,
  );

  return {
    matches: scored.slice(0, args.maxResults).map(({ entry }) => toHit(entry)),
    total: scored.length,
  };
}

function toHit(entry: ExecPoolEntry): ExecSearchHit {
  return {
    name: entry.name,
    description: entry.description,
    signature: renderToolSignature(entry),
  };
}
