import { readFileSync } from "fs";
import { dirname } from "path";
import type {
  ParsedSkillFile,
  SkillParseOptions,
  SkillFrontmatter,
  SkillMetadata,
} from "../types.js";

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
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
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
    const skillType = skillPath.includes("/.wave/skills")
      ? "project"
      : "personal";

    result.skillMetadata = {
      name: result.frontmatter.name,
      description: result.frontmatter.description,
      type: skillType,
      skillPath,
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
 * Simple YAML frontmatter parser for skill files
 */
function parseYamlFrontmatter(yamlContent: string): SkillFrontmatter {
  const frontmatter: SkillFrontmatter = { name: "", description: "" };

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
        frontmatter[key] = value;
      }
    }
  } catch {
    // Return empty frontmatter on parse error - validation will catch missing fields
  }

  return frontmatter;
}

/**
 * Validate skill metadata according to requirements
 */
export function validateSkillMetadata(metadata: SkillMetadata): string[] {
  const errors: string[] = [];

  // Import SKILL_DEFAULTS dynamically to avoid circular imports
  const NAME_PATTERN = /^[a-z0-9-]+$/;
  const MAX_NAME_LENGTH = 64;
  const MAX_DESCRIPTION_LENGTH = 1024;
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

  // Validate description
  if (!metadata.description) {
    errors.push("Skill description is required");
  } else {
    if (metadata.description.length < MIN_DESCRIPTION_LENGTH) {
      errors.push(
        `Skill description must be at least ${MIN_DESCRIPTION_LENGTH} character`,
      );
    }
    if (metadata.description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(
        `Skill description must be ${MAX_DESCRIPTION_LENGTH} characters or less`,
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
    "  4. Keep name under 64 characters and description under 1024 characters",
  ].join("\n");

  return `${header}\n${errorList}\n\n${suggestions}`;
}
