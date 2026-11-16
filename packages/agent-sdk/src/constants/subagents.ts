export const BASH_SUBAGENT_TYPE = "Bash";
export const EXPLORE_SUBAGENT_TYPE = "Explore";
export const PLAN_SUBAGENT_TYPE = "Plan";
export const GENERAL_PURPOSE_SUBAGENT_TYPE = "general-purpose";
/**
 * The fork a `/subtask` starts (`builtin/forkSubagent.ts`). Named after Claude
 * Code's `subagent_type: "fork"`; unlike the types above it is never offered to
 * the model, only ever started by the user.
 */
export const FORK_SUBAGENT_TYPE = "fork";
