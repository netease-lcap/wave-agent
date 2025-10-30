import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

export interface SubagentConfiguration {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  filePath: string;
  scope: "project" | "user";
  priority: number;
}

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

  // Validate name pattern
  const namePattern = /^[a-z][a-z0-9-]*$/;
  if (!namePattern.test(config.name)) {
    throw new Error(
      `Invalid subagent name '${config.name}' in ${filePath}. Must start with a letter and contain only lowercase letters, numbers, and hyphens.`,
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
 * Parse a single subagent markdown file
 */
function parseSubagentFile(
  filePath: string,
  scope: "project" | "user",
): SubagentConfiguration {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    validateConfiguration(frontmatter, filePath);

    if (!body.trim()) {
      throw new Error(`Empty system prompt in ${filePath}`);
    }

    return {
      name: frontmatter.name!,
      description: frontmatter.description!,
      tools: frontmatter.tools,
      model: frontmatter.model,
      systemPrompt: body,
      filePath,
      scope,
      priority: scope === "project" ? 1 : 2,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse subagent file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Scan directory for subagent files
 */
function scanSubagentDirectory(
  dirPath: string,
  scope: "project" | "user",
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
          console.warn(
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
 * Load all subagent configurations from project and user directories
 */
export async function loadSubagentConfigurations(
  workdir: string,
): Promise<SubagentConfiguration[]> {
  const projectDir = join(workdir, ".wave", "agents");
  const userDir = join(process.env.HOME || "~", ".wave", "agents");

  const projectConfigs = scanSubagentDirectory(projectDir, "project");
  const userConfigs = scanSubagentDirectory(userDir, "user");

  // Merge configurations, with project configs taking precedence
  const configMap = new Map<string, SubagentConfiguration>();

  // Process in reverse priority order (user first, then project)
  for (const config of [...userConfigs, ...projectConfigs]) {
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

/**
 * Find best matching subagent based on description similarity
 */
export async function findBestMatch(
  query: string,
  workdir: string,
): Promise<SubagentConfiguration | null> {
  const configurations = await loadSubagentConfigurations(workdir);

  if (configurations.length === 0) return null;

  // Simple keyword-based matching
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);

  let bestMatch: SubagentConfiguration | null = null;
  let bestScore = 0;

  for (const config of configurations) {
    let score = 0;
    const description = config.description.toLowerCase();

    // Count keyword matches
    for (const word of queryWords) {
      if (description.includes(word)) {
        score += 1;
      }
    }

    // Boost score for priority (project configs preferred)
    if (config.priority === 1) {
      score += 0.1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = config;
    }
  }

  // Only return if we found at least one keyword match
  return bestScore > 0 ? bestMatch : null;
}
