import { readFileSync } from "fs";
import { dirname } from "path";
import { parseFrontmatterYaml, splitFrontmatter } from "./frontmatterYaml.js";
import {
  findUnresolvedDirectoryPlaceholders,
  substituteDirectoryPlaceholders,
} from "./directoryPlaceholders.js";
import type {
  ParsedSkillFile,
  SkillParseOptions,
  SkillFrontmatter,
  SkillMetadata,
} from "../types/index.js";

/**
 * Parse a SKILL.md file and validate its contents
 */
export function parseSkillFile(
  filePath: string,
  options: SkillParseOptions = {},
): ParsedSkillFile {
  const { validateMetadata = true, basePath, pluginRoot } = options;

  const result: ParsedSkillFile = {
    frontmatter: { name: "", description: "" },
    content: "",
    skillMetadata: {
      name: "",
      description: "",
      type: "personal",
      skillPath: "",
    },
    validationErrors: [],
    warnings: [],
    isValid: false,
  };

  try {
    // Read file content
    const content = readFileSync(filePath, "utf-8");
    result.content = content;

    // Parse YAML frontmatter
    const { yaml } = splitFrontmatter(content);
    if (yaml === null) {
      result.validationErrors.push("Missing YAML frontmatter");
      return result;
    }

    result.frontmatter = parseYamlFrontmatter(yaml);

    if (!result.frontmatter.name || !result.frontmatter.description) {
      result.validationErrors.push(
        "Missing required fields: name and description",
      );
      return result;
    }

    // Determine skill type and path
    const skillPath = basePath || dirname(filePath);
    const skillType =
      skillPath.includes("/.wave/skills") ||
      skillPath.includes("\\.wave\\skills") ||
      skillPath.includes("/.claude/skills") ||
      skillPath.includes("\\.claude\\skills") ||
      skillPath.includes("/.agents/skills") ||
      skillPath.includes("\\.agents\\skills")
        ? "project"
        : "personal";

    // Extract allowed tools
    const allowedTools = parseToolRules(
      result.frontmatter["allowed-tools"],
      "allowed-tools",
      { skillPath, pluginRoot, warnings: result.warnings },
    );

    // `disallowed-tools` is read exactly like `allowed-tools` — same shapes,
    // same trimming, same placeholder resolution and the same "a rule holding
    // a literal placeholder never matches anything, so drop it and say so"
    // discipline. Which side wins when the two lists name the same tool is a
    // permission question, not a parsing one (see `SkillMetadata.disallowedTools`).
    //
    // `disallowedTools` is the camel-case spelling of the same field (Claude
    // Code's schema carries both, the kebab one documented, this one marked as
    // its canonical alias), so an author who copies a camel-case example gets
    // the ban they wrote instead of a silently unregistered rule. The kebab
    // field wins when both are present, matching CC's normalization.
    const disallowedTools = parseToolRules(
      result.frontmatter["disallowed-tools"] ??
        result.frontmatter.disallowedTools,
      "disallowed-tools",
      { skillPath, pluginRoot, warnings: result.warnings },
    );

    // Extract disable-model-invocation
    const disableModelInvocation =
      result.frontmatter["disable-model-invocation"] === true ||
      result.frontmatter["disable-model-invocation"] === "true";

    // Extract user-invocable (default to true)
    const userInvocable =
      result.frontmatter["user-invocable"] === undefined ||
      result.frontmatter["user-invocable"] === true ||
      result.frontmatter["user-invocable"] === "true";

    // `aliases`: other `/…` names for this skill's slash command. A bad entry
    // is dropped with a warning rather than rejected: the skill itself is fine,
    // and one mistyped shorthand must not take the skill out of the menu and
    // the model's list with it.
    const aliases = parseAliases(result.frontmatter.aliases, result.warnings);

    result.skillMetadata = {
      name: result.frontmatter.name,
      description: result.frontmatter.description,
      ...(aliases && aliases.length > 0 ? { aliases } : {}),
      type: skillType,
      skillPath,
      allowedTools,
      disallowedTools,
      context: result.frontmatter.context,
      agent: result.frontmatter.agent,
      model: result.frontmatter.model as string | undefined,
      disableModelInvocation,
      userInvocable,
      ...(typeof result.frontmatter["argument-hint"] === "string" &&
      result.frontmatter["argument-hint"].trim()
        ? { argumentHint: result.frontmatter["argument-hint"].trim() }
        : {}),
    };

    // Validate metadata if requested
    if (validateMetadata) {
      const validationErrors = validateSkillMetadata(result.skillMetadata);
      result.validationErrors.push(...validationErrors);
    }

    result.isValid = result.validationErrors.length === 0;
    return result;
  } catch (error) {
    result.validationErrors.push(
      `Failed to read skill file: ${error instanceof Error ? error.message : String(error)}`,
    );
    return result;
  }
}

/**
 * Read one tool-rule list out of the frontmatter.
 *
 * Both `allowed-tools` and `disallowed-tools` go through here so the two can
 * never drift apart: a YAML list or a comma-separated string, trimmed the same
 * way, with directory placeholders resolved at this single point every consumer
 * reads from (the temporary rules registered on invocation, the list handed
 * back to the `Skill` tool, and the rules a forked subagent inherits).
 *
 * Resolution belongs here rather than at each consumer: a rule left holding a
 * literal placeholder never matches anything, so it is dropped and reported
 * instead of being registered as a no-op (spec ecosystem/agent-skills 场景 4/5).
 */
function parseToolRules(
  raw: string | string[] | undefined,
  field: "allowed-tools" | "disallowed-tools",
  context: { skillPath: string; pluginRoot?: string; warnings: string[] },
): string[] | undefined {
  let rules: string[] | undefined;
  if (Array.isArray(raw)) {
    rules = raw.map((t) => String(t).trim());
  } else if (typeof raw === "string") {
    rules = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  if (!rules?.length) {
    return rules;
  }

  const resolved: string[] = [];
  for (const rule of rules) {
    const substituted = substituteDirectoryPlaceholders(rule, {
      skillPath: context.skillPath,
      pluginRoot: context.pluginRoot,
    });
    const unresolved = findUnresolvedDirectoryPlaceholders(substituted);
    if (unresolved.length > 0) {
      context.warnings.push(
        `${field} rule "${rule}" keeps ${unresolved.join(", ")} — ` +
          `no path to substitute it with, so the rule is not registered ` +
          `and its command will ask for confirmation`,
      );
      continue;
    }
    resolved.push(substituted);
  }
  return resolved;
}

/**
 * Read the `aliases` frontmatter field: a YAML list or a comma-separated
 * string, same two shapes `allowed-tools` accepts.
 *
 * Each entry is held to the same name rule as the skill's own name
 * (`isValidSkillName`) because an alias becomes a `/…` command verbatim — a
 * lowercase word with hyphens and nothing else. Invalid, blank and duplicate
 * entries are dropped one by one with a warning; keeping the rest is the point
 * (spec ecosystem/agent-skills 场景「写错一个别名不该让整个技能失效」).
 */
function parseAliases(
  raw: string | string[] | undefined,
  warnings: string[],
): string[] | undefined {
  const candidates = Array.isArray(raw)
    ? raw.map((alias) => String(alias).trim())
    : typeof raw === "string"
      ? raw.split(",").map((alias) => alias.trim())
      : [];

  const aliases: string[] = [];
  for (const alias of candidates) {
    if (alias.length === 0) continue;
    if (!isValidSkillName(alias)) {
      warnings.push(
        `aliases entry "${alias}" is not a valid command name (lowercase ` +
          `letters, numbers and hyphens, at most 64 characters) — it is ` +
          `ignored and the skill keeps its other names`,
      );
      continue;
    }
    if (aliases.includes(alias)) continue;
    aliases.push(alias);
  }

  return aliases.length > 0 ? aliases : undefined;
}

/**
 * Simple YAML frontmatter parser for skill files.
 *
 * The value parsing lives in `frontmatterYaml.ts` so skills, subagents, custom
 * slash commands, memory rules and memory files all read frontmatter the same
 * way (block scalars included — see spec `ecosystem/agent-skills` 场景 2).
 * Here we only narrow the result to the fields a skill declares.
 */
function parseYamlFrontmatter(yamlContent: string): SkillFrontmatter {
  const parsed = parseFrontmatterYaml(yamlContent);
  const asString = (key: string): string | undefined => {
    const value = parsed[key];
    return typeof value === "string" ? value : undefined;
  };

  return {
    ...parsed,
    // Required fields must be strings: a bare `name:` / `description:` key
    // parses to a list, which validation reports as missing.
    name: asString("name") ?? "",
    description: asString("description") ?? "",
  };
}

/**
 * Validate skill metadata according to requirements
 */
export function validateSkillMetadata(metadata: SkillMetadata): string[] {
  const errors: string[] = [];

  // Import SKILL_DEFAULTS dynamically to avoid circular imports
  const NAME_PATTERN = /^[a-z0-9-]+$/;
  const MAX_NAME_LENGTH = 64;
  const MIN_DESCRIPTION_LENGTH = 1;

  // Validate name
  if (!metadata.name) {
    errors.push("Skill name is required");
  } else {
    if (metadata.name.length > MAX_NAME_LENGTH) {
      errors.push(`Skill name must be ${MAX_NAME_LENGTH} characters or less`);
    }
    if (!NAME_PATTERN.test(metadata.name)) {
      errors.push(
        "Skill name must contain only lowercase letters, numbers, and hyphens",
      );
    }
  }

  // Validate description (no length limit, aligned with Claude Code which
  // truncates long descriptions at render time instead of rejecting the skill)
  if (!metadata.description) {
    errors.push("Skill description is required");
  } else {
    if (metadata.description.length < MIN_DESCRIPTION_LENGTH) {
      errors.push(
        `Skill description must be at least ${MIN_DESCRIPTION_LENGTH} character`,
      );
    }
  }

  return errors;
}

/**
 * Check if a skill name is valid format
 */
export function isValidSkillName(name: string): boolean {
  const NAME_PATTERN = /^[a-z0-9-]+$/;
  const MAX_NAME_LENGTH = 64;

  return (
    name.length > 0 && name.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(name)
  );
}

/**
 * Generate user-friendly error messages for skill validation
 */
export function formatSkillError(skillPath: string, errors: string[]): string {
  const header = `Skill validation failed for ${skillPath}:`;
  const errorList = errors.map((error) => `  • ${error}`).join("\n");

  const suggestions = [
    "To fix this skill:",
    "  1. Ensure SKILL.md has valid YAML frontmatter (---...---)",
    "  2. Include required fields: name and description",
    "  3. Use lowercase letters, numbers, and hyphens only for name",
    "  4. Keep name under 64 characters",
  ].join("\n");

  return `${header}\n${errorList}\n\n${suggestions}`;
}
