import { parse } from "yaml";
import { logger } from "./globalLogger.js";

/**
 * Shared YAML frontmatter reader for wave's markdown artifacts: skills
 * (SKILL.md), subagents, custom slash commands, memory rules and memory files.
 *
 * The block is parsed with the `yaml` package, because frontmatter nests now: a
 * skill's `hooks` table is a mapping of events to lists of hook configurations,
 * which the flat `key: value` reader this module used to be could not express
 * (spec `automation/skill-hooks`).
 *
 * Leaves are still strings all the way down — lists and tables nest, scalar
 * values do not coerce: `true` reads as "true", `30` as "30", a key with no
 * value as "". All five artifacts compare against "true" or parseInt the value,
 * so handing out a real boolean or number would silently change their behavior.
 * Timestamps are not resolved to Date objects either (core schema): a
 * `released: 2024-01-02` line stays the string, not midnight UTC.
 *
 * A block that is not valid YAML is not half-read: the whole frontmatter comes
 * back empty, so the artifact that owns it is rejected with a warning instead of
 * silently losing a field or two. That is what Claude Code does (a skill whose
 * frontmatter fails to parse is skipped, not loaded with defaults), and the one
 * file this used to punish — the built-in `code-review` skill, whose description
 * carries an unquoted colon — now quotes its value.
 */
export type FrontmatterValue =
  | string
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };
export type ParsedFrontmatter = Record<string, FrontmatterValue>;

const FRONTMATTER_REGEX =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/**
 * Split a markdown file into its leading `---` frontmatter block and the body.
 * `yaml` is null when the file has no frontmatter; the body is then the whole
 * content, untrimmed.
 */
export function splitFrontmatter(content: string): {
  yaml: string | null;
  body: string;
} {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { yaml: null, body: content };
  }
  return { yaml: match[1], body: match[2] ?? "" };
}

/**
 * Parse a frontmatter block (without the `---` delimiters) into key/value
 * pairs. Never throws: a block that is not valid YAML, or that parses to
 * something other than a table (a bare scalar, a list, nothing at all), yields
 * an empty object — the caller reports the missing required fields, which is how
 * a broken frontmatter takes its artifact down.
 */
export function parseFrontmatterYaml(yamlContent: string): ParsedFrontmatter {
  let document: unknown;
  try {
    document = parse(yamlContent);
  } catch (error) {
    // Same diagnosis Claude Code logs: the artifact is skipped, but the reason
    // ("Nested mappings are not allowed in compact mappings at line 4, ...")
    // has to be discoverable.
    logger.warn(
      `Failed to parse YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
  if (!isTable(document)) return {};
  const frontmatter: ParsedFrontmatter = {};
  const visiting = new Set<object>();
  for (const [key, value] of Object.entries(document)) {
    frontmatter[key] = toFrontmatterValue(value, visiting);
  }
  return frontmatter;
}

/**
 * Normalize one parsed node: lists and tables keep their shape, every leaf
 * becomes a string. `visiting` holds the containers on the current path so an
 * anchor pointing back at its own parent (YAML aliases can build real cycles)
 * becomes "" instead of recursing forever.
 */
function toFrontmatterValue(
  value: unknown,
  visiting: Set<object>,
): FrontmatterValue {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (visiting.has(value)) return "";
    visiting.add(value);
    const list = value.map((item) => toFrontmatterValue(item, visiting));
    visiting.delete(value);
    return list;
  }
  if (isTable(value)) {
    if (visiting.has(value)) return "";
    visiting.add(value);
    const table: { [key: string]: FrontmatterValue } = {};
    for (const [key, item] of Object.entries(value)) {
      table[key] = toFrontmatterValue(item, visiting);
    }
    visiting.delete(value);
    return table;
  }
  return String(value);
}

function isTable(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
