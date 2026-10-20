import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({}));

import {
  definitionBody,
  SNIPPET_OPTIONS,
  type SnippetOptions,
} from "../../src/services/completionSnippets";

type TextDocument = Parameters<typeof definitionBody>[0];
type Range = Parameters<typeof definitionBody>[1];

/** Just enough of a `TextDocument` for the body reader. */
function doc(lines: string[]): TextDocument {
  return {
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] }),
  } as unknown as TextDocument;
}

function startLine(line: number): Range {
  return { start: { line } } as unknown as Range;
}

function options(maxDefinitionLines: number): SnippetOptions {
  return { ...SNIPPET_OPTIONS, maxDefinitionLines };
}

describe("definitionBody", () => {
  it("returns a single-line declaration as-is", () => {
    const body = definitionBody(
      doc([
        'import { x } from "./x";',
        "export function formatDate(date: Date): string {",
        "  return date.toISOString();",
        "}",
      ]),
      startLine(1),
      options(15),
    );

    expect(body).toBe(
      [
        "export function formatDate(date: Date): string {",
        "  return date.toISOString();",
        "}",
      ].join("\n"),
    );
  });

  it("stops at the first line that dedents back to the declaration level", () => {
    const body = definitionBody(
      doc([
        "export function formatDate(date: Date): string {",
        "  return date.toISOString();",
        "}",
        "export function formatMoney(): string {",
        "  return '0';",
        "}",
      ]),
      startLine(0),
      options(15),
    );

    expect(body).not.toContain("formatMoney");
  });

  it("keeps only the signature when the body exceeds the line budget", () => {
    const body = definitionBody(
      doc([
        "export function big(a: number): number {",
        "  const one = 1;",
        "  const two = 2;",
        "  const three = 3;",
        "  return a + one + two + three;",
        "}",
      ]),
      startLine(0),
      options(3),
    );

    expect(body).toBe("export function big(a: number): number {");
  });

  it("is undefined for an empty definition", () => {
    expect(
      definitionBody(doc([""]), startLine(0), options(15)),
    ).toBeUndefined();
  });

  it("is undefined when the range starts past the end of the document", () => {
    expect(
      definitionBody(doc(["a"]), startLine(3), options(15)),
    ).toBeUndefined();
  });
});
