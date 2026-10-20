import { describe, it, expect } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";
import {
  findSymbolsAtCursor,
  type AstOptions,
  type SymbolPoint,
} from "../../src/services/completionAst";

/**
 * These run against the real grammars — the parser is the part of cross-file
 * completion that cannot be faked, so mocking it would only test the mock. The
 * runtime and the grammars live in different packages here; in the packaged
 * extension both sit next to `extension.cjs`.
 */
const require = createRequire(import.meta.url);

const AST: AstOptions = {
  runtimeWasm: path.join(
    path.dirname(require.resolve("web-tree-sitter")),
    "tree-sitter.wasm",
  ),
  grammarDir: path.join(
    path.dirname(require.resolve("tree-sitter-wasms/package.json")),
    "out",
  ),
};

/** Splits the fixture on `|`, which marks the cursor. */
function cursor(source: string): { code: string; offset: number } {
  const offset = source.indexOf("|");
  if (offset < 0) throw new Error("fixture has no cursor marker");
  return { code: source.slice(0, offset) + source.slice(offset + 1), offset };
}

function at(row: number, column: number): SymbolPoint {
  return { row, column };
}

/** Where `needle` first appears in `code`, as a row/column pair. */
function positionOf(code: string, needle: string): SymbolPoint {
  const index = code.indexOf(needle);
  if (index < 0) throw new Error(`${needle} not in fixture`);
  const before = code.slice(0, index).split("\n");
  return at(before.length - 1, before[before.length - 1].length);
}

async function symbolsAt(
  source: string,
  languageId = "typescript",
): Promise<SymbolPoint[]> {
  const { code, offset } = cursor(source);
  const symbols = await findSymbolsAtCursor(code, offset, languageId, AST);
  if (!symbols) throw new Error(`no grammar for ${languageId}`);
  return symbols;
}

describe("findSymbolsAtCursor", () => {
  it("ranks the identifier being typed first", async () => {
    const symbols = await symbolsAt(
      [
        'import { formatDate } from "./utils/format";',
        "const label = formatD|",
      ].join("\n"),
    );

    expect(symbols[0]).toEqual(at(1, 14));
  });

  it("includes symbols the file imports", async () => {
    const symbols = await symbolsAt(
      ['import { formatDate } from "./utils/format";', "const label = |"].join(
        "\n",
      ),
    );

    expect(symbols).toContainEqual(at(0, 9));
  });

  it("keeps the original name when an import is renamed", async () => {
    const symbols = await symbolsAt(
      [
        'import { formatDate as fmt } from "./utils/format";',
        "const label = fmt|",
      ].join("\n"),
    );

    // `formatDate` is the symbol defined in the other file; `fmt` is local.
    expect(symbols).toContainEqual(at(0, 9));
  });

  it("includes default and namespace imports", async () => {
    const symbols = await symbolsAt(
      [
        'import React from "react";',
        'import * as utils from "./utils";',
        "|",
      ].join("\n"),
    );

    expect(symbols).toContainEqual(at(0, 7));
    expect(symbols).toContainEqual(at(1, 12));
  });

  it("includes the enclosing class and method names", async () => {
    const symbols = await symbolsAt(
      [
        "class UserCard {",
        "  render(user: User) {",
        "    const label = |",
        "  }",
        "}",
      ].join("\n"),
    );

    expect(symbols).toContainEqual(at(0, 6)); // UserCard
    expect(symbols).toContainEqual(at(1, 2)); // render
  });

  it("ignores imports that only appear inside comments", async () => {
    const symbols = await symbolsAt(
      ['// import { ghost } from "./ghost";', "const y = |"].join("\n"),
    );

    expect(symbols).not.toContainEqual(at(0, 11));
  });

  it("reads Python imports, including every name in a from-import", async () => {
    const source = [
      "from utils.format import format_date, format_money",
      "class UserCard:",
      "    def render(self, user):",
      "        label = format_da|",
    ].join("\n");
    const { code, offset } = cursor(source);
    const symbols = await findSymbolsAtCursor(code, offset, "python", AST);

    // Both names, not just the first: the query pins the `name` field.
    expect(symbols).toContainEqual(positionOf(code, "format_date"));
    expect(symbols).toContainEqual(positionOf(code, "format_money"));
  });

  it("reads plain Python imports", async () => {
    const source = ["import os", "import sys", "path = o|"].join("\n");
    const { code, offset } = cursor(source);
    const symbols = await findSymbolsAtCursor(code, offset, "python", AST);

    expect(symbols).toContainEqual(positionOf(code, "os"));
    expect(symbols).toContainEqual(positionOf(code, "sys"));
  });

  it("includes the enclosing Python class and method", async () => {
    const source = [
      "class UserCard:",
      "    def render(self, user):",
      "        label = |",
    ].join("\n");
    const { code, offset } = cursor(source);
    const symbols = await findSymbolsAtCursor(code, offset, "python", AST);

    expect(symbols).toContainEqual(positionOf(code, "UserCard"));
    expect(symbols).toContainEqual(positionOf(code, "render"));
  });

  it("reads Java imports", async () => {
    const source = [
      "import java.util.List;",
      "import com.example.FormatUtils;",
      "class UserCard {",
      "  void render(User user) {",
      "    String label = formatDa|",
      "  }",
      "}",
    ].join("\n");
    const { code, offset } = cursor(source);
    const symbols = await findSymbolsAtCursor(code, offset, "java", AST);

    expect(symbols).toContainEqual(positionOf(code, "List"));
    expect(symbols).toContainEqual(positionOf(code, "FormatUtils"));
  });

  it("includes the enclosing Java class and method", async () => {
    const source = [
      "class UserCard {",
      "  void render(User user) {",
      "    String label = |",
      "  }",
      "}",
    ].join("\n");
    const { code, offset } = cursor(source);
    const symbols = await findSymbolsAtCursor(code, offset, "java", AST);

    expect(symbols).toContainEqual(positionOf(code, "UserCard"));
    expect(symbols).toContainEqual(positionOf(code, "render"));
  });

  it("returns undefined for a language it cannot parse", async () => {
    const { code, offset } = cursor("const x = |");
    const symbols = await findSymbolsAtCursor(code, offset, "ruby", AST);

    expect(symbols).toBeUndefined();
  });

  it("parses tsx when the language is typescriptreact", async () => {
    const symbols = await symbolsAt(
      ['import { Button } from "./button";', "const view = |"].join("\n"),
      "typescriptreact",
    );

    expect(symbols).toContainEqual(at(0, 9));
  });
});
