/**
 * Tool catalog: the compact, deterministic text that stands in for the
 * per-tool JSON Schema declarations of deferred tools.
 *
 * Everything here is a pure function of (tool pool, budget config): the same
 * pool must render byte-identical text on every call, because the catalog is
 * part of `ToolInvoke`'s description and therefore part of the request prefix
 * (see `docs/specs/core/tool-deferred-loading.md`, "目录内容契约" 与
 * [`core/prompt-cache-control.md`](../../../../docs/specs/core/prompt-cache-control.md)).
 * No clock, no call history, no container lookups — callers pass the pool in.
 *
 * Signature rendering rules are the ones the admission gate measured
 * (`scripts/catalog-proxy-probe/catalog.mjs`): types + required/optional +
 * enum values + defaults + two levels of nesting. Do not make them cheaper
 * without re-running the gate — the gate's first-try success rate is the
 * evidence for these rules.
 */

import { estimateTokens } from "./tokenEstimate.js";

/** Reserved namespace for built-in tools (`builtin.Read`). */
export const RESERVED_BUILTIN_NAMESPACE = "builtin";

/** Resident catalog budget in tokens (spec default; `estimateTokens` denominated). */
export const CATALOG_DEFAULT_BUDGET_TOKENS = 6000;

/**
 * Per-description clip, in tokens (never characters: the same character cap
 * truncates a Chinese description ~4x harder than an English one).
 * Size-control guard only — the admission gate ran unclipped descriptions, so
 * this does not participate in the fidelity result.
 */
export const CATALOG_DESCRIPTION_MAX_TOKENS = 400;

/** Nesting levels expanded into the signature before the entry degrades. */
export const CATALOG_MAX_SIGNATURE_DEPTH = 2;

/** Default page size for `ToolSearch` (result volume must stay bounded). */
export const TOOL_SEARCH_DEFAULT_LIMIT = 10;

/**
 * One deferred tool, as addressed by `ToolInvoke` / `ToolSearch`.
 */
export interface CatalogTool {
  /** Addressing namespace: MCP server name, or `builtin` for built-in tools. */
  namespace: string;
  /** Tool name as passed in `ToolInvoke`'s `tool` field. */
  tool: string;
  /**
   * Leaf name: the identity used for execution, permission rules and result
   * rendering (`mcp__server__tool` or the built-in tool name). Never derived
   * here — callers pass the name the registry already uses.
   */
  leafName: string;
  /** Static tool description (`config.function.description`). */
  description: string;
  /** JSON Schema of the tool parameters. */
  parameters?: Record<string, unknown>;
}

export interface RenderCatalogOptions {
  /** Resident budget in tokens. Defaults to {@link CATALOG_DEFAULT_BUDGET_TOKENS}. */
  budgetTokens?: number;
  /** Nesting levels expanded into signatures. Defaults to {@link CATALOG_MAX_SIGNATURE_DEPTH}. */
  maxDepth?: number;
  /** Per-description clip. Defaults to {@link CATALOG_DESCRIPTION_MAX_TOKENS}. */
  descriptionMaxTokens?: number;
}

export interface CatalogRenderResult {
  /** The full catalog text, header lines included. */
  text: string;
  /** True when every entry fit in the budget. */
  complete: boolean;
  /** Entries present in the resident catalog. */
  shownTools: number;
  /** Entries in the complete catalog (resident + search-only). */
  totalTools: number;
  /** Namespaces with at least one entry, in catalog order. */
  namespaces: string[];
  /** Estimated cost of {@link text}. */
  tokens: number;
}

export interface SearchCatalogOptions {
  query: string;
  limit?: number;
  offset?: number;
  maxDepth?: number;
  descriptionMaxTokens?: number;
}

export interface CatalogSearchResult {
  text: string;
  /** Entries returned by this page. */
  returned: number;
  /** Entries in the complete catalog matching the query. */
  totalMatches: number;
  /** Offset to pass to the next call, when more matches exist. */
  nextOffset?: number;
}

/** `<namespace>.<tool>` — the address a model must pass to `ToolInvoke`. */
export function formatToolAddress(tool: CatalogTool): string {
  return `${tool.namespace}.${tool.tool}`;
}

/** A rendered signature plus whether part of its structure was clamped away. */
export interface RenderedSignature {
  /** Inside-the-parens form, e.g. `file_path: string, offset?: number`. */
  text: string;
  /** True when nested structure was clamped (the entry must degrade explicitly). */
  degraded: boolean;
}

/**
 * Render a tool's parameter signature.
 *
 * `text` is empty for a tool that declares no parameters — the caller renders
 * that as `tool()` (an empty parameter list is the explicit "no arguments"
 * form; the tool must still be listed).
 */
export function renderToolSignature(
  parameters: Record<string, unknown> | undefined,
  options: { maxDepth?: number } = {},
): RenderedSignature {
  const maxDepth = options.maxDepth ?? CATALOG_MAX_SIGNATURE_DEPTH;
  const state = { degraded: false };
  const text = renderObject(parameters ?? {}, 0, maxDepth, state);
  // renderObject returns `{...}`; the catalog notation puts the fields directly
  // inside the call parens.
  return { text: text.slice(1, -1), degraded: state.degraded };
}

interface RenderState {
  degraded: boolean;
}

function renderObject(
  schema: Record<string, unknown>,
  depth: number,
  maxDepth: number,
  state: RenderState,
): string {
  const properties = asRecord(schema.properties) ?? {};
  const required = Array.isArray(schema.required)
    ? schema.required.map((value) => String(value))
    : [];
  const parts: string[] = [];
  for (const [key, propSchema] of Object.entries(properties)) {
    const optional = required.includes(key) ? "" : "?";
    const schemaRecord = asRecord(propSchema) ?? {};
    const defaultSuffix =
      "default" in schemaRecord
        ? `=${JSON.stringify(schemaRecord.default)}`
        : "";
    parts.push(
      `${key}${optional}: ${renderType(schemaRecord, depth, maxDepth, state)}${defaultSuffix}`,
    );
  }
  return `{${parts.join(", ")}}`;
}

function renderType(
  schema: Record<string, unknown>,
  depth: number,
  maxDepth: number,
  state: RenderState,
): string {
  const type = schema.type;
  if (Array.isArray(type)) {
    return type
      .map((candidate) =>
        renderType({ ...schema, type: candidate }, depth, maxDepth, state),
      )
      .join("|");
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => JSON.stringify(value)).join("|");
  }
  if (type === "object") {
    const properties = asRecord(schema.properties) ?? {};
    const additional = asRecord(schema.additionalProperties);
    if (Object.keys(properties).length === 0 && additional) {
      return `map<string, ${renderType(additional, depth, maxDepth, state)}>`;
    }
    if (depth >= maxDepth) {
      // Explicit degradation: the key list is shown, the structure is not.
      state.degraded = true;
      const keys = Object.keys(properties);
      return `{${keys.length > 0 ? `${keys.join(", ")}, ...` : "..."}}`;
    }
    return renderObject(schema, depth + 1, maxDepth, state);
  }
  if (type === "array") {
    const itemSchema = asRecord(schema.items) ?? {};
    const bounds = [
      typeof schema.minItems === "number" ? `minItems=${schema.minItems}` : "",
      typeof schema.maxItems === "number" ? `maxItems=${schema.maxItems}` : "",
    ]
      .filter(Boolean)
      .join(",");
    return `array<${renderType(itemSchema, depth, maxDepth, state)}${bounds ? `, ${bounds}` : ""}>`;
  }
  if (type === "string" && schema.minLength) {
    return `string(minLength=${String(schema.minLength)})`;
  }
  if (type === "integer") {
    const bounds = [
      typeof schema.minimum === "number" ? `min=${schema.minimum}` : "",
      typeof schema.maximum === "number" ? `max=${schema.maximum}` : "",
    ]
      .filter(Boolean)
      .join(",");
    return bounds ? `integer(${bounds})` : "integer";
  }
  return typeof type === "string" ? type : "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Clip a description to a token budget (never to a character count). */
function clipDescription(description: string, maxTokens: number): string {
  if (estimateTokens(description) <= maxTokens) return description;
  let low = 0;
  let high = description.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(description.slice(0, mid)) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  return `${description.slice(0, low)}…`;
}

/** Degradation marker required when a signature could not be fully expressed. */
export const CATALOG_DEGRADED_NOTE =
  "[parameters: nested structure omitted — consult the full tool schema]";

/** Render one entry: `<namespace>.<tool>(签名) // 描述`. */
export function renderCatalogEntry(
  tool: CatalogTool,
  options: { maxDepth?: number; descriptionMaxTokens?: number } = {},
): string {
  const { text: signature, degraded } = renderToolSignature(tool.parameters, {
    maxDepth: options.maxDepth,
  });
  const description = clipDescription(
    tool.description.trim(),
    options.descriptionMaxTokens ?? CATALOG_DESCRIPTION_MAX_TOKENS,
  );
  const notes = [description, degraded ? CATALOG_DEGRADED_NOTE : ""].filter(
    Boolean,
  );
  const suffix = notes.length > 0 ? ` // ${notes.join(" ")}` : "";
  return `${formatToolAddress(tool)}(${signature})${suffix}`;
}

/**
 * Fixed completeness header. The budget number deliberately never appears:
 * it is an operational knob with no value to the model, and putting it in
 * model-visible text would make the text drift whenever the budget is tuned.
 */
export function renderCatalogHeader(shown: number, total: number): string {
  if (shown >= total) {
    return `COMPLETE — all ${total} tools shown`;
  }
  return [
    `PARTIAL — ${shown} of ${total} tools shown`,
    `Not shown: ${total - shown} tools — call ToolSearch to find them.`,
  ].join("\n");
}

const CATALOG_PREAMBLE =
  "Deferred tools are callable through ToolInvoke({namespace, tool, args}); the signature after each name lists the arguments the target tool expects.";

/** Deterministic pool order: by namespace, then by tool name. */
function sortedGroups(tools: CatalogTool[]): {
  namespace: string;
  tools: CatalogTool[];
}[] {
  const byLeaf = new Map<string, CatalogTool>();
  for (const tool of tools) {
    if (!byLeaf.has(tool.leafName)) byLeaf.set(tool.leafName, tool);
  }
  const byNamespace = new Map<string, CatalogTool[]>();
  for (const tool of byLeaf.values()) {
    const bucket = byNamespace.get(tool.namespace);
    if (bucket) bucket.push(tool);
    else byNamespace.set(tool.namespace, [tool]);
  }
  return [...byNamespace.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([namespace, bucket]) => ({
      namespace,
      tools: bucket.sort((a, b) =>
        a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0,
      ),
    }));
}

/** `github: 24 tools` — the per-namespace representative line. */
export function renderNamespaceLine(namespace: string, count: number): string {
  return `${namespace}: ${count} tools`;
}

/**
 * Diagnostic text for a `ToolInvoke` naming something outside the complete
 * catalog: say what was asked for, then list what is actually addressable so
 * the model can correct itself instead of guessing again (「目录外能力必须拒绝」
 * requires the failure to name the available capabilities).
 */
export function renderUnknownTargetMessage(
  tools: CatalogTool[],
  namespace: string,
  tool: string,
): string {
  const groups = sortedGroups(tools);
  const namespaces = groups
    .map((group) => renderNamespaceLine(group.namespace, group.tools.length))
    .join(", ");
  const known = groups.find((group) => group.namespace === namespace);
  if (!known) {
    return `Unknown namespace "${namespace}". Available namespaces: ${namespaces || "(none)"}.`;
  }
  const toolNames = known.tools.map((entry) => entry.tool).join(", ");
  return `Unknown tool "${tool}" in namespace "${namespace}". Tools in "${namespace}": ${toolNames}.`;
}

/**
 * Render the resident catalog under a token budget.
 *
 * Allocation: every namespace keeps its representative line even when its
 * entries are all truncated (a namespace the model cannot see at all is
 * indistinguishable from one that is not connected), and the remaining budget
 * is handed out round-robin across namespaces so no namespace can starve the
 * others. The budget bounds the entry lines; the representative lines are the
 * documented exception when they alone exceed it.
 */
export function renderCatalog(
  tools: CatalogTool[],
  options: RenderCatalogOptions = {},
): CatalogRenderResult {
  const budgetTokens = options.budgetTokens ?? CATALOG_DEFAULT_BUDGET_TOKENS;
  const entryOptions = {
    maxDepth: options.maxDepth,
    descriptionMaxTokens: options.descriptionMaxTokens,
  };
  const groups = sortedGroups(tools);
  const totalTools = groups.reduce((sum, group) => sum + group.tools.length, 0);

  const entryLines = groups.map((group) =>
    group.tools.map((tool) => renderCatalogEntry(tool, entryOptions)),
  );
  const namespaceLines = groups.map((group) =>
    renderNamespaceLine(group.namespace, group.tools.length),
  );

  const compose = (entries: string[][], nsLines: string[]): string =>
    renderText(entries, nsLines, totalTools);

  // Round-robin admission across namespaces.
  const admitted: string[][] = groups.map(() => []);
  const cursors: number[] = groups.map(() => 0);
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (let i = 0; i < groups.length; i++) {
      const line = entryLines[i][cursors[i]];
      if (line === undefined) continue;
      cursors[i]++;
      remaining = true;
      const candidate = admitted.map((lines, j) =>
        j === i ? [...lines, line] : lines,
      );
      if (estimateTokens(compose(candidate, namespaceLines)) > budgetTokens) {
        continue;
      }
      admitted[i] = [...admitted[i], line];
    }
  }

  // The incremental estimate above is additive while `estimateTokens` rounds
  // per call, so re-check exactly and drop the last admitted entries until the
  // rendered text really fits. Deterministic: reverse admission order.
  while (
    estimateTokens(compose(admitted, namespaceLines)) > budgetTokens &&
    admitted.some((lines) => lines.length > 0)
  ) {
    for (let i = admitted.length - 1; i >= 0; i--) {
      if (admitted[i].length > 0) {
        admitted[i] = admitted[i].slice(0, -1);
        break;
      }
    }
  }

  const text = compose(admitted, namespaceLines);
  const shownTools = admitted.reduce((sum, lines) => sum + lines.length, 0);
  return {
    text,
    complete: shownTools >= totalTools,
    shownTools,
    totalTools,
    namespaces: groups.map((group) => group.namespace),
    tokens: estimateTokens(text),
  };
}

function renderText(
  entries: string[][],
  namespaceLines: string[],
  totalTools: number,
): string {
  const shown = entries.reduce((sum, lines) => sum + lines.length, 0);
  const lines = [CATALOG_PREAMBLE, renderCatalogHeader(shown, totalTools), ""];
  namespaceLines.forEach((namespaceLine, index) => {
    lines.push(namespaceLine);
    lines.push(...entries[index]);
  });
  return lines.join("\n");
}

/** Every property name in a schema, at any nesting depth (for search). */
function collectPropertyNames(schema: unknown, into: Set<string>): void {
  const record = asRecord(schema);
  if (!record) return;
  const properties = asRecord(record.properties);
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      into.add(key);
      collectPropertyNames(value, into);
    }
  }
  if (Array.isArray(record.items)) {
    for (const item of record.items) collectPropertyNames(item, into);
  } else {
    collectPropertyNames(record.items, into);
  }
  collectPropertyNames(record.additionalProperties, into);
}

function searchHaystack(tool: CatalogTool): string {
  const names = new Set<string>();
  collectPropertyNames(tool.parameters, names);
  return [tool.namespace, tool.tool, tool.description, ...names]
    .join("\n")
    .toLowerCase();
}

const SEARCH_NO_MATCH_HINT =
  "Search covers only this session's tool pool. Try a shorter or more general keyword.";

/**
 * Search the **complete** catalog (resident + truncated entries) locally.
 *
 * Read-only: no network, no leaf execution, no model call. Matching is
 * case-insensitive substring over namespace / tool name / description /
 * parameter names, and the result volume is bounded by `limit`.
 */
export function searchCatalog(
  tools: CatalogTool[],
  options: SearchCatalogOptions,
): CatalogSearchResult {
  const query = options.query.trim();
  const limit = Math.max(1, options.limit ?? TOOL_SEARCH_DEFAULT_LIMIT);
  const offset = Math.max(0, options.offset ?? 0);
  if (!query) {
    return {
      text: `No matches: the query is empty. ${SEARCH_NO_MATCH_HINT}`,
      returned: 0,
      totalMatches: 0,
    };
  }

  const needle = query.toLowerCase();
  const ordered = sortedGroups(tools).flatMap((group) => group.tools);
  const matches = ordered.filter((tool) =>
    searchHaystack(tool).includes(needle),
  );
  const page = matches.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  if (matches.length === 0) {
    return {
      text: `No tools matched "${query}". ${SEARCH_NO_MATCH_HINT}`,
      returned: 0,
      totalMatches: 0,
    };
  }

  const lines = [
    `Tools matching "${query}": ${page.length} of ${matches.length}`,
    ...page.map((tool) => renderCatalogEntry(tool, options)),
  ];
  if (nextOffset < matches.length) {
    lines.push(
      `More matches available — call ToolSearch with offset=${nextOffset}.`,
    );
  }
  return {
    text: lines.join("\n"),
    returned: page.length,
    totalMatches: matches.length,
    ...(nextOffset < matches.length ? { nextOffset } : {}),
  };
}
