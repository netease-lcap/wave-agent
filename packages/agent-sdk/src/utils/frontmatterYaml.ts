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
 * back empty, and the failure travels out as `parseError` so the owner can say
 * what happened. What each owner does with it is its own call, and it mirrors
 * Claude Code: a skill keeps loading with every field dropped (name from the
 * directory, description from the body's first line — which is also why the
 * built-in `code-review` skill quotes its description rather than leaning on
 * that fallback), a memory rule loses its `paths` scope and therefore applies to
 * every file, a subagent is rejected. The failure is logged at error level, with
 * the file's path whenever the caller knows it, because "every field silently
 * stopped applying" is otherwise invisible: CC writes the same line for custom
 * commands, and its rules loader is the one that says nothing at all.
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

export interface FrontmatterParseResult {
  frontmatter: ParsedFrontmatter;
  /** The parser's message when the block is not valid YAML; absent otherwise. */
  parseError?: string;
}

/**
 * Read a frontmatter block (without the `---` delimiters) and keep the parser's
 * complaint, for the owners that react to it rather than just reading fields
 * (a skill falls back to its directory name and its body's first line, spec
 * `ecosystem/agent-skills`; the rest only need the fields and call
 * {@link parseFrontmatterYaml}).
 *
 * Never throws: a block that is not valid YAML, or that parses to something
 * other than a table (a bare scalar, a list, nothing at all), yields an empty
 * table. `sourcePath` is the file the block came from — only used to say which
 * file in the log line.
 */
export function readFrontmatterYaml(
  yamlContent: string,
  sourcePath?: string,
): FrontmatterParseResult {
  let document: unknown;
  try {
    document = parse(yamlContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Error, not warn: the artifact keeps working with every field dropped
    // (allowed-tools, model, hooks … silently stop applying), so this line is
    // the only trace an author gets. Claude Code words it the same way for
    // custom commands — "YAML frontmatter in <path> failed to parse and was
    // ignored" — and says nothing for rules at all, which is the behaviour this
    // one line exists to avoid.
    logger.error(
      `Failed to parse YAML frontmatter${sourcePath ? ` in ${sourcePath}` : ""}: ${message}`,
    );
    return { frontmatter: {}, parseError: message };
  }
  if (!isTable(document)) return { frontmatter: {} };
  const frontmatter: ParsedFrontmatter = {};
  const visiting = new Set<object>();
  for (const [key, value] of Object.entries(document)) {
    frontmatter[key] = toFrontmatterValue(value, visiting);
  }
  return { frontmatter };
}

/**
 * The fields alone, for the owners that only read them. A block that is not
 * valid YAML comes back empty — see {@link readFrontmatterYaml} for the failure
 * itself.
 */
export function parseFrontmatterYaml(
  yamlContent: string,
  sourcePath?: string,
): ParsedFrontmatter {
  return readFrontmatterYaml(yamlContent, sourcePath).frontmatter;
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
