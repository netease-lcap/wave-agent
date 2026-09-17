import { readFileSync } from "fs";
import { dirname } from "path";
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
  const { validateMetadata = true, basePath } = options;

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
    isValid: false,
  };

  try {
    // Read file content
    const content = readFileSync(filePath, "utf-8");
    result.content = content;

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) {
      result.validationErrors.push("Missing YAML frontmatter");
      return result;
    }

    const yamlContent = frontmatterMatch[1];
    result.frontmatter = parseYamlFrontmatter(yamlContent);

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
    let allowedTools: string[] | undefined;
    const rawAllowedTools = result.frontmatter["allowed-tools"];
    if (Array.isArray(rawAllowedTools)) {
      allowedTools = rawAllowedTools.map((t) => String(t).trim());
    } else if (typeof rawAllowedTools === "string") {
      allowedTools = rawAllowedTools
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    }

    // Extract disable-model-invocation
    const disableModelInvocation =
      result.frontmatter["disable-model-invocation"] === true ||
      result.frontmatter["disable-model-invocation"] === "true";

    // Extract user-invocable (default to true)
    const userInvocable =
      result.frontmatter["user-invocable"] === undefined ||
      result.frontmatter["user-invocable"] === true ||
      result.frontmatter["user-invocable"] === "true";

    result.skillMetadata = {
      name: result.frontmatter.name,
      description: result.frontmatter.description,
      type: skillType,
      skillPath,
      allowedTools,
      context: result.frontmatter.context,
      agent: result.frontmatter.agent,
      model: result.frontmatter.model as string | undefined,
      disableModelInvocation,
      userInvocable,
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
 * Simple YAML frontmatter parser for skill files.
 *
 * Handles the subset skills actually use: `key: value`, block lists (`key:` +
 * indented `- item`), block scalars (`key: >-` / `key: |` and their chomping
 * variants) and indented multi-line plain scalars. Block scalars matter in
 * practice — a folded `description: >-` used to be parsed as the literal string
 * ">-", which silently threw away the whole "when to use this skill" text
 * (spec ecosystem/agent-skills 场景 2).
 */
function parseYamlFrontmatter(yamlContent: string): SkillFrontmatter {
  const frontmatter: SkillFrontmatter = { name: "", description: "" };

  try {
    const lines = yamlContent.split("\n");
    let currentKey: string | null = null;

    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index].replace(/\r$/, "");
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const indent = raw.length - raw.trimStart().length;

      // Check for list item
      if (trimmed.startsWith("-") && currentKey) {
        const value = stripQuotes(trimmed.substring(1).trim());
        if (value) {
          const existing = frontmatter[currentKey];
          if (Array.isArray(existing)) {
            (existing as string[]).push(value);
          } else {
            frontmatter[currentKey] = [value];
          }
        }
        continue;
      }

      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmed.substring(0, colonIndex).trim();
      const inlineValue = trimmed.substring(colonIndex + 1).trim();

      currentKey = key;
      if (!key) continue;

      // Block scalar: `>-`, `|`, `>+`, `|-`, ...
      const blockIndicator = /^([>|])([-+]?)$/.exec(inlineValue);
      if (blockIndicator) {
        const block = readBlockScalar(
          lines,
          index + 1,
          indent,
          blockIndicator[1] as ">" | "|",
        );
        // Same treatment as inline scalars: chomping indicators only decide how
        // the block's line breaks are trimmed, and a metadata scalar never
        // keeps leading/trailing whitespace.
        frontmatter[key] = block.text.trim();
        index = block.nextIndex - 1;
        continue;
      }

      if (inlineValue) {
        frontmatter[key] = stripQuotes(inlineValue);
        continue;
      }

      // Key with no inline value: either an indented list or an indented
      // (multi-line) scalar.
      const continuation = readIndentedValue(lines, index + 1, indent);
      index = continuation.nextIndex - 1;
      if (continuation.items) {
        frontmatter[key] = continuation.items;
      } else {
        frontmatter[key] = continuation.text ?? [];
      }
    }
  } catch {
    // Return empty frontmatter on parse error - validation will catch missing fields
  }

  return frontmatter;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

/**
 * Fold a block scalar's lines: `|` keeps line breaks, `>` folds single breaks
 * into spaces and keeps blank-line paragraph breaks.
 */
function foldBlockLines(lines: string[], indicator: ">" | "|"): string {
  if (indicator === "|") return lines.join("\n");

  let text = "";
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (index > 0) {
      const previous = lines[index - 1];
      text += previous === "" || line === "" ? "\n" : " ";
    }
    text += line;
  }
  return text;
}

/**
 * Read the block scalar that starts at `startIndex` (the line after its key).
 * Lines belong to the block while they are blank or indented deeper than the
 * key; the block's own indentation is taken from its first non-blank line.
 */
function readBlockScalar(
  lines: string[],
  startIndex: number,
  keyIndent: number,
  indicator: ">" | "|",
): { text: string; nextIndex: number } {
  let index = startIndex;
  let baseIndent: number | null = null;
  const collected: string[] = [];

  while (index < lines.length) {
    const raw = lines[index].replace(/\r$/, "");
    if (!raw.trim()) {
      collected.push("");
      index++;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (indent <= keyIndent) break;
    if (baseIndent === null) baseIndent = indent;
    if (indent < baseIndent) break;
    collected.push(raw.slice(baseIndent));
    index++;
  }

  // Trailing blank lines belong to the following key, not to the scalar's
  // content (chomping decides how many line breaks survive).
  while (collected.length > 0 && collected[collected.length - 1] === "") {
    collected.pop();
  }

  if (collected.length === 0) {
    return { text: "", nextIndex: index };
  }

  return {
    text: foldBlockLines(collected, indicator),
    nextIndex: index,
  };
}

/**
 * Read the value of a key whose value starts on the following lines: an
 * indented block list (`- item`) or an indented multi-line plain scalar (folded
 * with spaces).
 */
function readIndentedValue(
  lines: string[],
  startIndex: number,
  keyIndent: number,
): { items?: string[]; text?: string; nextIndex: number } {
  let index = startIndex;
  const items: string[] = [];
  const textLines: string[] = [];
  let sawListItem = false;

  while (index < lines.length) {
    const raw = lines[index].replace(/\r$/, "");
    if (!raw.trim()) break;
    const indent = raw.length - raw.trimStart().length;
    if (indent <= keyIndent) break;

    const trimmed = raw.trim();
    if (trimmed.startsWith("- ")) {
      sawListItem = true;
      items.push(stripQuotes(trimmed.substring(1).trim()));
    } else if (sawListItem) {
      break;
    } else {
      textLines.push(trimmed);
    }
    index++;
  }

  if (sawListItem) return { items, nextIndex: index };
  if (textLines.length === 0) return { nextIndex: index };
  return { text: textLines.join(" "), nextIndex: index };
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
