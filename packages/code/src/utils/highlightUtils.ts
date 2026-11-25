import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import csharp from "highlight.js/lib/languages/csharp";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import ini from "highlight.js/lib/languages/ini";
import chalk from "chalk";
import { logger } from "./logger.js";

// Register only the languages we auto-detect (the full default import pulls
// in all 384 languages, ~1.5MB of the bundle).
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("php", php);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("ini", ini);

// highlight.js scopes -> chalk styles. Keys are hljs "scope" names
// ("title.function", "built_in", ...), i.e. the first segment of the CSS class
// the HTML renderer would have emitted. A tiered scope falls back to its first
// segment, which is why "title.function" still lands on "title".
const theme: Record<string, (text: string) => string> = {
  keyword: chalk.blue,
  built_in: chalk.cyan,
  type: chalk.cyan,
  literal: chalk.magenta,
  number: chalk.magenta,
  operator: chalk.white,
  punctuation: chalk.white,
  property: chalk.yellow,
  attr: chalk.yellow,
  variable: chalk.white,
  "template-variable": chalk.white,
  string: chalk.green,
  char: chalk.green,
  comment: chalk.gray,
  doctag: chalk.gray,
  function: chalk.yellow,
  title: chalk.yellow,
  params: chalk.white,
  tag: chalk.blue,
  name: chalk.blue,
  "selector-tag": chalk.blue,
  "selector-id": chalk.blue,
  "selector-class": chalk.blue,
  "selector-attr": chalk.blue,
  "selector-pseudo": chalk.blue,
  subst: chalk.white,
  section: chalk.blue.bold,
  bullet: chalk.magenta,
  emphasis: chalk.italic,
  strong: chalk.bold,
  addition: chalk.green,
  deletion: chalk.red,
  link: chalk.blue.underline,
};

const AUTO_DETECT_LANGUAGES = [
  "javascript",
  "typescript",
  "bash",
  "json",
  "markdown",
  "python",
  "yaml",
  "html",
  "css",
  "sql",
  "xml",
  "rust",
  "go",
  "java",
  "cpp",
  "c",
  "csharp",
  "php",
  "ruby",
  "swift",
  "kotlin",
  "toml",
  "ini",
];

function lookupStyle(scope: string): ((text: string) => string) | undefined {
  return theme[scope] ?? theme[scope.split(".")[0]];
}

// The token tree behind highlight.js's HTML output is internal API: 11.x marks
// _emitter private (it types only "emitter"), and the node layout has changed
// between majors (10.x used "kind", 11.x uses "scope"). Everything crossing
// that boundary is unknown and validated here, so a version bump degrades to
// plain text with one log line instead of rendering garbage — an
// "as unknown as" cast is what hid exactly such a mismatch in the past.
function hasTokenTree(
  result: unknown,
): result is { _emitter: { rootNode: { children: unknown[] } } } {
  if (
    typeof result !== "object" ||
    result === null ||
    !("_emitter" in result)
  ) {
    return false;
  }
  const { _emitter } = result;
  if (
    typeof _emitter !== "object" ||
    _emitter === null ||
    !("rootNode" in _emitter)
  ) {
    return false;
  }
  const { rootNode } = _emitter;
  if (
    typeof rootNode !== "object" ||
    rootNode === null ||
    !("children" in rootNode)
  ) {
    return false;
  }
  return Array.isArray(rootNode.children);
}

// Returns null for anything that is neither a string leaf nor a node with a
// children array: a version bump that reshapes the nodes (10.x used
// { kind, value }) must degrade the whole block, not silently drop text.
function nodeToAnsi(
  node: unknown,
  inherited: ((text: string) => string) | undefined,
): string | null {
  if (typeof node === "string") {
    return inherited ? inherited(node) : node;
  }
  if (
    typeof node !== "object" ||
    node === null ||
    !("children" in node) ||
    !Array.isArray(node.children)
  ) {
    return null;
  }
  const scope =
    "scope" in node && typeof node.scope === "string" ? node.scope : undefined;
  const style = (scope ? lookupStyle(scope) : undefined) ?? inherited;
  const parts: string[] = [];
  for (const child of node.children) {
    const rendered = nodeToAnsi(child, style);
    if (rendered === null) {
      return null;
    }
    parts.push(rendered);
  }
  return parts.join("");
}

let loggedTokenTreeShapeError = false;

export function highlightToAnsi(code: string, language?: string): string {
  if (!code) {
    return "";
  }
  // hljs.highlight logs a console.error (then throws) when the language is not
  // registered. We bundle a trimmed language set, so check first and fall back
  // to plain text instead of spamming stderr with LANGUAGE_NOT_FOUND noise.
  if (language && !hljs.getLanguage(language)) {
    return code;
  }
  try {
    const result = language
      ? hljs.highlight(code, { language })
      : hljs.highlightAuto(code, AUTO_DETECT_LANGUAGES);
    const nodes = hasTokenTree(result)
      ? result._emitter.rootNode.children
      : undefined;
    const rendered = nodes?.map((node) => nodeToAnsi(node, undefined));
    if (!rendered || rendered.some((part) => part === null)) {
      if (!loggedTokenTreeShapeError) {
        loggedTokenTreeShapeError = true;
        logger.error(
          "[highlight] highlight.js token tree shape mismatch (no _emitter.rootNode.children, or an unknown node shape); syntax highlighting disabled.",
        );
      }
      return code;
    }
    return rendered.join("");
  } catch {
    return code;
  }
}
