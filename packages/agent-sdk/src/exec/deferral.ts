/**
 * Which tools the sandbox may reach.
 *
 * One judgment, four consumers: the flat declarations give up exactly the tools
 * this returns (see `toolManager.getToolsConfig`), the pool is built from it
 * (see `catalog.buildExecPool`), the announcement lists its names (see
 * `catalogAnnouncement`), and the sandbox's reachable set is that same pool.
 * Four separate judgments is how "the announcement lists a tool the declarations
 * did not give up" — a permission-escalation shape — becomes possible.
 *
 * Modelled on Claude Code's `isDeferredToolByEngine` (2.1.285). The order is the
 * contract:
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

/** What the judgment needs to know about a candidate. */
export interface DeferralSubject {
  name: string;
  /** True for tools that came from an MCP server. */
  isMcp?: boolean;
  /** The tool's own claim (`ToolPlugin.defer`, or MCP's equivalent). */
  defer?: boolean;
  /** The tool's own escape hatch (`ToolPlugin.alwaysLoad`). */
  alwaysLoad?: boolean;
}

/**
 * Names that must never enter the pool, whatever the configuration says.
 *
 * `Exec` is the pool's own carrier: a pool containing its carrier would have the
 * sandbox able to call `Exec`, i.e. a script that spawns a script. This is a
 * floor under the configurable list, not a replacement for it — an operator
 * cannot accidentally pool `Exec` by editing a list (see `isDeferredTool`).
 */
export const STRUCTURAL_NON_DEFERRABLE: readonly string[] = ["Exec"];

/**
 * Whether this tool is loaded on demand instead of declared flat.
 *
 * `nonDeferrable` is the resolved non-deferrable list (structural floor already
 * unioned in by the caller — see `getNonDeferrableBuiltins`); passing it in
 * rather than reading config here is what keeps this a pure function of the
 * candidate plus one set.
 */
export function isDeferredTool(
  subject: DeferralSubject,
  nonDeferrable: ReadonlySet<string>,
): boolean {
  if (subject.alwaysLoad === true) return false;
  if (nonDeferrable.has(subject.name)) return false;
  if (subject.isMcp === true) return true;
  return subject.defer === true;
}
