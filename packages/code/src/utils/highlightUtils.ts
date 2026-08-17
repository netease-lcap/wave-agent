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
import { parse, Node, HTMLElement, TextNode } from "node-html-parser";
import chalk from "chalk";

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

const theme: Record<string, (text: string) => string> = {
  "hljs-keyword": chalk.blue,
  "hljs-built_in": chalk.cyan,
  "hljs-type": chalk.cyan,
  "hljs-literal": chalk.magenta,
  "hljs-number": chalk.magenta,
  "hljs-operator": chalk.white,
  "hljs-punctuation": chalk.white,
  "hljs-property": chalk.yellow,
  "hljs-attr": chalk.yellow,
  "hljs-variable": chalk.white,
  "hljs-template-variable": chalk.white,
  "hljs-string": chalk.green,
  "hljs-char": chalk.green,
  "hljs-comment": chalk.gray,
  "hljs-doctag": chalk.gray,
  "hljs-function": chalk.yellow,
  "hljs-title": chalk.yellow,
  "hljs-params": chalk.white,
  "hljs-tag": chalk.blue,
  "hljs-name": chalk.blue,
  "hljs-selector-tag": chalk.blue,
  "hljs-selector-id": chalk.blue,
  "hljs-selector-class": chalk.blue,
  "hljs-selector-attr": chalk.blue,
  "hljs-selector-pseudo": chalk.blue,
  "hljs-subst": chalk.white,
  "hljs-section": chalk.blue.bold,
  "hljs-bullet": chalk.magenta,
  "hljs-emphasis": chalk.italic,
  "hljs-strong": chalk.bold,
  "hljs-addition": chalk.green,
  "hljs-deletion": chalk.red,
  "hljs-link": chalk.blue.underline,
};

function nodeToAnsi(node: Node): string {
  if (node instanceof TextNode) {
    return node.text;
  }

  if (node instanceof HTMLElement) {
    const content = node.childNodes.map(nodeToAnsi).join("");
    const classes = node.getAttribute("class")?.split(/\s+/) || [];

    for (const className of classes) {
      if (theme[className]) {
        return theme[className](content);
      }
    }

    return content;
  }

  return "";
}

export function highlightToAnsi(code: string, language?: string): string {
  if (!code) {
    return "";
  }
  try {
    const highlighted = language
      ? hljs.highlight(code, { language }).value
      : hljs.highlightAuto(code, [
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
        ]).value;

    const root = parse(highlighted);
    return root.childNodes.map(nodeToAnsi).join("");
  } catch {
    return code;
  }
}
