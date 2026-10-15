import * as vscode from "vscode";

/**
 * Tuning knobs for inline completion. Defaults come from
 * `docs/specs/ui/code-completion.md` (values borrowed from the OSS references:
 * Tabby's adaptive debounce and LRU cache, Continue's context windowing).
 */
export interface CompletionOptions {
  /** Context window around the cursor, in lines. */
  prefixLines: number;
  suffixLines: number;
  /** Hard cap on the prompt body, so a long file cannot blow up a request. */
  maxContextChars: number;
  /** Debounce bounds: the wait tracks the last response's latency. */
  baseDebounceMs: number;
  minDebounceMs: number;
  maxDebounceMs: number;
  /** A response slower than this is worthless for typing; give up on it. */
  requestTimeoutMs: number;
  /** Rendering cap (spec: 10 lines / 1000 chars). */
  maxSuggestionLines: number;
  maxSuggestionChars: number;
  /** Documents larger than this are skipped entirely (spec: 1MB 或 20000 行). */
  maxFileLines: number;
  maxFileChars: number;
  /** Recently computed suggestions, keyed by document identity + cursor context. */
  cacheSize: number;
  cacheTtlMs: number;
}

export const COMPLETION_OPTIONS: CompletionOptions = {
  prefixLines: 150,
  suffixLines: 30,
  maxContextChars: 12000,
  baseDebounceMs: 200,
  minDebounceMs: 100,
  maxDebounceMs: 1000,
  requestTimeoutMs: 3000,
  maxSuggestionLines: 10,
  maxSuggestionChars: 1000,
  maxFileLines: 20000,
  maxFileChars: 1024 * 1024,
  cacheSize: 100,
  cacheTtlMs: 5 * 60 * 1000,
};

export interface CompletionContext {
  prefix: string;
  suffix: string;
}

export type CompletionFetcher = (params: {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
}) => Promise<string | undefined>;

interface CacheEntry {
  suggestion: string | undefined;
  at: number;
}

/**
 * Cuts the document down to the lines around the cursor and enforces the total
 * character budget, dropping the farthest lines first — the nearest code is
 * what the model needs to continue the current line.
 */
export function buildCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  options: CompletionOptions = COMPLETION_OPTIONS,
): CompletionContext {
  const startLine = Math.max(0, position.line - options.prefixLines);
  const endLine = Math.min(
    document.lineCount - 1,
    position.line + options.suffixLines,
  );

  const start = new vscode.Position(startLine, 0);
  const end = new vscode.Position(
    endLine,
    document.lineAt(endLine).range.end.character,
  );
  const body = document.getText(new vscode.Range(start, end));
  const cursorOffset = document.offsetAt(position) - document.offsetAt(start);

  let prefix = body.slice(0, cursorOffset);
  let suffix = body.slice(cursorOffset);

  // Trim the farthest lines until the whole prompt fits the budget.
  while (prefix.length + suffix.length > options.maxContextChars) {
    if (prefix.length >= suffix.length && prefix.includes("\n")) {
      prefix = prefix.slice(prefix.indexOf("\n") + 1);
    } else if (suffix.includes("\n")) {
      suffix = suffix.slice(0, suffix.lastIndexOf("\n"));
    } else {
      break;
    }
  }

  return { prefix, suffix };
}

/**
 * Trims a suggestion to what we are willing to render. A completion longer than
 * this is usually the model restating the file rather than continuing the line.
 */
export function truncateSuggestion(
  text: string,
  options: CompletionOptions = COMPLETION_OPTIONS,
): string {
  const lines = text.split("\n").slice(0, options.maxSuggestionLines);
  return lines.join("\n").slice(0, options.maxSuggestionChars).trimEnd();
}

/** Context identity for the cache: document version + the code at the cursor. */
function cacheKey(
  document: vscode.TextDocument,
  context: CompletionContext,
): string {
  return [
    document.uri.toString(),
    document.version,
    context.prefix.slice(-200),
    context.suffix.slice(0, 200),
  ].join("\u0000");
}

/**
 * Runs inline completion requests for the editor: debounce, in-flight
 * superseding, cache and timeout live here so the provider stays a thin adapter
 * over the VS Code API.
 *
 * Everything is best-effort — a missing CLI, a timeout or a model error all end
 * as "no suggestion" rather than as a visible failure (spec: 补全请求失败时静默
 * 跳过本次补全).
 */
export class InlineCompletionService {
  private cache = new Map<string, CacheEntry>();
  private lastLatencyMs: number | undefined;

  constructor(
    private readonly fetch: CompletionFetcher,
    private readonly options: CompletionOptions = COMPLETION_OPTIONS,
  ) {}

  async getCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    skipDebounce = false,
  ): Promise<string | undefined> {
    const context = buildCompletionContext(document, position, this.options);
    const key = cacheKey(document, context);

    const cached = this.readCache(key);
    if (cached.hit) {
      return cached.suggestion;
    }

    // A manual trigger asks for a suggestion right now; only the automatic
    // path waits out the typing pause.
    if (!skipDebounce && !(await this.waitForPause(token))) {
      return undefined;
    }

    const started = Date.now();
    const text = await this.request(
      {
        ...context,
        language: document.languageId,
        filePath: document.uri.fsPath,
      },
      token,
    );
    // A response that lost the race is worthless even when it did arrive: the
    // caret has moved on (spec: 迟到的响应不得渲染).
    if (text === undefined || token.isCancellationRequested) {
      return undefined;
    }
    this.lastLatencyMs = Date.now() - started;

    const suggestion = truncateSuggestion(text, this.options);
    this.writeCache(key, suggestion);
    return suggestion;
  }

  /**
   * Waits out the debounce window, tracking how slow the model has been: a slow
   * model means more typing between requests, so a request that would be stale
   * on arrival is never sent. Returns false when the editor moved on (the
   * platform cancels the token on the next keystroke).
   */
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

  /**
   * Awaits one fetch, bounded by the timeout and by the caller's cancellation —
   * `StdioClient.request` has no timeout of its own, and a stalled completion
   * must never hold the editor's inline suggestion channel open.
   */
  private async request(
    params: {
      prefix: string;
      suffix: string;
      language: string;
      filePath: string;
    },
    token: vscode.CancellationToken,
  ): Promise<string | undefined> {
    let timer: NodeJS.Timeout | undefined;
    let cancellation: vscode.Disposable | undefined;
    try {
      return await Promise.race<string | undefined>([
        this.fetch(params),
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

  private readCache(key: string): { hit: boolean; suggestion?: string } {
    const entry = this.cache.get(key);
    if (!entry) {
      return { hit: false };
    }
    if (Date.now() - entry.at > this.options.cacheTtlMs) {
      this.cache.delete(key);
      return { hit: false };
    }
    // Refresh recency (Map preserves insertion order).
    this.cache.delete(key);
    this.cache.set(key, entry);
    return { hit: true, suggestion: entry.suggestion };
  }

  private writeCache(key: string, suggestion: string): void {
    this.cache.delete(key);
    this.cache.set(key, { suggestion, at: Date.now() });
    while (this.cache.size > this.options.cacheSize) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}
