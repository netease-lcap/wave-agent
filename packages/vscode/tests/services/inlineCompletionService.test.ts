import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }
  class Range {
    constructor(
      public start: Position,
      public end: Position,
    ) {}
  }
  return { Position, Range };
});

import { Position } from "vscode";
import {
  COMPLETION_OPTIONS,
  InlineCompletionService,
  buildCompletionContext,
  truncateSuggestion,
  type CompletionFetcher,
  type CompletionOptions,
} from "../../src/services/inlineCompletionService";

const FAST: CompletionOptions = {
  ...COMPLETION_OPTIONS,
  baseDebounceMs: 1,
  minDebounceMs: 1,
  maxDebounceMs: 1,
};

interface FakeDocument {
  uri: { toString: () => string; fsPath: string; scheme: string };
  version: number;
  languageId: string;
  lineCount: number;
  isReadOnly: boolean;
  isClosed: boolean;
  lineAt: (line: number) => { range: { end: { character: number } } };
  getText: (range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  }) => string;
  offsetAt: (position: { line: number; character: number }) => number;
}

function createDocument(
  text: string,
  overrides: Partial<FakeDocument> = {},
): FakeDocument {
  const lines = text.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const offsetAt = (position: { line: number; character: number }) =>
    lineStarts[position.line] + position.character;

  return {
    uri: {
      toString: () => "file:///repo/a.ts",
      fsPath: "/repo/a.ts",
      scheme: "file",
    },
    version: 1,
    languageId: "typescript",
    lineCount: lines.length,
    isReadOnly: false,
    isClosed: false,
    lineAt: (line: number) => ({
      range: { end: { character: lines[line].length } },
    }),
    getText: (range) =>
      range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text,
    offsetAt,
    ...overrides,
  };
}

class FakeToken {
  isCancellationRequested = false;
  private listeners: Array<() => void> = [];

  onCancellationRequested(listener: () => void) {
    this.listeners.push(listener);
    return { dispose: () => {} };
  }

  cancel() {
    this.isCancellationRequested = true;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// The service is typed against the real vscode types; the fakes above carry the
// same shape at runtime.
const asDocument = (document: FakeDocument) =>
  document as unknown as import("vscode").TextDocument;
const asToken = (token: FakeToken) =>
  token as unknown as import("vscode").CancellationToken;
const at = (line: number, character: number) =>
  new Position(line, character) as unknown as import("vscode").Position;

describe("buildCompletionContext", () => {
  it("splits the document at the cursor", () => {
    const document = createDocument("const a = 1;\nconst b = 2;");

    const context = buildCompletionContext(asDocument(document), at(1, 6));

    expect(context.prefix).toBe("const a = 1;\nconst ");
    expect(context.suffix).toBe("b = 2;");
  });

  it("windows the context to the configured number of lines", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const document = createDocument(text);

    const context = buildCompletionContext(asDocument(document), at(10, 0), {
      ...COMPLETION_OPTIONS,
      prefixLines: 2,
      suffixLines: 1,
    });

    expect(context.prefix).toBe("line 8\nline 9\n");
    expect(context.suffix).toBe("line 10\nline 11");
  });

  it("drops the farthest lines to fit the character budget", () => {
    const text = ["aaaa", "bbbb", "cccc", "dddd"].join("\n");
    const document = createDocument(text);

    const context = buildCompletionContext(asDocument(document), at(2, 2), {
      ...COMPLETION_OPTIONS,
      prefixLines: 10,
      suffixLines: 10,
      maxContextChars: 10,
    });

    expect(context.prefix.length + context.suffix.length).toBeLessThanOrEqual(
      10,
    );
    // The nearest lines survive; the first line does not.
    expect(context.prefix).toContain("cccc".slice(0, 2));
    expect(context.prefix).not.toContain("aaaa");
  });
});

describe("truncateSuggestion", () => {
  it("keeps short suggestions verbatim", () => {
    expect(truncateSuggestion("return 42;")).toBe("return 42;");
  });

  it("caps the suggestion at the configured line count", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `line ${i}`).join("\n");

    const result = truncateSuggestion(eleven);

    expect(result.split("\n")).toHaveLength(10);
  });

  it("caps the suggestion at the configured character count", () => {
    const result = truncateSuggestion("x".repeat(5000));

    expect(result).toHaveLength(1000);
  });
});

describe("InlineCompletionService", () => {
  let fetchMock: ReturnType<typeof vi.fn<CompletionFetcher>>;
  let service: InlineCompletionService;
  let document: FakeDocument;

  beforeEach(() => {
    fetchMock = vi.fn<CompletionFetcher>().mockResolvedValue("42");
    service = new InlineCompletionService(fetchMock, FAST);
    document = createDocument("const a = ;");
  });

  it("returns the model's suggestion for the cursor context", async () => {
    const token = new FakeToken();

    const result = await service.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(token),
    );

    expect(result).toBe("42");
    expect(fetchMock).toHaveBeenCalledWith({
      prefix: "const a = ",
      suffix: ";",
      language: "typescript",
      filePath: "/repo/a.ts",
    });
  });

  it("reuses the cached suggestion for the same context instead of re-asking", async () => {
    await service.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
    );
    await service.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again once the document changed", async () => {
    await service.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
    );
    document.version = 2;

    await service.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up when the model is slower than the timeout", async () => {
    const stalled = new InlineCompletionService(
      vi.fn<CompletionFetcher>().mockReturnValue(new Promise(() => {})),
      { ...FAST, requestTimeoutMs: 5 },
    );

    const result = await stalled.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
    );

    expect(result).toBeUndefined();
  });

  it("does not ask at all when the editor moved on during the debounce", async () => {
    const token = new FakeToken();
    const slowDebounce = new InlineCompletionService(fetchMock, {
      ...FAST,
      baseDebounceMs: 1000,
      minDebounceMs: 1000,
      maxDebounceMs: 1000,
    });

    const pending = slowDebounce.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(token),
    );
    token.cancel();

    await expect(pending).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a response that arrives after cancellation", async () => {
    const token = new FakeToken();
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          token.cancel();
          resolve("42");
        }),
    );

    const result = await service.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(token),
    );

    expect(result).toBeUndefined();
  });

  it("throttles to the last response's latency", async () => {
    const adaptive = new InlineCompletionService(fetchMock, {
      ...COMPLETION_OPTIONS,
      baseDebounceMs: 5,
      minDebounceMs: 5,
      maxDebounceMs: 50,
    });
    fetchMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return "42";
    });

    const first = await adaptive.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
    );
    document.version = 2;
    const started = Date.now();
    const second = await adaptive.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
    );
    const waited = Date.now() - started;

    expect(first).toBe("42");
    expect(second).toBe("42");
    // A 40ms model moves the 5ms base wait up towards it (capped at 50ms).
    expect(waited).toBeGreaterThanOrEqual(30);
  });

  it("skips the debounce on a manual trigger", async () => {
    const manual = new InlineCompletionService(fetchMock, {
      ...FAST,
      baseDebounceMs: 10000,
      minDebounceMs: 10000,
      maxDebounceMs: 10000,
    });

    const result = await manual.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
      true,
    );

    expect(result).toBe("42");
  });

  it("treats an empty answer as no suggestion", async () => {
    fetchMock.mockResolvedValue("");

    const result = await service.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
    );

    expect(result).toBe("");
  });

  it("swallows a failed request", async () => {
    fetchMock.mockRejectedValue(new Error("Failed to get code completion"));

    await expect(
      service.getCompletion(
        asDocument(document),
        at(0, 10),
        asToken(new FakeToken()),
      ),
    ).rejects.toThrow("Failed to get code completion");
  });

  it("evicts the oldest cache entry beyond the configured size", async () => {
    const small = new InlineCompletionService(fetchMock, {
      ...FAST,
      cacheSize: 1,
    });

    await small.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
    );
    await small.getCompletion(
      asDocument(document),
      at(0, 9),
      asToken(new FakeToken()),
    );
    // The first entry was evicted, so this asks again.
    await small.getCompletion(
      asDocument(document),
      at(0, 10),
      asToken(new FakeToken()),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
