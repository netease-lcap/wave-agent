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
/** Cap rendered properties per object level; the rest become `...`. */
const MAX_SIGNATURE_PROPS = 8;
/** Cap rendered enum variants per field. */
const MAX_ENUM_VARIANTS = 6;

/**
 * Budget accounting for the catalog, in estimated tokens.
 *
 * A plain `chars / 4`, same basis as opencode's `catalogBudget`. Deliberately
 * not the CJK-aware `utils/tokenEstimate`: MCP tool descriptions are
 * overwhelmingly English, so telling CJK from Latin text would not move the
 * result in practice.
 */
const estimateCatalogTokens = (line: string) => Math.round(line.length / 4);

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
    return `${renderType(typed.items, depth + 1)}[]`;
  }

  if (typed.type === "object" || typed.properties) {
    const properties = (typed.properties ?? {}) as Record<string, unknown>;
    const required = new Set(
      Array.isArray(typed.required) ? (typed.required as string[]) : [],
    );
    const keys = Object.keys(properties);
    const rendered = keys
      .slice(0, MAX_SIGNATURE_PROPS)
      .map(
        (key) =>
          `${key}${required.has(key) ? "" : "?"}: ${renderType(properties[key], depth + 1)}`,
      );
    if (keys.length > MAX_SIGNATURE_PROPS) rendered.push("...");
    return `{ ${rendered.join(", ")} }`;
  }

  return typeof typed.type === "string" ? typed.type : "any";
}

/**
 * A single catalog line. Non-identifier keys are shown in bracket form because
 * `tools.mcp__my-srv__x` would parse as a subtraction.
 */
export function renderCatalogEntry(entry: ExecPoolEntry): string {
  const accessor = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry.name)
    ? `tools.${entry.name}`
    : `tools[${JSON.stringify(entry.name)}]`;
  const signature = renderType(entry.inputSchema, 0);
  const description = (entry.description ?? "").split("\n")[0].trim();
  return description
    ? `${accessor}(${signature}) // ${description}`
    : `${accessor}(${signature})`;
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
 * Render the catalog within an estimated-token budget.
 *
 * The truncation notice deliberately carries no budget number: the budget is a
 * tuning knob, and rendering it would make an unchanged tool pool produce
 * different model-visible text after a config change.
 */
export function renderCatalog(
  entries: ExecPoolEntry[],
  budgetTokens: number,
): RenderedCatalog {
  const lines: string[] = [];
  let used = 0;
  let shown = 0;

  for (const entry of entries) {
    const line = renderCatalogEntry(entry);
    const cost = estimateCatalogTokens(line) + 1;
    if (shown > 0 && used + cost > budgetTokens) break;
    lines.push(line);
    used += cost;
    shown += 1;
  }

  const truncated = shown < entries.length;
  if (truncated) {
    lines.push(
      `PARTIAL — ${shown} of ${entries.length} tools shown. ` +
        `Use tools["${EXEC_RESERVED_NAMESPACE}"].search("...") to find the rest; ` +
        `search covers the full pool.`,
    );
  }

  return { text: lines.join("\n"), shown, total: entries.length, truncated };
}
