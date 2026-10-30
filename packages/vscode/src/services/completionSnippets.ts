import * as vscode from "vscode";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CompletionSnippet } from "wave-agent-sdk/host";
import { hostLog } from "../hostLog";
import {
  findSymbolsAtCursor,
  type AstOptions,
  type SymbolPoint,
} from "./completionAst.js";

/**
 * Cross-file definition bodies for inline completion.
 *
 * `completionAst` decides *which* symbols are worth asking about (the only
 * thing a file-local parser can contribute); every one of them is then resolved
 * through the host's own definition provider, which is where the answer
 * actually lives. This module is the VS Code half: asks the language service,
 * reads the bodies, and bounds the whole thing.
 *
 * Everything here is best-effort: a 100ms hard timeout, at most a few snippets,
 * and any failure degrades to "no snippets" rather than to a failed completion
 * (`docs/specs/ide/code-completion.md`).
 */

export interface SnippetOptions {
  /** Hard cap on collection; the definition command itself cannot be cancelled. */
  timeoutMs: number;
  /** Hard cap on surviving snippets — more context stops helping past this. */
  maxSnippets: number;
  /** Per-snippet character cap. */
  maxSnippetChars: number;
  /** How many lines of a definition body we are willing to read. */
  maxDefinitionLines: number;
  /** Where the parser reads its wasm from. */
  ast: AstOptions;
}

/**
 * The wasm is copied next to `extension.cjs` by `esbuild.config.mjs`, so this
 * resolves to `dist/` in the packaged extension.
 */
const BUNDLE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const SNIPPET_OPTIONS: SnippetOptions = {
  timeoutMs: 100,
  maxSnippets: 3,
  maxSnippetChars: 2000,
  maxDefinitionLines: 15,
  ast: {
    runtimeWasm: path.join(BUNDLE_DIR, "tree-sitter.wasm"),
    grammarDir: BUNDLE_DIR,
  },
};

/**
 * Collects definition bodies for the symbols around the cursor.
 *
 * `undefined` means this host cannot collect for the language at all (no
 * grammar); `[]` means it tried and came up empty. The CLI treats both as "no
 * snippets", but the wire keeps the distinction.
 */
export async function collectDefinitionSnippets(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
  options: SnippetOptions = SNIPPET_OPTIONS,
): Promise<CompletionSnippet[] | undefined> {
  const work = collect(document, position, options);
  const collected = await raceCollection(work, token, options.timeoutMs);
  return collected === "unsupported" ? undefined : collected;
}

/**
 * Bounds the work by wall clock and by the editor moving on.
 *
 * `vscode.executeDefinitionProvider` accepts no cancellation token (VS Code
 * hard-codes `CancellationToken.None` inside it), so the only way to stop
 * waiting is to resolve the race and let the abandoned promise finish.
 */
function raceCollection(
  work: Promise<CompletionSnippet[] | "unsupported">,
  token: vscode.CancellationToken,
  timeoutMs: number,
): Promise<CompletionSnippet[] | "unsupported"> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancellation: vscode.Disposable | undefined;

    const done = (result: CompletionSnippet[] | "unsupported") => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cancellation?.dispose();
      resolve(result);
    };

    timer = setTimeout(() => done([]), timeoutMs);
    cancellation = token.onCancellationRequested(() => done([]));
    work.then(done, (error) => {
      hostLog.debug("[Wave] Definition snippet collection failed:", error);
      done([]);
    });
  });
}

async function collect(
  document: vscode.TextDocument,
  position: vscode.Position,
  options: SnippetOptions,
): Promise<CompletionSnippet[] | "unsupported"> {
  const text = document.getText();
  const symbols = await findSymbolsAtCursor(
    text,
    document.offsetAt(position),
    document.languageId,
    options.ast,
  );
  if (!symbols) return "unsupported";

  const snippets: CompletionSnippet[] = [];
  const seen = new Set<string>();
  for (const symbol of symbols) {
    if (snippets.length >= options.maxSnippets) break;
    const snippet = await resolveSymbol(document, symbol, options);
    if (!snippet) continue;
    const key = `${snippet.path}\u0000${snippet.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(snippet);
  }

  // Symbols are ranked most-relevant first; the prompt wants the most relevant
  // one *last*, nearest the cursor.
  return snippets.reverse();
}

async function resolveSymbol(
  document: vscode.TextDocument,
  symbol: SymbolPoint,
  options: SnippetOptions,
): Promise<CompletionSnippet | undefined> {
  const origin = new vscode.Position(symbol.row, symbol.column);
  const locations = await definitionLocations(document.uri, origin);
  for (const location of locations) {
    // Non-`file` schemes throw inside the definition command, and their
    // contents are not ours to read anyway.
    if (location.uri.scheme !== "file") continue;
    // The current file is already in the prefix; repeating it wastes budget.
    if (location.uri.toString() === document.uri.toString()) continue;
    try {
      // Returns the editor's in-memory document when the file is open, so
      // unsaved edits are honoured — a stale body is worse than no body.
      const target = await vscode.workspace.openTextDocument(location.uri);
      const body = definitionBody(target, location.range, options);
      if (!body) continue;
      return { path: target.uri.fsPath, text: body };
    } catch (error) {
      hostLog.debug("[Wave] Could not read definition body:", error);
    }
  }
  return undefined;
}

/**
 * Asks the language service for a symbol's definition.
 *
 * Returns `[]` for "nothing found" — including the case where the target
 * language's extension is not activated, which reports empty rather than
 * throwing.
 */
async function definitionLocations(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<vscode.Location[]> {
  try {
    const result = await vscode.commands.executeCommand<
      Array<vscode.Location | vscode.LocationLink>
    >("vscode.executeDefinitionProvider", uri, position);
    if (!Array.isArray(result)) return [];
    const locations: vscode.Location[] = [];
    for (const entry of result) {
      // The provider returns a union of Location and LocationLink.
      if ("targetUri" in entry && entry.targetUri) {
        locations.push(
          new vscode.Location(
            entry.targetUri,
            entry.targetSelectionRange ?? entry.targetRange,
          ),
        );
      } else if ("uri" in entry && entry.uri && "range" in entry) {
        locations.push(entry);
      }
    }
    return locations;
  } catch (error) {
    hostLog.debug("[Wave] Definition lookup failed:", error);
    return [];
  }
}

/**
 * Reads a definition body, bounded two ways: it stops at the first line that
 * dedents back to the declaration's own level, and it never exceeds
 * `maxDefinitionLines`. When the line budget runs out mid-body only the
 * signature survives — half a function body is worse context than its
 * signature.
 */
export function definitionBody(
  document: vscode.TextDocument,
  range: vscode.Range,
  options: SnippetOptions = SNIPPET_OPTIONS,
): string | undefined {
  if (range.start.line >= document.lineCount) return undefined;

  const startLine = range.start.line;
  const indent = leadingWhitespace(document.lineAt(startLine).text);
  const lastAllowed = Math.min(
    document.lineCount - 1,
    startLine + options.maxDefinitionLines - 1,
  );

  let endLine = startLine;
  for (let line = startLine + 1; line <= lastAllowed; line++) {
    const content = document.lineAt(line).text;
    if (content.trim().length === 0) {
      endLine = line;
      continue;
    }
    if (leadingWhitespace(content).length <= indent.length) {
      // A closing bracket sits at the declaration's own level but still
      // belongs to it — dropping it would hand the model an unclosed block.
      if (/^[}\])]/.test(content.trimStart())) endLine = line;
      break;
    }
    endLine = line;
  }

  const lines: string[] = [];
  for (let line = startLine; line <= endLine; line++) {
    lines.push(document.lineAt(line).text);
  }
  let body = lines.join("\n").trimEnd();

  // Still inside the body when the line budget ran out: ship the signature
  // instead of a block cut off mid-way.
  if (endLine === lastAllowed && lastAllowed < document.lineCount - 1) {
    const brace = body.indexOf("{");
    const head = brace > 0 ? body.slice(0, brace).trimEnd() : "";
    body = head.length > 0 ? `${head} {` : (body.split("\n")[0] ?? "");
  }

  if (body.trim().length === 0) return undefined;
  return body.length > options.maxSnippetChars
    ? body.slice(0, options.maxSnippetChars)
    : body;
}

function leadingWhitespace(text: string): string {
  return text.slice(0, text.length - text.trimStart().length);
}
