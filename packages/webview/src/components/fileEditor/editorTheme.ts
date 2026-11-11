/**
 * Shared CodeMirror dressing for the file panel: syntax mode, token palette and
 * chrome. Both surfaces use it — the editor (`createCodeEditor`) and the
 * read-only viewer (`readOnlyCodeView`) — so a file looks the same before and
 * after the user hits 「编辑」, and the viewer keeps the 20px line rhythm the
 * panel's jump-to-line math assumes.
 */
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import {
  c,
  cpp,
  csharp,
  java,
  kotlin,
} from "@codemirror/legacy-modes/mode/clike";
import { css, less, sCSS } from "@codemirror/legacy-modes/mode/css";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { go } from "@codemirror/legacy-modes/mode/go";
import { json } from "@codemirror/legacy-modes/mode/javascript";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { python } from "@codemirror/legacy-modes/mode/python";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { sass } from "@codemirror/legacy-modes/mode/sass";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { html, xml } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** Extension → CodeMirror language. Unknown extensions fall back to plain text. */
export const languageFor = (filePath: string): Extension => {
  const ext = filePath.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "mts":
    case "cts":
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "json":
    case "jsonc":
      return StreamLanguage.define(json);
    case "html":
    case "htm":
      return StreamLanguage.define(html);
    case "svg":
    case "xml":
      return StreamLanguage.define(xml);
    case "css":
      return StreamLanguage.define(css);
    case "scss":
      return StreamLanguage.define(sCSS);
    case "less":
      return StreamLanguage.define(less);
    case "sass":
      return StreamLanguage.define(sass);
    case "yml":
    case "yaml":
      return StreamLanguage.define(yaml);
    case "py":
      return StreamLanguage.define(python);
    case "java":
      return StreamLanguage.define(java);
    case "go":
      return StreamLanguage.define(go);
    case "rs":
      return StreamLanguage.define(rust);
    case "c":
    case "h":
      return StreamLanguage.define(c);
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
      return StreamLanguage.define(cpp);
    case "cs":
      return StreamLanguage.define(csharp);
    case "kt":
    case "kts":
      return StreamLanguage.define(kotlin);
    case "swift":
      return StreamLanguage.define(swift);
    case "sh":
    case "bash":
    case "zsh":
      return StreamLanguage.define(shell);
    case "sql":
      return StreamLanguage.define(standardSQL);
    case "rb":
      return StreamLanguage.define(ruby);
    case "toml":
      return StreamLanguage.define(toml);
    case "ini":
      return StreamLanguage.define(properties);
    case "diff":
    case "patch":
      return StreamLanguage.define(diff);
    case "proto":
      return StreamLanguage.define(protobuf);
    // No CodeMirror mode: plain text (php/makefile and anything unmapped).
    case "php":
    case "makefile":
    case "mk":
    default:
      return [];
  }
};

/** Token palette — GitHub's light/dark editor colours, which sit close to the
 *  panel's highlight.js theme in both app themes. */
export const highlightStyle = (dark: boolean) =>
  HighlightStyle.define(
    dark
      ? [
          { tag: [tags.keyword, tags.operatorKeyword], color: "#ff7b72" },
          { tag: [tags.name, tags.deleted, tags.character], color: "#ffa657" },
          { tag: [tags.propertyName, tags.attributeName], color: "#79c0ff" },
          {
            tag: [tags.function(tags.variableName), tags.labelName],
            color: "#d2a8ff",
          },
          {
            tag: [tags.typeName, tags.className, tags.namespace],
            color: "#ffa657",
          },
          { tag: [tags.number, tags.bool, tags.null], color: "#79c0ff" },
          { tag: [tags.string, tags.special(tags.string)], color: "#a5d6ff" },
          { tag: [tags.comment, tags.meta], color: "#8b949e" },
          { tag: [tags.tagName, tags.heading], color: "#7ee787" },
          { tag: [tags.operator, tags.punctuation], color: "#c9d1d9" },
          { tag: tags.invalid, color: "#f85149" },
        ]
      : [
          { tag: [tags.keyword, tags.operatorKeyword], color: "#cf222e" },
          { tag: [tags.name, tags.deleted, tags.character], color: "#953800" },
          { tag: [tags.propertyName, tags.attributeName], color: "#0550ae" },
          {
            tag: [tags.function(tags.variableName), tags.labelName],
            color: "#8250df",
          },
          {
            tag: [tags.typeName, tags.className, tags.namespace],
            color: "#953800",
          },
          { tag: [tags.number, tags.bool, tags.null], color: "#0550ae" },
          { tag: [tags.string, tags.special(tags.string)], color: "#0a3069" },
          { tag: [tags.comment, tags.meta], color: "#6e7781" },
          { tag: [tags.tagName, tags.heading], color: "#116329" },
          { tag: [tags.operator, tags.punctuation], color: "#24292f" },
          { tag: tags.invalid, color: "#cf222e" },
        ],
  );

/** Chrome kept deliberately close to the read-only viewer: monospace, 20px line
 *  rhythm (so the panel's jump-to-line math still holds), no wrapping. */
export const chrome = (dark: boolean) =>
  EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: "transparent",
        color: "var(--vscode-editor-foreground, #cccccc)",
        fontSize: "12px",
      },
      ".cm-scroller": {
        fontFamily:
          "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)",
        lineHeight: "20px",
        overflow: "auto",
      },
      ".cm-content": {
        padding: "0 0 120px 0",
        caretColor: "var(--vscode-editor-foreground, #cccccc)",
      },
      ".cm-gutters": {
        // Opaque on purpose: the gutter is pinned over the scrolling content, so
        // a transparent one lets horizontally scrolled code show through the
        // line numbers (spec「文件面板」场景 11 asks for the number column to
        // stay put, which only reads correctly if the code slides *under* it).
        backgroundColor:
          "var(--vscode-sideBar-background, var(--vscode-panel-background))",
        color: "var(--vscode-editorLineNumber-foreground, #858585)",
        border: "none",
        userSelect: "none",
      },
      // The 8px gap to the code sits on the cells, not on the column: a
      // background painted on a cell (the jump-to band) has to reach the code
      // edge, otherwise the band is broken by a dark strip.
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 8px 0 5px",
      },
      ".cm-activeLine": {
        backgroundColor:
          "var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.04))",
      },
      ".cm-activeLineGutter": {
        backgroundColor:
          "var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.04))",
        color: "var(--vscode-editorLineNumber-activeForeground, #c6c6c6)",
      },
      ".cm-cursor": {
        borderLeftColor: "var(--vscode-editor-foreground, #cccccc)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection":
        {
          backgroundColor:
            "var(--vscode-editor-selectionBackground, rgba(38,79,120,0.7))",
        },
      "&.cm-focused": { outline: "none" },
    },
    { dark },
  );
