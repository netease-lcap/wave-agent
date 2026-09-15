/**
 * The Exec catalog: which MCP tools exist, how they are rendered into the tool
 * description, and how that rendering is budgeted.
 *
 * This module is the single source of truth for "what the sandbox may reach".
 * The hard constraint is that the pool must equal the tools the agent could
 * already call directly — if a tool were reachable from the sandbox but hidden
 * from the agent, Exec would be a permission-escalation channel.
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
}

/** Cap recursion so a deeply nested schema cannot blow up the catalog. */
const MAX_SIGNATURE_DEPTH = 3;
/** Cap rendered properties per object level; the rest collapse to `...`. */
const MAX_SIGNATURE_PROPS = 8;
/** Cap rendered enum variants per field. */
const MAX_ENUM_VARIANTS = 6;
/** Cap a rendered description (tool or field) at one line of this length. */
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
  const entries: ExecPoolEntry[] = [];
  for (const tool of mcpManager.getMcpToolsConfig()) {
    if (permissionManager?.isToolDenied(tool.function.name)) continue;
    entries.push({
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: tool.function.parameters as
        | Record<string, unknown>
        | undefined,
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

/** Trim a description to its first line and cap its length. */
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
 */
function jsdoc(schema: unknown, pad: string): string {
  const lines: string[] = [];
  const description =
    schema && typeof schema === "object" && !Array.isArray(schema)
      ? (schema as Record<string, unknown>).description
      : undefined;
  if (typeof description === "string") {
    const first = clampDescription(description);
    if (first !== "") lines.push(first);
  }
  lines.push(...docTags(schema));
  if (lines.length === 0) return "";
  // A `*/` inside third-party text would close the comment early. Split/join
  // rather than `replaceAll`: these packages compile against lib ES2020.
  const safe = lines.map((line) => line.split("*/").join("* /"));
  if (safe.length === 1) return `${pad}/** ${safe[0]} */\n`;
  const body = safe
    .map((line) => `${pad} *${line === "" ? "" : ` ${line}`}`)
    .join("\n");
  return `${pad}/**\n${body}\n${pad} */\n`;
}

/**
 * Render a JSON Schema as TypeScript: a multi-line block whose fields each carry
 * their own JSDoc. Depth, per-level property count and enum variants are capped.
 */
function renderType(schema: unknown, depth: number): string {
  if (depth > MAX_SIGNATURE_DEPTH) return "any";
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return "any";
  }
  const typed = schema as Record<string, unknown>;

  if (Array.isArray(typed.enum)) {
    const variants = typed.enum
      .slice(0, MAX_ENUM_VARIANTS)
      .map((value) => JSON.stringify(value) ?? "null");
    if (typed.enum.length > MAX_ENUM_VARIANTS) variants.push("...");
    return variants.join(" | ");
  }

  const union = Array.isArray(typed.anyOf)
    ? (typed.anyOf as unknown[])
    : Array.isArray(typed.oneOf)
      ? (typed.oneOf as unknown[])
      : undefined;
  if (union) {
    return union
      .slice(0, 4)
      .map((variant) => renderType(variant, depth + 1))
      .join(" | ");
  }

  if (Array.isArray(typed.type)) {
    const names = (typed.type as unknown[]).filter(
      (value): value is string => typeof value === "string",
    );
    if (names.length > 0) return names.join(" | ");
    return "any";
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
    const lines = keys
      .slice(0, MAX_SIGNATURE_PROPS)
      .map(
        (key) =>
          `${jsdoc(properties[key], pad)}${pad}${renderKey(key)}${required.has(key) ? "" : "?"}: ${renderType(properties[key], depth + 1)},`,
      );
    if (keys.length > MAX_SIGNATURE_PROPS) lines.push(`${pad}...`);
    return `{\n${lines.join("\n")}\n${close}}`;
  }

  return typeof typed.type === "string" ? typed.type : "any";
}

/**
 * The callable signature for one tool. The catalog and search results share it,
 * so the model can copy either one verbatim.
 */
export function renderToolSignature(entry: ExecPoolEntry): string {
  return `${toolExpression(entry.name)}(${renderType(entry.inputSchema, 0)})`;
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

/** Pool order within a group; groups in order of first appearance. */
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
  return [...groups.values()];
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

  const blocks = picked.flat();

  const truncated = shown < entries.length;
  if (truncated) {
    blocks.push(
      `PARTIAL — ${shown} of ${entries.length} tools shown. ` +
        `Use tools["${EXEC_RESERVED_NAMESPACE}"].search("...") to find the rest; ` +
        `search covers the full pool.`,
    );
  }

  return {
    text: blocks.join("\n"),
    shown,
    total: entries.length,
    truncated,
  };
}
