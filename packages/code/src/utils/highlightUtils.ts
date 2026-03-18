import hljs from "highlight.js";
import { parse, Node, HTMLElement, TextNode } from "node-html-parser";
import chalk from "chalk";

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
        // If content has newlines, split it and apply style to each line
        // to ensure ANSI codes are correctly applied when splitting the final string by lines.
        if (content.includes("\n")) {
          return content
            .split("\n")
            .map((line) => theme[className](line))
            .join("\n");
        }
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
