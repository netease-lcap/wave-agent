/**
 * The REPL pool: which tools the sandbox may reach, how a tool's call shape is
 * rendered, and how the sandbox's `search` entry point answers.
 *
 * "The pool" is the set of tools loaded on demand — see `repl/deferral.ts` for
 * the judgment that decides membership. Everything here is a pure function of the
 * candidates plus that judgment's inputs; no manager is involved, so the same
 * pool can be built for the declaration path, the announcement and the sandbox
 * without any of them drifting.
 *
 * The hard constraint is that the pool must equal the tools the agent could
 * already call directly — if a tool were reachable from the sandbox but hidden
 * from the agent, REPL would be a permission-escalation channel. Candidates are
 * therefore filtered by permission *before* they arrive here (see
 * `toolManager.getReplPool`), and nothing in this module may widen the set.
 *
 * Two things this module deliberately does not have: a size budget for the
 * announcement and a truncating renderer for its names. A silent cut would read as
 * "that capability does not exist". What the model needs beyond a name — a
 * callable shape — is what `searchTools` and `describeTool` are for, which is why
 * the search index lives here next to the signature renderer all three share: the
 * announcement's inline signatures, a search hit's `input` and `describeTool`'s
 * schema are one rendering of one schema, so they cannot disagree about a
 * parameter.
 *
 * `searchTools` takes its query positionally, the way the reference implementation
 * teaches it, and the shape the host accepts is the shape the description renders.
 * There is deliberately no `select:` mode: naming a tool exactly already answers
 * with that one tool (see `searchTools`), and the `select:` grammar belongs to the
 * separate `ToolSearch` tool rather than to a sandbox global.
 */
import {
  REPL_SEARCH_DEFAULT_MAX_RESULTS,
  REPL_SEARCH_MAX_RESULTS_LIMIT,
  REPL_SEARCH_NAME,
} from "./constants.js";
import {
  isCorePoolTool,
  isDeferredTool,
  toolTier,
  withoutBackgroundParam,
} from "./deferral.js";
import type { DeferralSubject, ToolTier } from "./deferral.js";

/**
 * One tool the sandbox can call.
 *
 * `inputSchema`/`outputSchema` are the raw JSON Schemas, used only to render a
 * callable signature — the sandbox never sees them.
 */
export interface ReplPoolEntry {
  /** Flattened `mcp__<server>__<tool>` name, or a built-in tool's name — the key on the sandbox `tools` object. */
  name: string;
  description?: string;
  /** Curated one-liner; scored above `description` (see `scoreEntry`). */
  searchHint?: string;
  /** True when this entry came from an MCP server. */
  isMcp?: boolean;
  inputSchema?: Record<string, unknown>;
  /**
   * The schema for this tool's `ToolResult.data`, rendered as the signature's
   * return type: a built-in declares it on `ToolPlugin.outputSchema`, an MCP tool
   * gets the server's `outputJSONSchema`. Absent means `unknown`, which is what
   * most MCP servers get (issue #108630: 95%+ declare no output schema) — but a
   * built-in we ship always declares one, and no entry ever gets `string`
   * (spec `core/repl-tool.md`「公告分档呈现」).
   */
  outputSchema?: Record<string, unknown>;
  /**
   * The announcement tier this entry belongs to, copied from the deferral
   * judgment (`deferral.toolTier` via the candidate). `"core"` is the seven tools
   * `enableReplCoreTools` pools — they get an inline signature in the
   * announcement, because they are what a session calls every turn; `"named"`
   * gets its name only. Absent means `"named"`: a caller that has not been taught
   * about tiers must not accidentally promote a tool into the signature block.
   */
  tier?: ToolTier;
}

/** A pool candidate: the entry data plus the inputs the deferral judgment reads. */
export interface ReplPoolCandidate extends DeferralSubject {
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
 * `coreToolsEnabled` is `enableReplCoreTools` as the caller resolved it. It is an
 * input of the judgment rather than something this function reads from settings,
 * so the declaration path, the announcement and the sandbox cannot disagree about
 * whether `Read` is pooled; the same input also decides the entry's `tier`, which
 * is what puts a core tool in the announcement's signature block.
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
export function buildReplPool(
  candidates: readonly ReplPoolCandidate[],
  nonDeferrable: ReadonlySet<string>,
  coreToolsEnabled = false,
  placement?: (name: string) => boolean | undefined,
): ReplPoolEntry[] {
  const pool: ReplPoolEntry[] = [];
  for (const candidate of candidates) {
    // A mod's `tool.describe` answer wins over the judgment table (spec
    // 「给工具、技能、命令写描述」); `undefined` means it had no opinion.
    const deferred =
      placement?.(candidate.name) ??
      isDeferredTool(candidate, nonDeferrable, coreToolsEnabled);
    if (!deferred) continue;
    if (candidate.name === REPL_SEARCH_NAME) {
      throw new Error(
        `Tool "${REPL_SEARCH_NAME}" cannot be loaded on demand, because the sandbox exposes its own search entry under that name. ` +
          `Rename the tool, or mark it \`alwaysLoad\` so it stays out of the REPL pool.`,
      );
    }
    // The tier is the judgment's own answer for this name, not a second reading of
    // the pool: `enableReplCoreTools` is the switch the announcement's signature
    // tier hangs on, and both sides get it from `toolTier`. `"named"` is what an
    // absent `tier` already means, so it is left out rather than written down.
    const tier = candidate.tier ?? toolTier(candidate.name, coreToolsEnabled);
    // A pooled shell tool loses `run_in_background`: inside a script the async
    // lane is what backgrounds work, so the parameter would be an argument the
    // runtime ignores. Applied here, on the entry, so the announcement's inline
    // signature and `describeTool` cannot show the parameter the sandbox drops.
    const inputSchema = isCorePoolTool(candidate.name, coreToolsEnabled)
      ? withoutBackgroundParam(candidate.name, candidate.inputSchema)
      : candidate.inputSchema;
    pool.push({
      name: candidate.name,
      description: candidate.description,
      searchHint: candidate.searchHint,
      isMcp: candidate.isMcp,
      inputSchema,
      outputSchema: candidate.outputSchema,
      tier: tier === "core" ? "core" : undefined,
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
 *
 * Exported because the one place outside the catalog that writes this form is the
 * rejection hint for a flat call of a pooled tool (`ToolManager`), and a hint has
 * to be copyable — a second copy of the identifier rule would eventually render a
 * call that cannot parse.
 */
export function toolExpression(name: string): string {
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
 * The callable signature for one tool: parameters and return type. The
 * announcement's signature block is this function's output, so the model can copy
 * a line of it verbatim into a call — and so it cannot drift from the shape
 * `describeTool` returns.
 *
 * The return type is the tool's declared output schema, rendered by the same
 * `renderType` as the arguments — a built-in's `ToolPlugin.outputSchema` or an MCP
 * server's `outputJSONSchema`. A tool that declared nothing gets
 * `Promise<unknown>` rather than no return type at all, because leaving it out
 * reads as "this call returns nothing".
 *
 * This is a deliberate departure from Claude Code, which spells every built-in
 * `Promise<unknown>` (2.1.325: everything; 2.1.331: built-ins only — MCP gained real
 * types). `unknown` is a guess with a search round-trip attached: the model writes
 * `r.filenames` blind, and a wrong field costs the whole script (issue #108630 is
 * that complaint, filed by users of the other side). We control the `data` we emit,
 * so we can say what it is.
 */
export function renderToolSignature(entry: ReplPoolEntry): string {
  const output = renderType(entry.outputSchema, 0);
  return `${toolExpression(entry.name)}(${renderType(entry.inputSchema, 0)}): Promise<${output}>`;
}

/**
 * The compat path search also answers on: `tools.ToolSearch`, rendered by the same
 * function that renders every tool's path. The `REPL` description names the entry in
 * this form, next to the pool tools that live on the same object.
 *
 * The canonical spelling — the one the rendered signature, the call form in error
 * text and the announcement's pointer use — is the bare global below, which is what
 * a script actually writes (对齐 Claude Code 的 `searchTools(query, max?)`).
 */
export const REPL_SEARCH_EXPRESSION = REPL_SEARCH_NAME;

/**
 * The search entry point as the sandbox global spells it: `searchTools(query, max?)`.
 * Positional rather than an object, which is the shape the reference implementation
 * teaches and the shape the rendered signature, the error text and the host-side
 * validation all describe — one form, so prose cannot teach a call this module would
 * answer differently.
 *
 * There is no `select:` grammar here. Naming a tool exactly already returns that one
 * tool (see `searchTools`), and `select:` belongs to the separate `ToolSearch` tool
 * rather than to a sandbox global: two spellings of "these exact tools please" would
 * be two things to keep in agreement for no extra power.
 */
const SEARCH_GLOBAL = "searchTools";

/** Longest `about` a search hit carries. Beyond it the hit says less and crowds out its siblings. */
const SEARCH_ABOUT_MAX_CHARS = 160;

/** Longest description `describeTool` returns. */
const DESCRIBE_DESCRIPTION_MAX_CHARS = 4_000;

/** Longest `input` type text any single answer carries, per tool. */
const DESCRIBE_INPUT_MAX_CHARS = 6_000;

/**
 * Longest total `input` type text one answer carries. Its own bound, on top of the
 * per-tool one, for the answer that carries several: `searchTools` can return up to
 * its hit limit, and eight unbounded schemas are a context decision the model never
 * asked for.
 */
const DESCRIBE_INPUT_TOTAL_CHARS = 15_000;

/** Where a type text was cut, and where the whole of it can be read. */
const DESCRIBE_TRUNCATION_NOTE =
  "\n// 这部分被省略了，`describeTool` 返回的是完整 schema";

/** Says a schema answered without its prose, and that the structure is intact. */
const SCHEMA_ANNOTATIONS_DROPPED =
  "对外的 description / examples / default 已被省略以适配字符预算；参数名、类型与 required 完整。";

/** Says a schema was too large even without its prose, so only arguments remain. */
const SCHEMA_ARGUMENTS_ONLY =
  "这个 schema 太大，只保留了参数名与 required；类型与嵌套结构请看工具文档。";

/**
 * Keywords whose values are prose rather than structure.
 *
 * A long schema is long because of its descriptions — a thirty-argument tool is
 * mostly one paragraph per argument — so these are what a character budget can
 * drop without making the shape unusable.
 */
const SCHEMA_ANNOTATION_KEYS: readonly string[] = [
  "description",
  "examples",
  "default",
  "title",
];

/** A JSON object, as opposed to an array, `null` or a primitive. */
function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Characters a value costs once serialized; `undefined` costs nothing. */
function serializedChars(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

/** Copy a schema without its annotation keywords, at every depth. */
function withoutAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAnnotations);
  if (!isSchemaObject(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SCHEMA_ANNOTATION_KEYS.includes(key)) continue;
    copy[key] = withoutAnnotations(nested);
  }
  return copy;
}

/**
 * The argument schema `describeTool` answers with: an object, in every case.
 *
 * The budget is unchanged in size, not in kind: it is paid out of the annotations
 * first (that is where a schema's length lives), then out of the per-argument
 * structure, and it never turns the value into a string — a string schema is the
 * one answer the caller cannot use, which is why the fallback is a smaller object
 * rather than a prettier string.
 */
function clampSchema(schema: unknown, budget: number): Record<string, unknown> {
  const full = isSchemaObject(schema) ? schema : {};
  if (serializedChars(full) <= budget) return full;

  const structural = withoutAnnotations(full) as Record<string, unknown>;
  if (serializedChars(structural) <= budget) {
    return { ...structural, $comment: SCHEMA_ANNOTATIONS_DROPPED };
  }

  // Still over budget without a word of prose: keep what nothing else can supply —
  // which arguments exist and which of them are required.
  const properties = isSchemaObject(structural.properties)
    ? Object.keys(structural.properties)
    : [];
  const required = Array.isArray(structural.required)
    ? structural.required
    : [];
  return {
    type: "object",
    ...(required.length > 0 ? { required } : {}),
    properties: Object.fromEntries(properties.map((name) => [name, {}])),
    $comment: SCHEMA_ARGUMENTS_ONLY,
  };
}

/**
 * What a caller gets for a query that is not a string of words. An empty query is
 * refused rather than answered with the pool: "here is everything" dresses a typo
 * up as a successful search, and the model has no way to tell the two apart.
 */
const SEARCH_USAGE =
  "searchTools: pass the words to look for, e.g. searchTools('slack message')";

/** One search hit. Four fields, because each one earns its place in a decision. */
export interface ReplSearchHit {
  /** The name `tools.<name>` takes. */
  name: string;
  /** The tool's own description, cut to `SEARCH_ABOUT_MAX_CHARS`. */
  about: string;
  /** TypeScript type of the argument object. */
  input: string;
  /**
   * TypeScript type of the resolved value, from the tool's output schema — the
   * same source as the announcement's signature and `describeTool().output`.
   *
   * In the hit rather than left to `describeTool`: the return shape is what
   * decides whether the model can go straight on to `const r = await Glob(...)`
   * and read `r.filenames`, and a second round-trip per candidate is exactly the
   * cost the deferred pool exists to avoid. `unknown` when the tool declared no
   * schema.
   */
  output: string;
}

/** What `describeTool` answers for a name that is in the pool. */
export interface ReplToolDescription {
  name: string;
  /** The tool's own description, cut to `DESCRIBE_DESCRIPTION_MAX_CHARS`. */
  description: string;
  /**
   * The tool's own argument schema, kept an *object*.
   *
   * Claude Code answers with the raw schema (`inputSchema: EIo(...)`); a rendered
   * TypeScript string was our previous shape, and a string is something the model
   * can only read — a script cannot walk it, and a host cannot validate against
   * it. The character budget still applies (see `clampSchema`), but it is spent on
   * annotations first so the answer never degrades into a string.
   */
  inputSchema: Record<string, unknown>;
  /**
   * TypeScript type of the resolved value, from the tool's output schema.
   *
   * A string rather than a schema object, unlike `inputSchema`: nothing validates
   * or walks the output (the sandbox hands the script `data` as it came), so the
   * only thing a caller can do with it is read it — which is exactly what the
   * rendered form is for. `unknown` when the tool declared no schema.
   */
  output: string;
}

/** What `describeTool` answers for a name that is not. */
export interface ReplToolNotFound {
  error: string;
}

/**
 * The result shape of a search, as a schema.
 *
 * Load-bearing at both ends: the return type in the rendered signature and the
 * objects the host actually hands back come from this one object, so "what a hit
 * looks like" cannot drift between prose and runtime. There is no `total`: a capped
 * hit list is not a count of matches, and a field saying how many were dropped
 * invites the model to page through a search that has no pages.
 */
const SEARCH_RESULT_SCHEMA: Record<string, unknown> = {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The tool's name, as `tools.<name>` takes it.",
      },
      about: {
        type: "string",
        description: "What the tool is for, cut to one line.",
      },
      input: {
        type: "string",
        description: "TypeScript type of the argument object.",
      },
    },
    required: ["name", "about", "input"],
  },
};

/**
 * The callable signature of the search entry point, rendered into the tool
 * description where there is room for the field docs. Rendered from the very
 * schema the host answers with, so the two cannot disagree.
 */
export function renderSearchSignature(): string {
  return `${SEARCH_GLOBAL}(query: string, max?: number): Promise<${renderType(SEARCH_RESULT_SCHEMA, 0)}>`;
}

/**
 * The one-line call form of the same entry point, for prose that cannot afford the
 * multi-line block — error messages, which still have to name a call the host
 * accepts.
 */
export function renderSearchCallForm(): string {
  return `${SEARCH_GLOBAL}("...")`;
}

/**
 * How many hits a call may have: the default when the caller passed no positive
 * integer, and never more than the ceiling. A search that can return the whole pool
 * is a search whose result is a second announcement.
 */
function resolveSearchLimit(max?: number): number {
  if (typeof max !== "number" || !Number.isInteger(max) || max <= 0) {
    return REPL_SEARCH_DEFAULT_MAX_RESULTS;
  }
  return Math.min(max, REPL_SEARCH_MAX_RESULTS_LIMIT);
}

/** `text` cut to `limit` characters, ellipsis included, when it does not fit. */
function clampText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/**
 * A type text cut to `budget`, followed by the note that says where the whole of it
 * is. The cut lands on a line boundary when there is one nearby, so what is left is
 * still TypeScript rather than half a property.
 *
 * The note itself is the floor: a hit with no budget left still learns that
 * `describeTool` exists, which is strictly better than an empty string that reads
 * as "this tool takes nothing".
 */
function clampTypeText(text: string, budget: number): string {
  if (text.length <= budget) return text;
  if (budget <= DESCRIBE_TRUNCATION_NOTE.length) {
    return DESCRIBE_TRUNCATION_NOTE;
  }
  const keep = budget - DESCRIBE_TRUNCATION_NOTE.length;
  const boundary = text.lastIndexOf("\n", keep);
  return `${text.slice(0, boundary > 0 ? boundary : keep)}${DESCRIBE_TRUNCATION_NOTE}`;
}

/**
 * Everything a script can call this way, sorted.
 *
 * The data source of the sandbox's `tools.list()`. Sorted rather than in pool
 * order, so the answer is a function of the *set*: registry order and the order
 * servers happened to connect in are not things a script's behaviour may depend on.
 */
export function listToolNames(pool: readonly ReplPoolEntry[]): string[] {
  return pool.map((entry) => entry.name).sort();
}

/**
 * The whole shape of one pooled tool: its description and the argument type, both
 * bounded, or the reason there is nothing to return.
 *
 * The three numbers here are the reason a script does not need to guess: a
 * description longer than `DESCRIBE_DESCRIPTION_MAX_CHARS` is a document, and a
 * schema longer than `DESCRIBE_INPUT_MAX_CHARS` is a hand-written essay — either one
 * would push a working context out on its own. A name outside the pool is an
 * answer too (`{ error }`), not an exception: the model can act on it.
 */
export function describeTool(
  pool: readonly ReplPoolEntry[],
  name: string,
): ReplToolDescription | ReplToolNotFound {
  const wanted = typeof name === "string" ? name.trim().toLowerCase() : "";
  const entry = pool.find(
    (candidate) => candidate.name.toLowerCase() === wanted,
  );
  if (!entry) {
    return {
      error: `No tool named "${String(name)}" is reachable inside this sandbox. Call ${renderSearchCallForm()} with keywords to find one.`,
    };
  }
  return {
    name: entry.name,
    description: clampText(
      entry.description ?? "",
      DESCRIBE_DESCRIPTION_MAX_CHARS,
    ),
    inputSchema: clampSchema(entry.inputSchema, DESCRIBE_INPUT_MAX_CHARS),
    output: clampTypeText(
      renderType(entry.outputSchema, 0),
      DESCRIBE_INPUT_MAX_CHARS,
    ),
  };
}

/** Words inside a tool name: `mcp__github__create_issue` → mcp, github, create, issue. */
const NAME_SEPARATORS = /[^a-z0-9]+/;

function nameSegments(name: string): string[] {
  return name.toLowerCase().split(NAME_SEPARATORS).filter(Boolean);
}

/** The prefix that marks a flattened MCP tool name. */
const MCP_NAME_PREFIX = "mcp__";

/** The scale is the contract, not the numbers: see `scoreTerm`. */
const NAME_EXACT_SCORE = 100;
const NAME_WORD_SCORE = 60;
const NAME_SUBSTRING_SCORE = 40;
const SEARCH_HINT_SCORE = 25;
const DESCRIPTION_SCORE = 15;

/**
 * An MCP entry is worth a little more at the same tier: its name carries a server
 * and an action the model did not choose, so a hit in it is a stronger signal than
 * a hit in a one-word built-in name the model already knows.
 */
const MCP_SCORE_BONUS = 5;

/** One word of the query, and whether it was prefixed with `+`. */
interface SearchTerm {
  text: string;
  /** `+term`: must match somewhere. Its score still counts, but only as a tie-break. */
  required: boolean;
}

/**
 * How well one entry matches one term in its name or its curated hint, or 0.
 *
 * The model usually arrives with a name in hand (it read the announcement), so a
 * name match must win; a hint match exists because the hint is the one sentence
 * somebody wrote for exactly this purpose. The description is scored separately, at
 * the bottom of the scale — see `scoreEntry`.
 */
function scoreTerm(entry: ReplPoolEntry, term: string): number {
  const name = entry.name.toLowerCase();
  if (name === term) return NAME_EXACT_SCORE;
  if (nameSegments(name).includes(term)) return NAME_WORD_SCORE;
  if (name.includes(term)) return NAME_SUBSTRING_SCORE;
  if ((entry.searchHint ?? "").toLowerCase().includes(term)) {
    return SEARCH_HINT_SCORE;
  }
  return 0;
}

/** Everything a JavaScript regular expression would read as syntax. */
const REGEXP_META = /[.*+?^${}()|[\]\\]/g;

/**
 * The description is matched as a regular expression, which is what lets a two-word
 * query reach prose that separates the words: "read file" has to find a tool
 * described as "Reads a file from disk". Escaped and case-insensitive, so a term
 * with punctuation is a term and not a pattern; built once per call.
 */
function descriptionPattern(terms: readonly SearchTerm[]): RegExp | null {
  const words = terms.map((term) => term.text).filter(Boolean);
  if (words.length === 0) return null;
  const escaped = words.map(
    (word) => `\\b${word.replace(REGEXP_META, "\\$&")}`,
  );
  // No trailing word boundary: "read" has to reach "Reads" too.
  return new RegExp(escaped.join("[\\s\\S]*"), "i");
}

/**
 * How well one entry matches the whole query, or 0 when it does not.
 *
 * A `+term` that matches nowhere disqualifies the entry; a plain term that matches
 * nowhere simply earns nothing, so a plain query is a ranking rather than a filter.
 * The description counts once, at the bottom of the scale: a tool that mentions the
 * words somewhere in prose is a worse answer than one whose name or hint says them,
 * and letting each term add its own description hit would rank a chatty description
 * above a tool actually named after the thing.
 */
function scoreEntry(
  entry: ReplPoolEntry,
  terms: readonly SearchTerm[],
  pattern: RegExp | null,
): number {
  const description = (entry.description ?? "").toLowerCase();
  const described = pattern?.test(entry.description ?? "") === true;
  let score = 0;
  for (const term of terms) {
    const match = scoreTerm(entry, term.text);
    if (match === 0 && term.required && !description.includes(term.text)) {
      return 0;
    }
    score += match;
  }
  if (described) score += DESCRIPTION_SCORE;
  if (score === 0) return 0;
  return entry.isMcp === true ? score + MCP_SCORE_BONUS : score;
}

/** Deterministic tie-break: the same query against the same pool always answers alike. */
function compareNames(left: ReplPoolEntry, right: ReplPoolEntry): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

/**
 * The entries a query matches, best first.
 *
 * Three rules, in order:
 *  1. an exact name short-circuits — the model read it in the announcement, and
 *     fuzzy neighbours would only dilute the one answer it asked for;
 *  2. a query starting with `mcp__` is a name prefix, not a keyword: it names a
 *     server, and a substring search over the flattened names would rank unrelated
 *     tools above the ones on that server;
 *  3. anything else is keywords, scored by `scoreEntry`.
 *
 * Ordering is a pure function of the pool and the query: score descending, then
 * name ascending. Nothing about connection state or arrival order leaks in.
 */
function rankMatches(
  pool: readonly ReplPoolEntry[],
  lowered: string,
): ReplPoolEntry[] {
  const exact = pool.find((entry) => entry.name.toLowerCase() === lowered);
  if (exact) return [exact];

  if (lowered.startsWith(MCP_NAME_PREFIX)) {
    return pool
      .filter((entry) => entry.name.toLowerCase().startsWith(lowered))
      .sort(compareNames);
  }

  const terms: SearchTerm[] = [];
  for (const word of lowered.split(/\s+/)) {
    if (word.length === 0) continue;
    if (word.startsWith("+")) {
      if (word.length > 1) terms.push({ text: word.slice(1), required: true });
      continue;
    }
    terms.push({ text: word, required: false });
  }
  const pattern = descriptionPattern(terms);

  return pool
    .map((entry) => ({ entry, score: scoreEntry(entry, terms, pattern) }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || compareNames(left.entry, right.entry),
    )
    .map((candidate) => candidate.entry);
}

/**
 * Answer one search call against the whole pool.
 *
 * Local matching, no model round-trip: the pool is in memory, so the answer costs
 * nothing but the words. The first argument has to be a string and has to hold
 * something — a bare `searchTools()` is a mistake, and answering it with the pool
 * would make the mistake indistinguishable from a search that found everything.
 *
 * Returns the hits themselves, not JSON text: a script composes values, and parsing
 * a string first is a step a signature should not have to mention.
 */
export function searchTools(
  pool: readonly ReplPoolEntry[],
  query: string,
  max?: number,
): ReplSearchHit[] {
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error(SEARCH_USAGE);
  }

  const limit = resolveSearchLimit(max);
  let remaining = DESCRIBE_INPUT_TOTAL_CHARS;

  return rankMatches(pool, query.trim().toLowerCase())
    .slice(0, limit)
    .map((entry) => {
      const input = clampTypeText(
        renderType(entry.inputSchema, 0),
        Math.min(DESCRIBE_INPUT_MAX_CHARS, remaining),
      );
      remaining = Math.max(0, remaining - input.length);
      const output = clampTypeText(
        renderType(entry.outputSchema, 0),
        Math.min(DESCRIBE_INPUT_MAX_CHARS, remaining),
      );
      remaining = Math.max(0, remaining - output.length);
      return {
        name: entry.name,
        about: clampText(entry.description ?? "", SEARCH_ABOUT_MAX_CHARS),
        input,
        output,
      };
    });
}
