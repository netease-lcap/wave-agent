import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname, basename } from "path";
import { logger } from "./globalLogger.js";

export interface SubagentConfiguration {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  filePath: string;
  scope: "project" | "user" | "builtin" | "plugin";
  priority: number;
  /** Plugin root directory path, set when scope is "plugin" */
  pluginRoot?: string;
}

/**
 * Builtin subagent configurations hardcoded as TypeScript objects.
 * Replaces the former builtin/subagents directory of markdown files.
 */
export const BUILTIN_SUBAGENTS: SubagentConfiguration[] = [
  {
    name: "Explore",
    description:
      'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
    tools: ["Glob", "Grep", "Read", "Bash", "LSP"],
    model: "fastModel",
    systemPrompt: `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.
	
=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
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

Complete the user's search request efficiently and report your findings clearly.`,
    filePath: "<builtin:Explore>",
    scope: "builtin",
    priority: 3,
  },
  {
    name: "Bash",
    description:
      "Command execution specialist for running bash commands. Use this for git operations, command execution, and other terminal tasks.",
    tools: ["Bash"],
    model: "inherit",
    systemPrompt: `You are a command execution specialist. Your role is to execute bash commands efficiently and safely.

Guidelines:
- Execute commands precisely as instructed
- For git operations, follow git safety protocols
- Report command output clearly and concisely
- If a command fails, explain the error and suggest solutions
- Use command chaining (&&) for dependent operations
- Quote paths with spaces properly
- For clear communication, avoid using emojis

Complete the requested operations efficiently.`,
    filePath: "<builtin:Bash>",
    scope: "builtin",
    priority: 3,
  },
  {
    name: "Plan",
    description:
      "Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.",
    tools: ["Glob", "Grep", "Read", "Bash", "LSP"],
    model: "inherit",
    systemPrompt: `You are a software architect and planning specialist. Your role is to explore the codebase and design implementation plans.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY planning task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to explore the codebase and design implementation plans. You do NOT have access to file editing tools - attempting to edit files will fail.

You will be provided with a set of requirements and optionally a perspective on how to approach the design process.

## Your Process

1. **Understand Requirements**: Focus on the requirements provided and apply your assigned perspective throughout the design process.

2. **Explore Thoroughly**:
   - Read any files provided to you in the initial prompt
   - Find existing patterns and conventions using Glob, Grep, and Read
   - Understand the current architecture
   - Identify similar features as reference
   - Trace through relevant code paths
   - Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, cat, head, tail)
   - NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification

3. **Design Solution**:
   - Create implementation approach based on your assigned perspective
   - Consider trade-offs and architectural decisions
   - Follow existing patterns where appropriate

4. **Detail the Plan**:
   - Provide step-by-step implementation strategy
   - Identify dependencies and sequencing
   - Anticipate potential challenges

## Required Output

End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- path/to/file1.ts - [Brief reason: e.g., "Core logic to modify"]
- path/to/file2.ts - [Brief reason: e.g., "Interfaces to implement"]
- path/to/file3.ts - [Brief reason: e.g., "Pattern to follow"]

REMEMBER: You can ONLY explore and plan. You CANNOT and MUST NOT write, edit, or modify any files. You do NOT have access to file editing tools.`,
    filePath: "<builtin:Plan>",
    scope: "builtin",
    priority: 3,
  },
  {
    name: "general-purpose",
    description:
      "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.",
    systemPrompt: `You are an agent. Given the user's message, you should use the tools available to complete the task. Do what has been asked; nothing more, nothing less. When you complete the task simply respond with a detailed writeup.

Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: Use Grep or Glob when you need to search broadly. Use Read when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.
- In your final response always share relevant file names and code snippets. Any file paths you return in your response MUST be absolute. Do NOT use relative paths.
- For clear communication, avoid using emojis.`,
    filePath: "<builtin:general-purpose>",
    scope: "builtin",
    priority: 3,
  },
];

interface SubagentFrontmatter {
  name?: string;
  description?: string;
  tools?: string[];
  model?: string;
}

/**
 * Parse YAML frontmatter from markdown file content
 */
function parseFrontmatter(content: string): {
  frontmatter: SubagentFrontmatter;
  body: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  const [, yamlContent, body] = match;
  const frontmatter = parseYamlFrontmatter(yamlContent);

  return { frontmatter, body: body.trim() };
}

/**
 * Simple YAML frontmatter parser for subagent files
 */
function parseYamlFrontmatter(yamlContent: string): SubagentFrontmatter {
  const frontmatter: SubagentFrontmatter = {};

  try {
    const lines = yamlContent.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed
        .substring(colonIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, "");

      if (key && value) {
        // Handle array values for tools
        if (key === "tools" && value) {
          let arrayValue = value;
          if (arrayValue.startsWith("[") && arrayValue.endsWith("]")) {
            arrayValue = arrayValue.slice(1, -1);
          }
          frontmatter[key] = arrayValue
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        } else {
          if (key === "name" || key === "description" || key === "model") {
            frontmatter[key] = value;
          }
        }
      }
    }
  } catch {
    // Return empty frontmatter on parse error - validation will catch missing fields
  }

  return frontmatter;
}

/**
 * Validate subagent configuration
 */
function validateConfiguration(
  config: SubagentFrontmatter,
  filePath: string,
): void {
  if (!config.name) {
    throw new Error(`Missing required field 'name' in ${filePath}`);
  }

  if (!config.description) {
    throw new Error(`Missing required field 'description' in ${filePath}`);
  }

  // Validate name pattern - allow letters (upper/lowercase), numbers, and hyphens
  const namePattern = /^[a-zA-Z][a-zA-Z0-9-]*$/;
  if (!namePattern.test(config.name)) {
    throw new Error(
      `Invalid subagent name '${config.name}' in ${filePath}. Must start with a letter and contain only letters, numbers, and hyphens.`,
    );
  }

  // Validate model if specified - allow any non-empty string
  if (config.model && typeof config.model !== "string") {
    throw new Error(
      `Invalid model '${config.model}' in ${filePath}. Must be a string.`,
    );
  }
}

/**
 * Parse a single subagent markdown file with optional pluginRoot support
 */
function parseSubagentFile(
  filePath: string,
  scope: "project" | "user" | "builtin" | "plugin",
  pluginRoot?: string,
): SubagentConfiguration {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    // Use filename as default name if not specified in frontmatter
    if (!frontmatter.name) {
      frontmatter.name = basename(filePath, extname(filePath));
    }

    validateConfiguration(frontmatter, filePath);

    if (!body.trim()) {
      throw new Error(`Empty system prompt in ${filePath}`);
    }

    let priority = 1;
    if (scope === "user") priority = 2;
    if (scope === "builtin") priority = 3;
    if (scope === "plugin") priority = 2; // Same priority as user-level

    let systemPrompt = body;

    // Substitute ${WAVE_PLUGIN_ROOT} for plugin scope at parse time
    if (scope === "plugin" && pluginRoot) {
      systemPrompt = systemPrompt.replace(
        /\$\{WAVE_PLUGIN_ROOT\}/g,
        pluginRoot,
      );
    }

    return {
      name: frontmatter.name!,
      description: frontmatter.description!,
      tools: frontmatter.tools,
      model: frontmatter.model,
      systemPrompt,
      filePath,
      scope,
      priority,
      pluginRoot: scope === "plugin" ? pluginRoot : undefined,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse subagent file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Parse a plugin agent markdown file.
 * Exposed as a public API for PluginLoader to use.
 */
export function parseAgentFile(
  filePath: string,
  scope: "plugin",
  pluginRoot: string,
): SubagentConfiguration {
  return parseSubagentFile(filePath, scope, pluginRoot);
}

/**
 * Scan directory for subagent files
 */
function scanSubagentDirectory(
  dirPath: string,
  scope: "project" | "user" | "builtin",
): SubagentConfiguration[] {
  const configurations: SubagentConfiguration[] = [];

  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);

      if (stat.isFile() && extname(entry) === ".md") {
        try {
          const config = parseSubagentFile(fullPath, scope);
          configurations.push(config);
        } catch (parseError) {
          // Log error but continue with other files
          logger.warn(
            `Warning: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          );
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read - this is OK
  }

  return configurations;
}

/**
 * Load all subagent configurations from project and user directories, plus built-in subagents
 */
export async function loadSubagentConfigurations(
  workdir: string,
): Promise<SubagentConfiguration[]> {
  const projectDir = join(workdir, ".wave", "agents");
  const userDir = join(process.env.HOME || "~", ".wave", "agents");

  // Load configurations from all sources
  // Builtin subagents are hardcoded in TS, not scanned from a directory
  const builtinConfigs = [...BUILTIN_SUBAGENTS];
  const projectConfigs = scanSubagentDirectory(projectDir, "project");
  const userConfigs = scanSubagentDirectory(userDir, "user");

  // Merge configurations, with project configs taking highest precedence
  const configMap = new Map<string, SubagentConfiguration>();

  // Process in reverse priority order (built-in first, then user, then project)
  for (const config of [...builtinConfigs, ...userConfigs, ...projectConfigs]) {
    configMap.set(config.name, config);
  }

  return Array.from(configMap.values()).sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Find subagent by exact name match
 */
export async function findSubagentByName(
  name: string,
  workdir: string,
): Promise<SubagentConfiguration | null> {
  const configurations = await loadSubagentConfigurations(workdir);
  return configurations.find((config) => config.name === name) || null;
}
