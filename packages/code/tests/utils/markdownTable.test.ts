import { describe, it, expect } from "vitest";
import { marked, type Token, type Tokens } from "marked";
import {
  renderMarkdownTable,
  wrapText,
  padAligned,
} from "../../src/utils/markdownTable.js";

/** Lex markdown text and return the first table token */
const lexTable = (md: string): Tokens.Table => {
  const tokens = marked.lexer(md);
  const table = tokens.find((t) => t.type === "table");
  if (!table) throw new Error("no table token in markdown");
  return table as Tokens.Table;
};

/**
 * Mimics the AnsiRenderer binding in Markdown.tsx: raw inline text,
 * with `<br>` mapped to a newline (renderer.br() returns "\n").
 */
const formatInline = (tokens: Token[]): string =>
  tokens.map((t) => (t.type === "br" ? "\n" : t.raw)).join("");

describe("wrapText", () => {
  it("returns a single empty line for empty text", () => {
    expect(wrapText("", 10)).toEqual([""]);
  });

  it("wraps text at word boundaries", () => {
    // trim: false keeps the leftover space of the wrapped "hello " as a line
    expect(wrapText("hello world", 5)).toEqual(["hello", " ", "world"]);
  });

  it("keeps an over-long single word on one line without hard wrap", () => {
    expect(wrapText("aaaaaaaaaa", 5)).toEqual(["aaaaaaaaaa"]);
  });

  it("breaks over-long words with hard wrap", () => {
    expect(wrapText("aaaaaaaaaa", 5, { hard: true })).toEqual([
      "aaaaa",
      "aaaaa",
    ]);
  });

  it("filters empty lines from trailing newlines", () => {
    expect(wrapText("hello\n", 10)).toEqual(["hello"]);
  });
});

describe("padAligned", () => {
  it("pads right for left alignment", () => {
    expect(padAligned("ab", 2, 4, "left")).toBe("ab  ");
  });

  it("centers with left bias for odd padding", () => {
    expect(padAligned("ab", 2, 4, "center")).toBe(" ab ");
    expect(padAligned("a", 1, 4, "center")).toBe(" a  ");
  });

  it("pads left for right alignment", () => {
    expect(padAligned("ab", 2, 4, "right")).toBe("  ab");
  });

  it("defaults to left alignment for null/undefined", () => {
    expect(padAligned("ab", 2, 4, null)).toBe("ab  ");
    expect(padAligned("ab", 2, 4, undefined)).toBe("ab  ");
  });

  it("does not shrink content wider than target", () => {
    expect(padAligned("abcdef", 6, 4, "left")).toBe("abcdef");
  });
});

describe("renderMarkdownTable", () => {
  it("renders a simple table with box-drawing borders and centered headers", () => {
    const table = lexTable("| H1 | H2 |\n| --- | --- |\n| C1 | C2 |");
    const out = renderMarkdownTable(table, 80, formatInline);
    expect(out).toBe(
      [
        "┌─────┬─────┐",
        "│ H1  │ H2  │",
        "├─────┼─────┤",
        "│ C1  │ C2  │",
        "└─────┴─────┘",
      ].join("\n"),
    );
  });

  it("centers headers and aligns data per alignment directives", () => {
    const table = lexTable(
      "| Left | Center | Right |\n| :--- | :----: | ----: |\n| a | bb | ccc |",
    );
    const out = renderMarkdownTable(table, 80, formatInline);
    expect(out).toBe(
      [
        "┌──────┬────────┬───────┐",
        "│ Left │ Center │ Right │",
        "├──────┼────────┼───────┤",
        "│ a    │   bb   │   ccc │",
        "└──────┴────────┴───────┘",
      ].join("\n"),
    );
  });

  it("measures CJK characters by display width (2 columns each)", () => {
    const table = lexTable("| 名字 | 值 |\n| --- | --- |\n| ab | 中文 |");
    const out = renderMarkdownTable(table, 80, formatInline);
    // If CJK chars were measured by .length instead of display width,
    // "中文" would be padded as 2-wide and the cell would misalign.
    expect(out).toBe(
      [
        "┌──────┬──────┐",
        "│ 名字 │  值  │",
        "├──────┼──────┤",
        "│ ab   │ 中文 │",
        "└──────┴──────┘",
      ].join("\n"),
    );
  });

  it("scales wide tables down and wraps cells instead of truncating", () => {
    const md = `| ${"A".repeat(10)} | ${"B".repeat(10)} |\n| --- | --- |\n| ${"C".repeat(10)} | ${"D".repeat(10)} |`;
    const table = lexTable(md);
    const out = renderMarkdownTable(table, 20, formatInline);
    // Border of a 2-column table with 4-wide columns
    expect(out).toContain("┌──────┬──────┐");
    // Content is wrapped, not truncated: all characters present
    expect((out.match(/A/g) ?? []).length).toBe(10);
    expect((out.match(/C/g) ?? []).length).toBe(10);
    // Rows became multi-line
    expect(out.split("\n").filter((l) => l.includes("│"))).toHaveLength(6);
  });

  it("falls back to vertical format when the table overflows the terminal", () => {
    const table = lexTable(
      "| Name | Value | Extra |\n| --- | --- | --- |\n| a | b | c |\n| d | e | f |",
    );
    const out = renderMarkdownTable(table, 16, formatInline);
    expect(out).not.toContain("┌");
    expect(out).toContain("─".repeat(15)); // separator = min(columns-1, 40)
    expect(out).toContain("\x1b[1mName:\x1b[22m a");
    expect(out).toContain("\x1b[1mValue:\x1b[22m b");
    expect(out).toContain("\x1b[1mExtra:\x1b[22m c");
    expect(out).toContain("\x1b[1mExtra:\x1b[22m f");
  });

  it("falls back to vertical format when a row wraps taller than 4 lines", () => {
    const md =
      "| A | B |\n| --- | --- |\n| " + "longword ".repeat(20) + " | x |";
    const table = lexTable(md);
    const out = renderMarkdownTable(table, 40, formatInline);
    expect(out).not.toContain("┌");
    expect(out).toContain("\x1b[1mA:\x1b[22m");
    // Cell content survives with internal whitespace collapsed
    expect(out.replace(/\s+/g, " ")).toContain("longword longword");
  });

  it("keeps ANSI styling in cells without breaking width computation", () => {
    const ansiFormat = (tokens: Token[]): string =>
      tokens.map((t) => `\x1b[1m${t.raw}\x1b[22m`).join("");
    const table = lexTable("| H1 | H2 |\n| --- | --- |\n| C1 | C2 |");
    const out = renderMarkdownTable(table, 80, ansiFormat);
    expect(out).toContain("┌─────┬─────┐");
    expect(out).toContain("\x1b[1mC1\x1b[22m");
    // Stripping ANSI yields identical layout to the plain render
    const plain = renderMarkdownTable(table, 80, formatInline);
    const ansiPattern = new RegExp("\\x" + "1b\\[1m|\\x" + "1b\\[22m", "g");
    expect(out.replace(ansiPattern, "")).toBe(plain);
  });
});
