/**
 * Shared YAML frontmatter reader for wave's markdown artifacts: skills
 * (SKILL.md), subagents, custom slash commands, memory rules and memory files.
 *
 * Wave ships no YAML dependency, so this is a hand-rolled parser for the subset
 * those files actually use: `key: value`, block lists (`key:` + indented
 * `- item`), block scalars (`key: >-` / `key: |` and their chomping variants)
 * and indented multi-line plain scalars. Block scalars matter in practice — a
 * folded `description: >-` used to be read as the literal string ">-", which
 * silently threw away the whole "when to use this" text (see spec
 * `ecosystem/agent-skills` 场景 2, `multi-agent/subagent` 场景 6,
 * `ui/slash-commands` 场景 3, `core/memory-management` 场景 4/13).
 *
 * Values are strings or string arrays only — no boolean/number coercion — so
 * callers comparing against `"true"` or `parseInt`-ing the value keep working.
 */
export type FrontmatterValue = string | string[];
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
 * pairs. Unparseable input yields an empty object; callers that require fields
 * report the missing ones themselves.
 */
export function parseFrontmatterYaml(yamlContent: string): ParsedFrontmatter {
  const frontmatter: ParsedFrontmatter = {};

  try {
    const lines = yamlContent.split("\n");
    let currentKey: string | null = null;

    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index].replace(/\r$/, "");
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const indent = raw.length - raw.trimStart().length;

      // Block list item belonging to the key above it.
      if (trimmed.startsWith("-") && currentKey) {
        const value = stripQuotes(trimmed.substring(1).trim());
        if (value) {
          const existing = frontmatter[currentKey];
          if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            frontmatter[currentKey] = [value];
          }
        }
        continue;
      }

      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmed.substring(0, colonIndex).trim();
      if (!key) continue;
      const inlineValue = trimmed.substring(colonIndex + 1).trim();
      currentKey = key;

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

      // Key with no inline value: either an indented block list or an indented
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
    // Return whatever was parsed so far — callers validate required fields.
  }

  return frontmatter;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

/**
 * Fold a block scalar's lines the way YAML does: `|` keeps line breaks, `>`
 * folds a single break into a space and turns each blank line into one line
 * break (a blank line is a paragraph break, not two).
 */
function foldBlockLines(lines: string[], indicator: ">" | "|"): string {
  if (indicator === "|") return lines.join("\n");

  let text = "";
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === "") {
      let blanks = 0;
      while (lines[index] === "") {
        blanks++;
        index++;
      }
      index--;
      text += "\n".repeat(blanks);
      continue;
    }
    text += line;
    if (index + 1 < lines.length && lines[index + 1] !== "") {
      text += " ";
    }
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
      // Blank lines before the first content line belong to the YAML document,
      // not to the scalar; afterwards they are paragraph breaks.
      if (baseIndent !== null) collected.push("");
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
