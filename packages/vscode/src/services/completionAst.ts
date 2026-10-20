import path from "node:path";
import { readFile } from "node:fs/promises";
// A static import on purpose: `web-tree-sitter` is CommonJS (`export =`), and
// a dynamic `import()` through esbuild's interop hands back a wrapper whose
// `.default` is not the constructor. Importing it directly is the one shape
// that survives bundling.
import Parser from "web-tree-sitter";

/**
 * The tree-sitter half of cross-file completion: given a file's text and a
 * cursor offset, list the symbols worth asking a language service about.
 *
 * Deliberately free of any `vscode` import — this module answers "which
 * symbols", and `completionSnippets.ts` turns that into "where are they". The
 * split is what makes the parsing testable without an editor.
 *
 * Why a parser at all: a language service can tell you where the symbol under
 * the cursor is defined, but it has no "give me this file's imports" call, and
 * a regex over the text is fooled by imports inside comments, look-alike
 * strings, multi-line imports, `import type` and `as` renames.
 */

/**
 * Extracts the symbols an import statement binds. Written per language because
 * the grammars disagree on the shape: TS nests `import_specifier` under
 * `import_clause`, Python has no clause node at all, and Java's import is a
 * bare dotted path. A query keeps that difference in data rather than in a
 * growing `if (language === …)` chain.
 *
 * The `name` field is what makes the Python one correct: `from a import b, c`
 * has several `name` children, so pinning the field catches all of them —
 * matching on child position (as the reference implementation does) silently
 * drops every name after the first.
 */
const IMPORT_QUERIES: Record<string, string> = {
  typescript: `
    (import_statement
      (import_clause
        (named_imports
          (import_specifier name: (identifier) @import))))
    (import_statement
      (import_clause
        (identifier) @import))
    (import_statement
      (import_clause
        (namespace_import (identifier) @import)))
  `,
  javascript: `
    (import_statement
      (import_clause
        (named_imports
          (import_specifier name: (identifier) @import))))
    (import_statement
      (import_clause
        (identifier) @import))
    (import_statement
      (import_clause
        (namespace_import (identifier) @import)))
  `,
  python: `
    (import_from_statement
      name: (dotted_name (identifier) @import))
    (import_statement
      name: (dotted_name (identifier) @import))
  `,
  java: `
    (import_declaration
      (scoped_identifier (identifier) @import))
  `,
};

/** Languages we can parse locally. Anything else gets no snippets at all. */
const LANGUAGES: Record<string, { grammar: string; importQuery: string }> = {
  typescript: {
    grammar: "tree-sitter-typescript.wasm",
    importQuery: IMPORT_QUERIES.typescript,
  },
  typescriptreact: {
    grammar: "tree-sitter-tsx.wasm",
    // TSX is a superset of TS; the same query applies.
    importQuery: IMPORT_QUERIES.typescript,
  },
  javascript: {
    grammar: "tree-sitter-javascript.wasm",
    importQuery: IMPORT_QUERIES.javascript,
  },
  javascriptreact: {
    grammar: "tree-sitter-javascript.wasm",
    importQuery: IMPORT_QUERIES.javascript,
  },
  python: {
    grammar: "tree-sitter-python.wasm",
    importQuery: IMPORT_QUERIES.python,
  },
  java: {
    grammar: "tree-sitter-java.wasm",
    importQuery: IMPORT_QUERIES.java,
  },
};

/**
 * Node types whose name is worth a definition lookup: the scopes the cursor is
 * nested in. `program` is excluded — the file itself is already in the prefix.
 */
const SCOPE_NODE_TYPES = new Set([
  // JavaScript / TypeScript
  "arrow_function",
  "generator_function_declaration",
  "function_declaration",
  "method_definition",
  "class_declaration",
  // Python
  "function_definition",
  "class_definition",
  // Java
  "method_declaration",
  "constructor_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
]);

/**
 * How many symbols we are willing to ask the language service about. Every one
 * of them is a round-trip inside the same 100ms budget, and a file can import
 * dozens of names — the ranking above is what decides which ones get to spend
 * that budget.
 */
const MAX_CANDIDATES = 8;

export interface AstOptions {
  /** Path to `tree-sitter.wasm` — the runtime itself. */
  runtimeWasm: string;
  /** Directory holding the grammar wasm files. */
  grammarDir: string;
}

/** A symbol to resolve, ranked most relevant first. */
export interface SymbolPoint {
  row: number;
  column: number;
}

interface LoadedGrammar {
  language: Parser.Language;
  importQuery: Parser.Query;
}

let runtime: Promise<void> | undefined;
const grammars = new Map<string, Promise<LoadedGrammar>>();

async function loadGrammar(
  grammarFile: string,
  importQuery: string,
  options: AstOptions,
): Promise<LoadedGrammar> {
  const key = `${options.grammarDir}\u0000${grammarFile}`;
  let pending = grammars.get(key);
  if (!pending) {
    pending = (async () => {
      runtime ??= Parser.init({
        locateFile: () => options.runtimeWasm,
      });
      await runtime;
      // Read the bytes ourselves: the packaged extension runs from `dist/`,
      // and this removes any dependence on how the loader resolves files.
      const binary = await readFile(path.join(options.grammarDir, grammarFile));
      const language = await Parser.Language.load(binary);
      return { language, importQuery: language.query(importQuery) };
    })();
    grammars.set(key, pending);
    // A failed load must not be cached — the next keystroke gets a fresh try.
    pending.catch(() => grammars.delete(key));
  }
  return pending;
}

/**
 * The symbols around `offset`, most relevant first: the identifier being
 * typed, then the scopes enclosing it from inner to outer, then the symbols
 * this file imports.
 *
 * Returns `undefined` when this language has no grammar here — the caller must
 * tell "cannot do this language" apart from "tried, found nothing".
 */
export async function findSymbolsAtCursor(
  text: string,
  offset: number,
  languageId: string,
  options: AstOptions,
): Promise<SymbolPoint[] | undefined> {
  const support = LANGUAGES[languageId];
  if (!support) return undefined;

  const { language, importQuery } = await loadGrammar(
    support.grammar,
    support.importQuery,
    options,
  );
  const parser = new Parser();
  let tree: Parser.Tree | undefined;
  try {
    parser.setLanguage(language);
    tree = parser.parse(text);
    if (!tree) return [];
    return rankSymbols(tree.rootNode, text, offset, importQuery);
  } finally {
    parser.delete();
  }
}

function rankSymbols(
  root: Parser.SyntaxNode,
  text: string,
  offset: number,
  importQuery: Parser.Query,
): SymbolPoint[] {
  const symbols: SymbolPoint[] = [];
  const seen = new Set<string>();
  const push = (node: Parser.SyntaxNode) => {
    if (symbols.length >= MAX_CANDIDATES) return;
    const key = `${node.startPosition.row}:${node.startPosition.column}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push({
      row: node.startPosition.row,
      column: node.startPosition.column,
    });
  };

  // 1) What the user is typing right now — the strongest signal.
  const word = identifierBefore(text, offset);
  if (word) {
    const point = pointBefore(text, offset, word.length);
    const key = `${point.row}:${point.column}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push(point);
    }
  }

  // 2) Enclosing scopes, innermost first.
  for (const node of scopePathAt(root, probeOffset(text, offset))) {
    if (!SCOPE_NODE_TYPES.has(node.type)) continue;
    const name = nameNodeOf(node);
    if (name) push(name);
  }

  // 3) Symbols imported by this file.
  for (const name of importedSymbolNodes(root, importQuery)) push(name);

  return symbols;
}

/** The name node of a declaration, following arrow functions to their binding. */
function nameNodeOf(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  const named = node.childForFieldName("name");
  if (named) return named;
  if (node.parent?.type === "variable_declarator") {
    return node.parent.childForFieldName("name") ?? undefined;
  }
  return undefined;
}

/**
 * The symbols this file imports, as the language's own query defines them.
 *
 * The query pins the *original* name in a rename (`import { a as b }`), because
 * `a` is what exists in the other file; resolving `b` would find nothing.
 */
function importedSymbolNodes(
  root: Parser.SyntaxNode,
  importQuery: Parser.Query,
): Parser.SyntaxNode[] {
  const found: Parser.SyntaxNode[] = [];
  for (const match of importQuery.matches(root)) {
    for (const capture of match.captures) {
      found.push(capture.node);
    }
  }
  return found;
}

/**
 * The offset to probe the tree with. A cursor sitting in trailing whitespace
 * (`label = |`, or the end of the file) is past the last node that ends there —
 * nodes stop at the last non-whitespace character — so without backing up the
 * walk would see the whole file as the innermost node and every enclosing
 * scope would be lost. Stops at the line break: indentation at the start of a
 * fresh line belongs to that line, not the previous one.
 */
function probeOffset(text: string, offset: number): number {
  let probe = Math.min(offset, text.length);
  while (probe > 0 && text[probe - 1] !== "\n" && /\s/.test(text[probe - 1])) {
    probe--;
  }
  return probe;
}

/**
 * Walks from the root to the innermost node containing `offset`, returned
 * innermost-first. This is the "scope chain" the lookups are derived from.
 */
function scopePathAt(
  root: Parser.SyntaxNode,
  offset: number,
): Parser.SyntaxNode[] {
  const chain: Parser.SyntaxNode[] = [];
  let node: Parser.SyntaxNode | null = root;
  while (node) {
    chain.push(node);
    let next: Parser.SyntaxNode | null = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child && child.startIndex <= offset && offset <= child.endIndex) {
        next = child;
        break;
      }
    }
    node = next;
  }
  return chain.reverse();
}

/** The identifier immediately before the cursor, if there is one. */
function identifierBefore(text: string, offset: number): string | undefined {
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) start--;
  const word = text.slice(start, offset);
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(word) ? word : undefined;
}

/** The document position `length` characters before `offset`. */
function pointBefore(
  text: string,
  offset: number,
  length: number,
): SymbolPoint {
  const target = offset - length;
  let row = 0;
  let lineStart = 0;
  for (let i = 0; i < target; i++) {
    if (text[i] === "\n") {
      row++;
      lineStart = i + 1;
    }
  }
  return { row, column: target - lineStart };
}
