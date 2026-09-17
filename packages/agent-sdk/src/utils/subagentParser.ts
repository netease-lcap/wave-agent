import { readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, extname, basename } from "path";
import { logger } from "./globalLogger.js";
import {
  parseFrontmatterYaml,
  splitFrontmatter,
  type FrontmatterValue,
  type ParsedFrontmatter,
} from "./frontmatterYaml.js";
import { getBuiltinSubagentsDir } from "./configPaths.js";

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

interface SubagentFrontmatter {
  name?: string;
  description?: string;
  tools?: string[];
  model?: string;
}

/**
 * Parse YAML frontmatter from markdown file content.
 *
 * Value parsing is shared with skills, custom slash commands and memory files —
 * see `frontmatterYaml.ts` (spec `multi-agent/subagent` 场景 6).
 */
function parseFrontmatter(content: string): {
  frontmatter: SubagentFrontmatter;
  body: string;
} {
  const { yaml, body } = splitFrontmatter(content);

  if (yaml === null) {
    return { frontmatter: {}, body: content.trim() };
  }

  return {
    frontmatter: toSubagentFrontmatter(parseFrontmatterYaml(yaml)),
    body: body.trim(),
  };
}

/**
 * Narrow a parsed frontmatter block to the fields a subagent declares. Values
 * of an unexpected shape (e.g. a bare `description:` key, which parses to a
 * list) are dropped so `validateConfiguration` reports the field as missing.
 */
function toSubagentFrontmatter(parsed: ParsedFrontmatter): SubagentFrontmatter {
  const frontmatter: SubagentFrontmatter = {};

  for (const key of ["name", "description", "model"] as const) {
    const value = parsed[key];
    if (typeof value === "string" && value) {
      frontmatter[key] = value;
    }
  }

  const tools = normalizeTools(parsed.tools);
  if (tools) {
    frontmatter.tools = tools;
  }

  return frontmatter;
}

/**
 * Normalize the frontmatter `tools` field: a comma-separated string
 * (`Read, Bash`), a bracketed list (`[Read, Bash]`) or a block list.
 */
function normalizeTools(
  value: FrontmatterValue | undefined,
): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const list =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return list
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
 * @param workdir - Working directory to scan for project-level subagents
 * @param env - Merged environment (settings.json env over OS env). Defaults to process.env.
 *              Used for conditional registration of builtin subagents (e.g. WAVE_VISION_MODEL).
 */
export async function loadSubagentConfigurations(
  workdir: string,
  env: Record<string, string> = process.env as Record<string, string>,
): Promise<SubagentConfiguration[]> {
  const projectWaveDir = join(workdir, ".wave", "agents");
  const projectClaudeDir = join(workdir, ".claude", "agents");
  // Resolve user-level dirs via os.homedir() (NOT process.env.HOME): every
  // other user-path resolver in the SDK (settings, skills, MCP, rules, ~/
  // expansion in the Write tool) uses os.homedir(), which on Windows falls
  // back to USERPROFILE. Windows GUI-launched processes (Electron desktop)
  // typically have no HOME set, so process.env.HOME made user-level subagents
  // silently invisible there (`~/.wave/agents` resolved as a relative path).
  const userWaveDir = join(homedir(), ".wave", "agents");
  const userClaudeDir = join(homedir(), ".claude", "agents");
  const builtinDir = getBuiltinSubagentsDir();

  // Load configurations from all sources
  let builtinConfigs = scanSubagentDirectory(builtinDir, "builtin");
  // Conditional registration: builtin subagents whose frontmatter requires the
  // WAVE_VISION_MODEL env var (`model: visionModel`) are only loaded when it is
  // set — otherwise the main model would delegate image recognition to a
  // subagent that resolves to a non-vision model.
  if (!env.WAVE_VISION_MODEL) {
    builtinConfigs = builtinConfigs.filter(
      (config) => config.model !== "visionModel",
    );
  }
  const userClaudeConfigs = scanSubagentDirectory(userClaudeDir, "user");
  const userWaveConfigs = scanSubagentDirectory(userWaveDir, "user");
  const projectClaudeConfigs = scanSubagentDirectory(
    projectClaudeDir,
    "project",
  );
  const projectWaveConfigs = scanSubagentDirectory(projectWaveDir, "project");

  // Merge configurations, with .wave taking priority over .claude
  const configMap = new Map<string, SubagentConfiguration>();

  // Merge order: builtin → userClaude → userWave → projectClaude → projectWave
  // Later writes override earlier ones, so .wave takes priority over .claude
  for (const config of [
    ...builtinConfigs,
    ...userClaudeConfigs,
    ...userWaveConfigs,
    ...projectClaudeConfigs,
    ...projectWaveConfigs,
  ]) {
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
  env?: Record<string, string>,
): Promise<SubagentConfiguration | null> {
  const configurations = await loadSubagentConfigurations(workdir, env);
  return configurations.find((config) => config.name === name) || null;
}
