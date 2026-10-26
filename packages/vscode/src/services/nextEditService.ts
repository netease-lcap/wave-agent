import * as vscode from "vscode";
import type {
  NextEditExcerpt,
  NextEditHistoryEntry,
  NextEditRegion,
  NextEditSuggestion,
} from "wave-agent-sdk/host";
import {
  NEXT_EDIT_HISTORY_OPTIONS,
  NextEditHistory,
} from "./nextEditHistory.js";

/**
 * Tuning knobs for next-edit suggestions. Defaults come from
 * `docs/specs/ui/next-edit-suggestion.md`; the window size follows Continue's
 * `core/nextEdit/` (the only complete open implementation), which predicts only
 * within a few lines of the caret.
 */
export interface NextEditOptions {
  /** Lines above and below the caret the model may rewrite. */
  windowLines: number;
  /** Extra lines shipped as read-only context around the window. */
  excerptLines: number;
  /** A response slower than this is worthless for a typing pause. */
  requestTimeoutMs: number;
  /** Debounce bounds, tracked against the last response's latency. */
  baseDebounceMs: number;
  minDebounceMs: number;
  maxDebounceMs: number;
  /**
   * How long after the newest edit a next-edit suggestion is attempted at all.
   * Without this the capability would keep competing with completion for the
   * inline-suggestion slot on a file the user edited minutes ago.
   */
  maxEditAgeMs: number;
}

export const NEXT_EDIT_OPTIONS: NextEditOptions = {
  windowLines: 5,
  excerptLines: 40,
  requestTimeoutMs: 3000,
  baseDebounceMs: 200,
  minDebounceMs: 100,
  maxDebounceMs: 1000,
  maxEditAgeMs: 30 * 1000,
};

export type NextEditFetcher = (params: {
  edits: NextEditHistoryEntry[];
  region: NextEditRegion;
  excerpt: NextEditExcerpt;
  language: string;
  filePath: string;
}) => Promise<{ suggestion: NextEditSuggestion | null } | undefined>;

/** What the provider hands to VS Code: a range to replace and its new text. */
export interface NextEditRender {
  /** The lines the accept replaces; empty when the suggestion only inserts. */
  range: vscode.Range;
  /** The replacement for that range. */
  text: string;
  /**
   * Document lines the accept removes. Ghost text cannot draw a removal, so the
   * provider paints these with a strikethrough — that is what makes "these lines
   * go away" visible (spec 故事 1 场景 4).
   */
  removed: vscode.Range[];
}

interface Window {
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  text: string;
}

/** The lines the model may rewrite: a few lines around the caret, clamped to the file. */
export function editableWindow(
  document: vscode.TextDocument,
  position: vscode.Position,
  options: NextEditOptions = NEXT_EDIT_OPTIONS,
): Window {
  const lineCount = document.lineCount;
  const caret = position.line + 1; // 1-based
  const startLine = Math.max(1, caret - options.windowLines);
  const endLine = Math.min(lineCount, caret + options.windowLines);
  const text = document.getText(
    new vscode.Range(
      new vscode.Position(startLine - 1, 0),
      new vscode.Position(
        endLine - 1,
        document.lineAt(endLine - 1).range.end.character,
      ),
    ),
  );
  return { startLine, endLine, text };
}

/** A wider read-only slice around the window, so the model knows where it sits. */
export function excerptAround(
  document: vscode.TextDocument,
  window: Window,
  options: NextEditOptions = NEXT_EDIT_OPTIONS,
): NextEditExcerpt {
  const startLine = Math.max(1, window.startLine - options.excerptLines);
  const endLine = Math.min(
    document.lineCount,
    window.endLine + options.excerptLines,
  );
  const text = document.getText(
    new vscode.Range(
      new vscode.Position(startLine - 1, 0),
      new vscode.Position(
        endLine - 1,
        document.lineAt(endLine - 1).range.end.character,
      ),
    ),
  );
  return { startLine, text };
}

/**
 * Runs next-edit requests for the editor: window selection, debounce, timeout,
 * staleness checks and "do not ask twice for the same state" live here, so the
 * provider stays a thin adapter over the VS Code API.
 *
 * Everything is best-effort — a missing session, a timeout, a model error and an
 * unparseable answer all end as "no suggestion" (spec: 静默跳过).
 */
export class NextEditService {
  private lastLatencyMs: number | undefined;
  /**
   * States already asked about and answered with "no change". Keyed by document
   * + window + its text, never by version: pressing a key that does not change
   * the window must not re-ask (spec story 5 scenario 1).
   */
  private readonly answered = new Set<string>();
  /**
   * The last render handed to the editor. Two uses: replaying it when the editor
   * asks again after the user jumped to it (moving the caret drops VS Code's
   * suggestion, and re-asking the model for the same state would be waste), and
   * telling the jump command where to go.
   */
  private pending:
    | { uri: string; version: number; render: NextEditRender }
    | undefined;

  constructor(
    private readonly fetch: NextEditFetcher,
    private readonly history: NextEditHistory = new NextEditHistory(
      NEXT_EDIT_HISTORY_OPTIONS,
    ),
    private readonly options: NextEditOptions = NEXT_EDIT_OPTIONS,
  ) {}

  /** Exposed so callers can wire the same tracker to document events. */
  get editHistory(): NextEditHistory {
    return this.history;
  }

  /**
   * Whether this invocation is worth a next-edit request at all: there must be a
   * recorded edit, and it must be recent. Everything else is completion's slot.
   */
  hasFreshTrajectory(document: vscode.TextDocument): boolean {
    const lastEditAt = this.history.lastEditAt(document);
    if (lastEditAt === undefined) return false;
    return Date.now() - lastEditAt <= this.options.maxEditAgeMs;
  }

  async getSuggestion(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    skipDebounce = false,
  ): Promise<NextEditRender | undefined> {
    // Already answered for this exact document state and the caret now sits
    // inside it (typically: the user just jumped here) — show it again without a
    // model call.
    const replayed = this.replay(document, position);
    if (replayed) return replayed;

    const edits = this.history.recent(document);
    // No trajectory, no prediction: without it the request would be a guess at
    // the file's content, which is what completion already does (spec 故事 3 场景 5).
    if (edits.length === 0) return undefined;

    const window = editableWindow(document, position, this.options);
    // The trajectory is half of the question, so a new edit invalidates an
    // earlier "no change" answer even when the window's text is unchanged (the
    // user edited somewhere else in the file).
    const key = [
      document.uri.toString(),
      this.history.lastEditAt(document) ?? 0,
      window.startLine,
      window.endLine,
      window.text,
    ].join("\u0000");
    if (this.answered.has(key)) return undefined;

    if (!skipDebounce && !(await this.waitForPause(token))) {
      return undefined;
    }
    if (token.isCancellationRequested) return undefined;

    const excerpt = excerptAround(document, window, this.options);
    const askedVersion = document.version;
    const started = Date.now();
    const result = await this.request(
      {
        edits,
        region: {
          startLine: window.startLine,
          endLine: window.endLine,
          text: window.text,
        },
        excerpt,
        language: document.languageId,
        filePath: document.uri.fsPath,
      },
      token,
    );
    // A response that lost the race is worthless: the line numbers it names were
    // computed against a version that no longer exists (spec 边界情况).
    if (token.isCancellationRequested || document.isClosed) return undefined;
    if (document.version !== askedVersion) return undefined;

    this.lastLatencyMs = Date.now() - started;
    if (!result?.suggestion) {
      this.pending = undefined;
      this.remember(key);
      return undefined;
    }

    const render = toRender(document, result.suggestion);
    if (!render) {
      this.pending = undefined;
      this.remember(key);
      return undefined;
    }
    this.pending = {
      uri: document.uri.toString(),
      version: document.version,
      render,
    };
    return render;
  }

  /**
   * The suggestion already computed for this document state, when the caret is
   * inside it. Anything else — a newer document, a different file, a caret
   * outside the range — is a miss, which is what keeps a stale range from being
   * applied to shifted text.
   */
  replay(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): NextEditRender | undefined {
    const pending = this.pending;
    if (!pending) return undefined;
    if (pending.uri !== document.uri.toString()) return undefined;
    if (pending.version !== document.version) return undefined;
    if (position.line < pending.render.range.start.line) return undefined;
    if (position.line > pending.render.range.end.line) return undefined;
    return pending.render;
  }

  /** Where the jump command should take the caret, for the document on screen. */
  pendingRange(document: vscode.TextDocument): vscode.Range | undefined {
    const pending = this.pending;
    if (!pending) return undefined;
    if (pending.uri !== document.uri.toString()) return undefined;
    if (pending.version !== document.version) return undefined;
    return pending.render.range;
  }

  /**
   * The suggestion computed for this document state, taken off the cache: the
   * accept command applies it once, and a taken suggestion cannot be replayed
   * onto text that has already been rewritten (spec 故事 2 场景 3).
   */
  takePending(document: vscode.TextDocument): NextEditRender | undefined {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return undefined;
    if (pending.uri !== document.uri.toString()) return undefined;
    if (pending.version !== document.version) return undefined;
    return pending.render;
  }

  private remember(key: string): void {
    this.answered.add(key);
    while (this.answered.size > 50) {
      const oldest = this.answered.values().next();
      if (oldest.done) break;
      this.answered.delete(oldest.value);
    }
  }

  /** Waits out the debounce window, tracking how slow the model has been. */
  private async waitForPause(
    token: vscode.CancellationToken,
  ): Promise<boolean> {
    const delay = Math.min(
      this.options.maxDebounceMs,
      Math.max(
        this.options.minDebounceMs,
        this.lastLatencyMs ?? this.options.baseDebounceMs,
      ),
    );
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        disposable.dispose();
        resolve(true);
      }, delay);
      const disposable = token.onCancellationRequested(() => {
        clearTimeout(timer);
        disposable.dispose();
        resolve(false);
      });
    });
  }

  private async request(
    params: Parameters<NextEditFetcher>[0],
    token: vscode.CancellationToken,
  ): Promise<{ suggestion: NextEditSuggestion | null } | undefined> {
    let timer: NodeJS.Timeout | undefined;
    let cancellation: vscode.Disposable | undefined;
    try {
      return await Promise.race<
        { suggestion: NextEditSuggestion | null } | undefined
      >([
        this.fetch(params).catch(() => undefined),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(
            () => resolve(undefined),
            this.options.requestTimeoutMs,
          );
        }),
        new Promise<undefined>((resolve) => {
          cancellation = token.onCancellationRequested(() =>
            resolve(undefined),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      cancellation?.dispose();
    }
  }
}

/**
 * Turns a suggestion into the smallest edit the editor can render and apply.
 *
 * The model answers with a whole editable region; what changed inside it can be
 * much smaller. Two reasons to narrow it down to whole lines here rather than
 * accepting the region verbatim:
 *
 * - the ghost text is only readable where it is short — a "here is your region
 *   again" answer would paint the whole window;
 * - a pure deletion has no text to draw at all. Ghost text can only *insert*, so
 *   a deletion is expressed as "replace the removed lines *and the line after
 *   them* with that surviving line": taking it removes exactly the intended
 *   lines, and the user sees the following line move up.
 *
 * `undefined` means "nothing to show": no difference, a range outside the file,
 * or a suggestion that would delete the entire buffer.
 */
export function toRender(
  document: vscode.TextDocument,
  suggestion: NextEditSuggestion,
): NextEditRender | undefined {
  const lastLine = document.lineCount;
  if (suggestion.startLine < 1 || suggestion.endLine > lastLine)
    return undefined;
  if (suggestion.startLine > suggestion.endLine) return undefined;

  const original = linesOf(document, suggestion.startLine, suggestion.endLine);
  // An empty answer means "delete these lines", not "insert a blank one".
  const next = suggestion.text.trim() === "" ? [] : splitLines(suggestion.text);

  // Longest common prefix and suffix in whole lines: everything else is what the
  // suggestion actually changes.
  let prefix = 0;
  while (
    prefix < original.length &&
    prefix < next.length &&
    original[prefix] === next[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < next.length - prefix &&
    original[original.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removedCount = original.length - prefix - suffix;
  const addedLines = next.slice(prefix, next.length - suffix);
  if (removedCount === 0 && addedLines.length === 0) return undefined;

  const firstRemovedLine = suggestion.startLine + prefix;
  const lastRemovedLine = firstRemovedLine + removedCount - 1;

  if (removedCount === 0) {
    // Pure insertion: hook it onto the end of the line before the change, so the
    // replacement range is a real position even at the top of the file.
    const anchor = firstRemovedLine - 1;
    if (anchor >= 1) {
      return {
        range: emptyRangeAt(document, anchor),
        text: `\n${addedLines.join("\n")}`,
        removed: [],
      };
    }
    return {
      range: emptyRangeAt(document, 0),
      text: `${addedLines.join("\n")}\n`,
      removed: [],
    };
  }

  const removed = [lineRange(document, firstRemovedLine, lastRemovedLine)];

  if (addedLines.length > 0) {
    return {
      range: lineRange(document, firstRemovedLine, lastRemovedLine),
      text: addedLines.join("\n"),
      removed,
    };
  }

  // Pure deletion: borrow one surviving line so there is something to insert.
  if (lastRemovedLine < lastLine) {
    const survivor = lastRemovedLine + 1;
    return {
      range: lineRange(document, firstRemovedLine, survivor),
      text: lineText(document, survivor),
      removed,
    };
  }
  if (firstRemovedLine > 1) {
    const survivor = firstRemovedLine - 1;
    return {
      range: lineRange(document, survivor, lastRemovedLine),
      text: lineText(document, survivor),
      removed,
    };
  }
  // Every line goes away: there is no position left to draw a suggestion at.
  return undefined;
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  // A trailing newline produces an empty string that is not a line of its own.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The text of `startLine..endLine` (1-based, inclusive) as lines. */
function linesOf(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
): string[] {
  const lines: string[] = [];
  for (let line = startLine; line <= endLine; line += 1) {
    lines.push(lineText(document, line));
  }
  return lines;
}

function lineText(document: vscode.TextDocument, line: number): string {
  const start = new vscode.Position(line - 1, 0);
  const end = new vscode.Position(
    line - 1,
    document.lineAt(line - 1).range.end.character,
  );
  return document.getText(new vscode.Range(start, end));
}

/** Whole lines `first..last` (1-based), excluding the trailing newline. */
export function lineRange(
  document: vscode.TextDocument,
  first: number,
  last: number,
): vscode.Range {
  return new vscode.Range(
    new vscode.Position(first - 1, 0),
    new vscode.Position(
      last - 1,
      document.lineAt(last - 1).range.end.character,
    ),
  );
}

/** An empty range at the end of `line` (1-based); `line` 0 means the file top. */
function emptyRangeAt(
  document: vscode.TextDocument,
  line: number,
): vscode.Range {
  if (line < 1)
    return new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(0, 0),
    );
  const position = new vscode.Position(
    line - 1,
    document.lineAt(line - 1).range.end.character,
  );
  return new vscode.Range(position, position);
}
