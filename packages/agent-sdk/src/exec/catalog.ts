/**
 * The Exec catalog: which MCP tools exist, how they are rendered, how that
 * rendering is budgeted, and the shape of the sandbox's `search` entry point.
 *
 * "Rendered" means into the catalog announcement (`exec/catalogAnnouncement.ts`),
 * not into `Exec`'s tool description: the description has to stay a
 * pool-independent constant, or every server that connects rewrites the cached
 * prefix. This module produces the entries; the announcement wraps them.
 *
 * This module is the single source of truth for "what the sandbox may reach".
 * The hard constraint is that the pool must equal the tools the agent could
 * already call directly — if a tool were reachable from the sandbox but hidden
 * from the agent, Exec would be a permission-escalation channel.
 *
 * The same reasoning applies to `search`: its call form is written once, as a
 * schema, and both the model-visible prose and the host-side validation derive
 * from that one object. Teaching a form in prose while accepting a different one
 * in code is a bug with no diff to review.
 */
import type { McpManager } from "../managers/mcpManager.js";
import type { PermissionManager } from "../managers/permissionManager.js";
import { EXEC_RESERVED_NAMESPACE } from "./constants.js";

export interface ExecPoolEntry {
  /** Flattened `mcp__<server>__<tool>` name — the key on the sandbox `tools` object. */
  name: string;
  description?: string;
  /** Raw MCP input schema (JSON Schema), used only to render a compact signature. */
  inputSchema?: Record<string, unknown>;
  /**
   * The schema the server declared for this tool's output, rendered as the
   * signature's return type. Absent for most servers today; a tool without one
   * still gets a return type (`Promise<unknown>`), because leaving it out would
   * read as "this call returns nothing".
   */
  outputSchema?: Record<string, unknown>;
}

/**
 * Recursion ceiling for signature rendering. Object, array and union recursion all
 * increment depth, so this bounds every path: a pathological or structurally cyclic
 * schema degrades to `unknown` instead of overflowing the stack. Rendering must
 * never throw.
 *
 * This is the *only* silent reduction left in the renderer — there is deliberately
 * no cap on properties per level or on enum variants. A wide schema or a long enum
 * is decision-relevant text, and truncating it is how the model ends up guessing
 * which parameter or which variant to use. Depth 8 and `unknown` are opencode's
 * values (`tool-schema.ts`, `MAX_RENDER_DEPTH`).
 */
const MAX_SIGNATURE_DEPTH = 8;
/** Cap a rendered *tool* description at one line of this length. */
const MAX_DESCRIPTION_CHARS = 120;

/** A property name that can be written bare in TypeScript. */
const IDENTIFIER_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Budget accounting for the catalog, in estimated tokens.
 *
 * Applied to a whole catalog entry, which is a multi-line block: its newlines
 * and indentation are part of `text.length`, so `chars / 4` already covers them.
 *
 * A plain `chars / 4`, same basis as opencode's `catalogBudget`. Deliberately
 * not the CJK-aware `utils/tokenEstimate`: MCP tool descriptions are
 * overwhelmingly English, so telling CJK from Latin text would not move the
 * result in practice.
 */
const estimateCatalogTokens = (text: string) => Math.round(text.length / 4);

/**
 * Every MCP tool the current agent may call, in catalog form.
 *
 * Derived from `getMcpToolsConfig()` — the exact source that produces the flat
 * `tools[]` declarations when the pool is not collapsed, and the one whose
 * connected/reconnecting filtering already keeps a transient disconnect from
 * churning the tool list. So "the catalog equals what would have been declared"
 * holds structurally, not by parallel construction.
 */
export function buildExecPool(
  mcpManager: McpManager,
  permissionManager?: PermissionManager,
): ExecPoolEntry[] {
  const outputSchemas = mcpManager.getMcpToolOutputSchemas();
  const entries: ExecPoolEntry[] = [];
  for (const tool of mcpManager.getMcpToolsConfig()) {
    if (permissionManager?.isToolDenied(tool.function.name)) continue;
    entries.push({
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: tool.function.parameters as
        | Record<string, unknown>
        | undefined,
      outputSchema: outputSchemas.get(tool.function.name),
    });
  }
  return entries;
}

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
 * Trim a *tool* description to its first line and cap its length.
 *
 * Only tool-level prose is compressed here: it is padding that the model does not
 * need to act, and the full text stays reachable through search. Field descriptions
 * are never clamped (see `jsdoc`) — those carry the decision guidance.
 */
function clampDescription(text: string): string {
  const first = text.split("\n")[0].trim();
  return first.length > MAX_DESCRIPTION_CHARS
    ? `${first.slice(0, MAX_DESCRIPTION_CHARS - 3)}...`
    : first;
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
 * so cutting it at a fixed column cuts the guidance and keeps the preamble. Only
 * the tool's own description is clamped (see `clampDescription`); when a model
 * needs that one in full it searches the pool by name.
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
    if (names.length > 0) return names.join(" | ");
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

  return typeof typed.type === "string" ? typed.type : "unknown";
}

/**
 * The callable signature for one tool: parameters and return type. The catalog and
 * search results share it, so the model can copy either one verbatim.
 *
 * The return type comes from the schema the server declared for its output, and a
 * tool that declared none still gets `Promise<unknown>` rather than no return type
 * at all: the sandbox resolves every call to the tool's output (its structured
 * content, else its text, else `null`), and a signature ending at the parameters
 * would read as "calls this, get nothing". Rendering it from the same rule the
 * runtime applies is what keeps the catalog from teaching a shape the host will
 * not deliver.
 */
export function renderToolSignature(entry: ExecPoolEntry): string {
  return `${toolExpression(entry.name)}(${renderType(entry.inputSchema, 0)}): Promise<${renderType(entry.outputSchema, 0)}>`;
}

/**
 * The path the sandbox exposes search under. Built from the reserved namespace
 * (the sandbox builds it the same way), so prose and runtime cannot drift.
 */
const SEARCH_EXPRESSION = `tools[${JSON.stringify(EXEC_RESERVED_NAMESPACE)}].search`;

/**
 * Input schema of the sandbox's `search` entry point.
 *
 * Load-bearing: the call form in the tool description, the call form in error
 * messages and the validation `resolveSearchQuery` runs all come from this object.
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
        "Substring matched against tool names and descriptions, case-insensitively. Omit it (or pass an empty string) to list the entire pool.",
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
 */
const SEARCH_OUTPUT_SCHEMA: Record<string, unknown> = {
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
 * every catalog entry, so its shape cannot drift from what the host accepts or
 * returns. Multi-line, for the sandbox API blurb where there is room to show the
 * field docs.
 */
export function renderSearchSignature(): string {
  return `${SEARCH_EXPRESSION}(${renderType(SEARCH_INPUT_SCHEMA, 0)}): Promise<${renderType(SEARCH_OUTPUT_SCHEMA, 0)}>`;
}

/**
 * The one-line call form of search: the path plus a placeholder per field, all
 * derived from `SEARCH_INPUT_SCHEMA`. For prose that cannot afford the multi-line
 * block — the catalog's `PARTIAL` notice and error messages, which must still name
 * a shape the host accepts.
 */
export function renderSearchCallForm(): string {
  const properties = SEARCH_INPUT_SCHEMA.properties as Record<string, unknown>;
  const fields = Object.keys(properties)
    .map((key) => `${renderKey(key)}: ${placeholderFor(properties[key])}`)
    .join(", ");
  return `${SEARCH_EXPRESSION}({ ${fields} })`;
}

/**
 * Validate a search call's arguments against `SEARCH_INPUT_SCHEMA` and return the
 * query to match on.
 *
 * The sandbox only guarantees a plain object (see `callHost`); it knows nothing
 * about this schema, so a call naming a field the schema does not have must fail
 * loudly here. Treating `{ q: "..." }` as an empty query would answer "here is the
 * whole pool" and dress a typo up as a successful search.
 */
export function resolveSearchQuery(args: Record<string, unknown>): string {
  const unexpected = Object.keys(args).find(
    (key) => !SEARCH_INPUT_KEYS.includes(key),
  );
  if (unexpected !== undefined) {
    throw new Error(
      `search() does not take "${unexpected}". Expected ${renderSearchCallForm()}`,
    );
  }
  const query = args.query;
  if (query === undefined) return "";
  if (typeof query !== "string") {
    throw new Error(
      `search() expects "query" to be a string, got ${typeof query}. Expected ${renderSearchCallForm()}`,
    );
  }
  return query.trim().toLowerCase();
}

/**
 * A single catalog entry: its signature (possibly several lines) followed by the
 * first line of its description.
 */
export function renderCatalogEntry(entry: ExecPoolEntry): string {
  const signature = renderToolSignature(entry);
  const description = clampDescription(entry.description ?? "");
  return description ? `${signature} // ${description}` : signature;
}

export interface RenderedCatalog {
  text: string;
  /** How many entries actually appear in `text`. */
  shown: number;
  total: number;
  /** True when the budget forced entries out. Never silent. */
  truncated: boolean;
  /**
   * Per-server tool counts, in pool order. The rendered entries cannot tell a later
   * turn what moved — the announcement diff is count-level — so the snapshot is
   * handed back here rather than recovered by parsing `text`.
   */
  namespaces: Array<{ name: string; count: number; shown: number }>;
}

/**
 * The one-line index of a server: `- mcp__github (40 tools, 13 shown)`. The tail
 * is dropped when the server is fully shown, and reads `none shown` when it got
 * no seat at all.
 *
 * The prefix is the flattened name's, not the routing key alone, so the line is a
 * substring of every tool name it covers (and of what search matches on). For a
 * server whose name itself contains `__` the key is only the first segment — the
 * same pre-existing ambiguity the grouping key has (see `execNamespace`).
 *
 * Exported for the announcement's per-namespace delta lines: the same renderer for
 * the same counts, so a summary line and a delta line cannot drift apart.
 */
export function summarizeNamespace(
  name: string,
  count: number,
  shownCount: number,
): string {
  const label = `${count} tool${count === 1 ? "" : "s"}`;
  const detail =
    shownCount === count
      ? ""
      : shownCount === 0
        ? ", none shown"
        : `, ${shownCount} shown`;
  return `- mcp__${name} (${label}${detail})`;
}

/**
 * The server a flat MCP tool name routes to. Mirrors the split `executeMcpTool`
 * does on the way back (`parts[1]`), so a group key always agrees with where a
 * call would actually go — including its behaviour for server names that
 * themselves contain `__`.
 */
function execNamespace(name: string): string {
  return name.split("__")[1] ?? name;
}

/**
 * Cheapest rendered block first, ties broken by tool name.
 *
 * The rotation takes each server's next unshown entry every round, so this order
 * *is* the seat order: cheapest-first means one budget buys the most entries, and
 * the tie-break keeps the result a pure function of the entries themselves — the
 * order `tools/list` happened to return is not a reason to seat one tool first.
 * opencode ranks its listings the same way (`rankListings`: cost, then path).
 */
function orderByCost(group: ExecPoolEntry[]): ExecPoolEntry[] {
  return [...group].sort((left, right) => {
    const delta =
      estimateCatalogTokens(renderCatalogEntry(left)) -
      estimateCatalogTokens(renderCatalogEntry(right));
    if (delta !== 0) return delta;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
}

/** Groups in order of first appearance; within a group, cheapest block first. */
function groupByNamespace(entries: ExecPoolEntry[]): ExecPoolEntry[][] {
  const groups = new Map<string, ExecPoolEntry[]>();
  for (const entry of entries) {
    const namespace = execNamespace(entry.name);
    const group = groups.get(namespace);
    if (group) {
      group.push(entry);
    } else {
      groups.set(namespace, [entry]);
    }
  }
  return [...groups.values()].map(orderByCost);
}

/**
 * Render the catalog within an estimated-token budget.
 *
 * Selection round-robins across servers: one entry per server per round, so
 * every server gets a seat before any server gets its second. A plain first-N
 * cut would drop whole servers that happen to be connected later, and the model
 * reads a missing server as "those tools do not exist" — the failure mode this
 * whole feature has to avoid.
 *
 * An entry is a whole multi-line block and is budgeted and placed atomically: a
 * server either gets the block this round or sits the round out, never half a
 * signature.
 *
 * A truncated catalog additionally prints one summary line per server (see
 * `summarizeNamespace`), before that server's blocks and outside the budget.
 *
 * The truncation notice deliberately carries no budget number: the budget is a
 * tuning knob, and rendering it would make an unchanged tool pool produce
 * different model-visible text after a config change.
 */
export function renderCatalog(
  entries: ExecPoolEntry[],
  budgetTokens: number,
): RenderedCatalog {
  const groups = groupByNamespace(entries);
  const picked: string[][] = groups.map(() => []);
  let used = 0;
  let shown = 0;

  let active = groups.map((_, index) => index);
  while (active.length > 0) {
    const stillActive: number[] = [];
    for (const index of active) {
      const group = groups[index];
      const entry = group[picked[index].length];
      if (entry === undefined) continue;
      const block = renderCatalogEntry(entry);
      const cost = estimateCatalogTokens(block) + 1;
      // The very first entry is always shown even if it alone is over budget:
      // an empty catalog would be worse than an over-budget one.
      if (shown > 0 && used + cost > budgetTokens) continue;
      picked[index].push(block);
      used += cost;
      shown += 1;
      if (picked[index].length < group.length) stillActive.push(index);
    }
    active = stillActive;
  }

  const truncated = shown < entries.length;

  // Rotation alone cannot promise any server a seat — a group whose block does
  // not fit the remaining budget sits the round out for good — so a truncated
  // catalog also names every server, one line each, outside the budget. Without
  // that line a server nobody picked is invisible, and "not in the catalog" is
  // read as "that capability does not exist". An untruncated catalog skips them:
  // the entries are already the index.
  const lines: string[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    if (truncated) {
      const group = groups[index];
      lines.push(
        summarizeNamespace(
          execNamespace(group[0].name),
          group.length,
          picked[index].length,
        ),
      );
    }
    lines.push(...picked[index]);
  }

  if (truncated) {
    // Counts only: the call form that reaches the rest is taught once, in the
    // announcement's search section, which exists in exactly this state. Writing it
    // here as well would give the same call two spellings to drift between.
    lines.push(`PARTIAL — ${shown} of ${entries.length} tools shown.`);
  }

  return {
    text: lines.join("\n"),
    shown,
    total: entries.length,
    truncated,
    namespaces: groups.map((group, index) => ({
      name: execNamespace(group[0].name),
      count: group.length,
      shown: picked[index].length,
    })),
  };
}
