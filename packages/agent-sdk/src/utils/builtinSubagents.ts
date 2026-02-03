import { GENERAL_PURPOSE_SYSTEM_PROMPT } from "../constants/prompts.js";
import type { SubagentConfiguration } from "./subagentParser.js";

/**
 * Get all built-in subagent configurations
 * Built-in subagents have priority 3 (lowest) and can be overridden by user/project configs
 */
export function getBuiltinSubagents(): SubagentConfiguration[] {
  return [
    createExploreSubagent(),
    createGeneralPurposeSubagent(),
    // Add more built-in subagents here as needed
  ];
}

/**
 * Create the General-Purpose built-in subagent configuration
 * Specialized for multi-step research and implementation tasks
 */
function createGeneralPurposeSubagent(): SubagentConfiguration {
  return {
    name: "general-purpose",
    description:
      "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.",
    systemPrompt: GENERAL_PURPOSE_SYSTEM_PROMPT,
    filePath: "<builtin:general-purpose>",
    scope: "builtin",
    priority: 3,
  };
}

/**
 * Create the Explore built-in subagent configuration
 * Specialized for codebase exploration and file search tasks
 */
function createExploreSubagent(): SubagentConfiguration {
  const systemPrompt = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools - attempting to edit files will fail.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents
- Using Language Server Protocol (LSP) for deep code intelligence (definitions, references, etc.)

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Use LSP for code intelligence features like finding definitions, references, implementations, and symbols. This is especially useful for understanding complex code relationships.
- Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, cat, head, tail)
- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Communicate your final report directly as a regular message - do NOT attempt to create files

NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:
- Make efficient use of the tools that you have at your disposal: be smart about how you search for files and implementations
- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files

Complete the user's search request efficiently and report your findings clearly.`;

  // Define allowed tools for read-only operations
  const allowedTools = ["Glob", "Grep", "Read", "Bash", "LS", "LSP"];

  return {
    name: "Explore",
    description:
      'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
    systemPrompt,
    tools: allowedTools,
    model: "fastModel", // Special value that will use parent's fastModel
    filePath: "<builtin:Explore>",
    scope: "builtin",
    priority: 3, // Lowest priority - can be overridden by user configs
  };
}
