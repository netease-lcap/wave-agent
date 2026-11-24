/**
 * Which tools the sandbox may reach.
 *
 * One judgment, four consumers: the flat declarations give up exactly the tools
 * this returns (see `toolManager.getToolsConfig`), the pool is built from it
 * (see `catalog.buildReplPool`), the announcement lists its names (see
 * `catalogAnnouncement`), and the sandbox's reachable set is that same pool.
 * Four separate judgments is how "the announcement lists a tool the declarations
 * did not give up" — a permission-escalation shape — becomes possible.
 *
 * Modelled on Claude Code's `isDeferredToolByEngine`. The order is the contract:
 *   0. the core pool — `Read` / `Glob` / `Grep` / `Bash` / `PowerShell` / `Write`
 *      / `Edit` once `enableReplCoreTools` is on. Behind `alwaysLoad`, because a
 *      per-tool escape hatch has to win over a bulk switch, and ahead of the
 *      non-deferrable list, because that list exists to pull tools *out* of the
 *      pool for the tools the switch is not about.
 *   1. `alwaysLoad` — the per-tool escape hatch, and deliberately first so it can
 *      override even the unconditional MCP rule.
 *   2. the non-deferrable list — names that must stay flat, resolved from the
 *      structural floor plus whatever remote/local config pushes down, so a bad
 *      call can be undone without shipping a release.
 *   3. MCP — deferred unconditionally. A server cannot know whether its tools are
 *      rare enough to be worth loading on demand, and asking every server to opt
 *      in would leave most of them flat.
 *   4. the tool's own `defer` claim.
 */
import {
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  REPL_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
  POLL_TOOL_NAME,
  READ_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "../constants/tools.js";

/**
 * The tools a script reaches instead of `tools[]` once `enableReplCoreTools` is
 * on. This is tier 1 of the announcement — the one that gets inline signatures —
 * so the membership is a *presentation* decision as much as a deferral one: these
 * are the calls a session makes every turn, and leaving them name-only would make
 * the first script of every session start with a search.
 *
 * Aligned with Claude Code's code-mode-only core set, minus `NotebookEdit` (we do
 * not have it) and plus `Write` / `Edit` (it leaves those flat), which is what
 * `docs/specs/core/repl-tool.md` fixes as our tier 1.
 *
 * The names are the constants, not literals, so a rename cannot silently shrink
 * this list.
 */
export const CORE_POOL_TOOLS: readonly string[] = [
  READ_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  BASH_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
];

/** Which announcement tier a pooled tool belongs to. */
export type ToolTier = "core" | "named";

/** What the judgment needs to know about a candidate. */
export interface DeferralSubject {
  name: string;
  /** True for tools that came from an MCP server. */
  isMcp?: boolean;
  /** The tool's own claim (`ToolPlugin.defer`, or MCP's equivalent). */
  defer?: boolean;
  /** The tool's own escape hatch (`ToolPlugin.alwaysLoad`). */
  alwaysLoad?: boolean;
  /**
   * The pool tier this candidate was assigned (`toolTier`). The judgment reads the
   * name list instead — one source — and this field exists so `buildReplPool` can
   * copy it onto the entry the announcement splits on.
   */
  tier?: ToolTier;
}

/**
 * Names that must never enter the pool, whatever the configuration says.
 *
 * The REPL tool is the pool's own carrier: a pool containing its carrier would
 * have the sandbox able to call the REPL, i.e. a script that spawns a script.
 * This is a floor under the configurable list, not a replacement for it: an
 * operator cannot accidentally pool the REPL by editing a list (see
 * `isDeferredTool`).
 *
 * `Poll` is here for a different reason: it is how a model reads the async lane's
 * queue from outside a script, and a pool tool is only reachable from *inside* one.
 * Pooling it would leave every dispatched result waiting behind a tool the model
 * cannot call — a dead end, not a saving.
 */
export const STRUCTURAL_NON_DEFERRABLE: readonly string[] = [
  REPL_TOOL_NAME,
  POLL_TOOL_NAME,
];

/**
 * The parameter a pooled shell tool must not declare.
 *
 * Inside a script, backgrounding belongs to the async lane: the script itself is
 * what keeps running, and a `run_in_background` argument would hand the model a
 * task id from a lane the sandbox cannot wait on — a parameter whose only effect
 * is to be silently ignored. Claude Code builds its code-mode Bash schema with
 * `.omit({ run_in_background: true })` for the same reason.
 *
 * Only the *pooled* shape loses it. The flat declaration keeps the parameter,
 * because the flat call is the lane that honours it, so this is applied where a
 * pool entry is built rather than to the tool's own schema.
 */
export function withoutBackgroundParam(
  name: string,
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (schema === undefined) return undefined;
  if (name !== BASH_TOOL_NAME && name !== POWERSHELL_TOOL_NAME) return schema;
  const properties = schema.properties;
  if (
    typeof properties !== "object" ||
    properties === null ||
    Array.isArray(properties)
  ) {
    return schema;
  }
  const kept = { ...(properties as Record<string, unknown>) };
  if (!(BACKGROUND_PARAM in kept)) return schema;
  delete kept[BACKGROUND_PARAM];
  const next: Record<string, unknown> = { ...schema, properties: kept };
  if (Array.isArray(schema.required)) {
    next.required = schema.required.filter(
      (entry) => entry !== BACKGROUND_PARAM,
    );
  }
  return next;
}

/** The parameter dropped from a pooled shell tool. @see withoutBackgroundParam */
const BACKGROUND_PARAM = "run_in_background";

/**
 * Whether [name] is one of the core tools and the switch that pools them is on.
 * `coreToolsEnabled` is a required input rather than an ambient read: the switch
 * comes from settings, and a pure function of (name, switch) is what keeps the
 * four consumers agreeing.
 */
export function isCorePoolTool(
  name: string,
  coreToolsEnabled: boolean,
): boolean {
  return coreToolsEnabled && CORE_POOL_TOOLS.includes(name);
}

/**
 * The tier [name] belongs to once pooled. `"core"` gets a signature in the
 * announcement; `"named"` gets its name. Every other decision about membership
 * stays in `isDeferredTool`.
 */
export function toolTier(name: string, coreToolsEnabled: boolean): ToolTier {
  return isCorePoolTool(name, coreToolsEnabled) ? "core" : "named";
}

/**
 * Whether this tool is loaded on demand instead of declared flat.
 *
 * `nonDeferrable` is the resolved non-deferrable list (structural floor already
 * unioned in by the caller — see `getNonDeferrableBuiltins`); passing it in
 * rather than reading config here is what keeps this a pure function of the
 * candidate plus the two switch inputs.
 *
 * `coreToolsEnabled` defaults to `false` so the off state — the shipped default —
 * is what a caller that has not been updated yet gets.
 */
export function isDeferredTool(
  subject: DeferralSubject,
  nonDeferrable: ReadonlySet<string>,
  coreToolsEnabled = false,
): boolean {
  if (subject.alwaysLoad === true) return false;
  if (nonDeferrable.has(subject.name)) return false;
  if (isCorePoolTool(subject.name, coreToolsEnabled)) return true;
  if (subject.isMcp === true) return true;
  return subject.defer === true;
}
