import { EXIT_PLAN_MODE_TOOL_NAME } from "../constants/tools.js";
import { FORK_SUBAGENT_TYPE } from "../constants/subagents.js";
import type { SubagentConfiguration } from "../utils/subagentParser.js";

/**
 * How many turns `/subtask`'s fork gets for its own work. Matches the budget
 * Claude Code's fork agent is given. The conversation it inherits is history,
 * not turns, so it does not count against this: `maxTurns` bounds the loop the
 * fork runs, and the inherited snapshot is already behind that loop's start.
 */
export const FORK_SUBTASK_MAX_TURNS = 200;

/**
 * The `/subtask` fork, as a configuration (spec `multi-agent/subtask-command.md`).
 *
 * Built in memory instead of joining the other builtin subagents on purpose:
 * a fork is started by the user and never offered to the model as an
 * `Agent`-tool `subagent_type` (the spec's non-goal), and the builtin
 * definitions on disk are exactly the list the model is shown.
 *
 * The rest of the contract, aligned with the fork agent's definition in CC:
 * - every tool, like CC's `tools: ["*"]`. A `tools` list here is a whitelist
 *   and a literal `"*"` matches no tool by name, so "no list" is how this
 *   codebase spells "all tools".
 * - the parent's model and permission mode are inherited, not chosen: no
 *   `model` (an AIManager override would be ignored for a fork anyway in CC —
 *   here, leaving it unset is what makes the fork resolve the session's model)
 *   and no `permissionModeOverride` at creation.
 * - `ExitPlanMode` is denied, so a fork that inherits plan mode stays in plan
 *   mode instead of talking itself out of it.
 * - no role prompt of its own: the fork *is* the parent session, so the base
 *   system prompt plus the inherited conversation are the whole story.
 */
export function createForkSubagentConfiguration(): SubagentConfiguration {
  return {
    name: FORK_SUBAGENT_TYPE,
    description: "This session, continued with its full conversation.",
    disallowedTools: [EXIT_PLAN_MODE_TOOL_NAME],
    systemPrompt: "",
    // In-memory configuration: there is no definition file to point at.
    filePath: "",
    scope: "builtin",
    priority: 0,
  };
}
