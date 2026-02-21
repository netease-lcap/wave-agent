import {
  BASH_SUBAGENT_TYPE,
  EXPLORE_SUBAGENT_TYPE,
  PLAN_SUBAGENT_TYPE,
  GENERAL_PURPOSE_SUBAGENT_TYPE,
} from "../constants/subagents.js";
import {
  BASH_SUBAGENT_SYSTEM_PROMPT,
  GENERAL_PURPOSE_SYSTEM_PROMPT,
  PLAN_SUBAGENT_SYSTEM_PROMPT,
  EXPLORE_SUBAGENT_SYSTEM_PROMPT,
} from "../prompts/index.js";
import {
  BASH_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  READ_TOOL_NAME,
  LS_TOOL_NAME,
  LSP_TOOL_NAME,
} from "../constants/tools.js";
import type { SubagentConfiguration } from "./subagentParser.js";

/**
 * Get all built-in subagent configurations
 * Built-in subagents have priority 3 (lowest) and can be overridden by user/project configs
 */
export function getBuiltinSubagents(): SubagentConfiguration[] {
  return [
    createBashSubagent(),
    createExploreSubagent(),
    createGeneralPurposeSubagent(),
    createPlanSubagent(),
    // Add more built-in subagents here as needed
  ];
}

/**
 * Create the Bash built-in subagent configuration
 * Specialized for executing bash commands and git operations
 */
function createBashSubagent(): SubagentConfiguration {
  return {
    name: BASH_SUBAGENT_TYPE,
    description:
      "Command execution specialist for running bash commands. Use this for git operations, command execution, and other terminal tasks.",
    systemPrompt: BASH_SUBAGENT_SYSTEM_PROMPT,
    tools: [BASH_TOOL_NAME],
    model: "inherit",
    filePath: `<builtin:${BASH_SUBAGENT_TYPE}>`,
    scope: "builtin",
    priority: 3,
  };
}

/**
 * Create the General-Purpose built-in subagent configuration
 * Specialized for multi-step research and implementation tasks
 */
function createGeneralPurposeSubagent(): SubagentConfiguration {
  return {
    name: GENERAL_PURPOSE_SUBAGENT_TYPE,
    description:
      "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.",
    systemPrompt: GENERAL_PURPOSE_SYSTEM_PROMPT,
    filePath: `<builtin:${GENERAL_PURPOSE_SUBAGENT_TYPE}>`,
    scope: "builtin",
    priority: 3,
  };
}

/**
 * Create the Explore built-in subagent configuration
 * Specialized for codebase exploration and file search tasks
 */
function createExploreSubagent(): SubagentConfiguration {
  // Define allowed tools for read-only operations
  const allowedTools = [
    GLOB_TOOL_NAME,
    GREP_TOOL_NAME,
    READ_TOOL_NAME,
    BASH_TOOL_NAME,
    LS_TOOL_NAME,
    LSP_TOOL_NAME,
  ];

  return {
    name: EXPLORE_SUBAGENT_TYPE,
    description:
      'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
    systemPrompt: EXPLORE_SUBAGENT_SYSTEM_PROMPT,
    tools: allowedTools,
    model: "fastModel", // Special value that will use parent's fastModel
    filePath: `<builtin:${EXPLORE_SUBAGENT_TYPE}>`,
    scope: "builtin",
    priority: 3, // Lowest priority - can be overridden by user configs
  };
}

/**
 * Create the Plan built-in subagent configuration
 * Specialized for designing implementation plans and exploring codebases in read-only mode
 */
function createPlanSubagent(): SubagentConfiguration {
  // Define allowed tools for read-only operations
  const allowedTools = [
    GLOB_TOOL_NAME,
    GREP_TOOL_NAME,
    READ_TOOL_NAME,
    BASH_TOOL_NAME,
    LS_TOOL_NAME,
    LSP_TOOL_NAME,
  ];

  return {
    name: PLAN_SUBAGENT_TYPE,
    description:
      "Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.",
    systemPrompt: PLAN_SUBAGENT_SYSTEM_PROMPT,
    tools: allowedTools,
    model: "inherit", // Uses parent agent's model
    filePath: `<builtin:${PLAN_SUBAGENT_TYPE}>`,
    scope: "builtin",
    priority: 3, // Lowest priority - can be overridden by user configs
  };
}
