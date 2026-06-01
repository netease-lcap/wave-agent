import {
  ASK_USER_QUESTION_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  AGENT_TOOL_NAME,
} from "../constants/tools.js";
import {
  EXPLORE_SUBAGENT_TYPE,
  PLAN_SUBAGENT_TYPE,
} from "../constants/subagents.js";

export function wrapInSystemReminder(content: string): string {
  return `<system-reminder>\n${content}\n</system-reminder>`;
}

export function buildPlanModeReminder(
  planFilePath: string,
  planExists: boolean,
  isSubagent: boolean = false,
): string {
  const planFileInfo = planExists
    ? `A plan file already exists at ${planFilePath}. You can read it and make incremental edits using the ${EDIT_TOOL_NAME} tool if you need to.`
    : `No plan file exists yet. You should create your plan at ${planFilePath} using the ${WRITE_TOOL_NAME} tool if you need to.`;

  const subagentPlanFileInfo = planExists
    ? `A plan file already exists at ${planFilePath}. You can read it for context if needed.`
    : `No plan file exists yet.`;

  if (isSubagent) {
    return wrapInSystemReminder(`Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits, run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received (for example, to make edits). Instead, your role is to explore the codebase and return your findings as text output. Do NOT attempt to write or edit any files — the parent agent will write the plan file based on your text response.

## Plan File Info:
${subagentPlanFileInfo}
Answer the user's query comprehensively, using the ${ASK_USER_QUESTION_TOOL_NAME} tool if you need to ask the user clarifying questions. If you do use the ${ASK_USER_QUESTION_TOOL_NAME}, make sure to ask all clarifying questions you need to fully understand the user's intent before proceeding.`);
  }

  return wrapInSystemReminder(`Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including making configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.

## Plan File Info:
${planFileInfo}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the ${AGENT_TOOL_NAME} tool with subagent_type=${EXPLORE_SUBAGENT_TYPE}.

1. Focus on understanding the user's request and the code associated with their request. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.

2. **Launch up to 3 ${EXPLORE_SUBAGENT_TYPE} agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigating testing patterns

### Phase 2: Design
Goal: Design an implementation approach.

Launch agent(s) with subagent_type=${PLAN_SUBAGENT_TYPE} to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 3 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)
- **Multiple agents**: Use up to 3 agents for complex tasks that benefit from different perspectives

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use ${ASK_USER_QUESTION_TOOL_NAME} to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Begin with a **Context** section: explain why this change is being made — the problem or need it addresses, what prompted it, and the intended outcome
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Reference existing functions and utilities you found that should be reused, with their file paths
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call ${EXIT_PLAN_MODE_TOOL_NAME}
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call ${EXIT_PLAN_MODE_TOOL_NAME} to indicate to the user that you are done planning.
This is critical - your turn should only end with either using the ${ASK_USER_QUESTION_TOOL_NAME} tool OR calling ${EXIT_PLAN_MODE_TOOL_NAME}. Do not stop unless it's for these 2 reasons

**Important:** Use ${ASK_USER_QUESTION_TOOL_NAME} ONLY to clarify requirements or choose between approaches. Use ${EXIT_PLAN_MODE_TOOL_NAME} to request plan approval. Do NOT ask about plan approval in any other way - no text questions, no AskUserQuestion. Phrases like "Is this plan okay?", "Should I proceed?", "How does this plan look?", "Any changes before we start?", or similar MUST use ${EXIT_PLAN_MODE_TOOL_NAME}.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications using the ${ASK_USER_QUESTION_TOOL_NAME} tool. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.`);
}

export function buildPlanModeSparseReminder(planFilePath: string): string {
  return wrapInSystemReminder(
    `Plan mode still active (see full instructions earlier in conversation). Read-only except plan file at ${planFilePath}. End turns with ${ASK_USER_QUESTION_TOOL_NAME} or ${EXIT_PLAN_MODE_TOOL_NAME}.`,
  );
}

export function buildPlanModeReEntryReminder(planFilePath: string): string {
  return wrapInSystemReminder(`## Re-entering Plan Mode

You are returning to plan mode after having previously exited it. A plan file exists at ${planFilePath} from your previous planning session.

**Before proceeding with any new planning, you should:**
1. Read the existing plan file to understand what was previously planned
2. Evaluate the user's current request against that plan
3. Decide how to proceed:
   - **Different task**: If the user's request is for a different task—even if it's similar or related—start fresh by overwriting the existing plan
   - **Same task, continuing**: If this is explicitly a continuation or refinement of the exact same task, modify the existing plan while cleaning up outdated or irrelevant sections
4. Continue on with the plan process and most importantly you should always edit the plan file one way or the other before calling ${EXIT_PLAN_MODE_TOOL_NAME}

Treat this as a fresh planning session. Do not assume the existing plan is relevant without evaluating it first.`);
}

export function buildExitedPlanModeReminder(
  planFilePath?: string,
  planExists?: boolean,
): string {
  return wrapInSystemReminder(`## Exited Plan Mode

You have exited plan mode. You can now make edits, run tools, and take actions.${planExists ? ` The plan file is located at ${planFilePath} if you need to reference it.` : ""}`);
}
