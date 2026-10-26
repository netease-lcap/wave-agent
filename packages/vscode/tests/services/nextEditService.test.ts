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
  NEXT_EDIT_OPTIONS,
  NextEditService,
  editableWindow,
  excerptAround,
  toRender,
  type NextEditFetcher,
  type NextEditOptions,
} from "../../src/services/nextEditService";
import { NextEditHistory } from "../../src/services/nextEditHistory";

const FAST: NextEditOptions = {
  ...NEXT_EDIT_OPTIONS,
  baseDebounceMs: 1,
  minDebounceMs: 1,
  maxDebounceMs: 1,
  requestTimeoutMs: 20,
};

interface FakeDocument {
  uri: { toString: () => string; fsPath: string; scheme: string };
  version: number;
  languageId: string;
  lineCount: number;
  isClosed: boolean;
  lineAt: (line: number) => { range: { end: { character: number } } };
  getText: (range?: unknown) => string;
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
    isClosed: false,
    lineAt: (line: number) => ({
      range: { end: { character: lines[line].length } },
    }),
    getText: (range?: unknown) => {
      if (!range) return text;
      const { start, end } = range as {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      return text.slice(offsetAt(start), offsetAt(end));
    },
    ...overrides,
  };
}

class FakeToken {
  isCancellationRequested = false;
  onCancellationRequested() {
    return { dispose: () => {} };
  }
  cancel() {
    this.isCancellationRequested = true;
  }
}

const asDocument = (document: FakeDocument) =>
  document as unknown as import("vscode").TextDocument;
const asToken = (token: FakeToken) =>
  token as unknown as import("vscode").CancellationToken;
const at = (line: number, character: number) =>
  new Position(line, character) as unknown as import("vscode").Position;

const FILE = [
  "const a = 1;",
  "function f(id) {",
  "  return id;",
  "}",
  "export { f };",
].join("\n");

/** History with one recorded edit, i.e. "the user just typed something here". */
function primedHistory(document: FakeDocument): NextEditHistory {
  const history = new NextEditHistory();
  history.prime(asDocument(document));
  history.record(asDocument(document), {
    document,
    contentChanges: [
      { rangeOffset: FILE.indexOf("id"), rangeLength: 2, text: "userId" },
    ],
  } as unknown as import("vscode").TextDocumentChangeEvent);
  return history;
}

describe("editableWindow / excerptAround", () => {
  it("centres the window on the caret and clamps to the file", () => {
    const document = createDocument(FILE);

    const window = editableWindow(asDocument(document), at(2, 2), FAST);

    expect(window).toEqual({
      startLine: 1,
      endLine: 5,
      text: FILE,
    });
  });

  it("gives the model a wider read-only excerpt around the window", () => {
    const longFile = Array.from(
      { length: 200 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    const document = createDocument(longFile);

    const window = editableWindow(asDocument(document), at(99, 0), FAST);
    const excerpt = excerptAround(asDocument(document), window, FAST);

    expect(window.startLine).toBe(95);
    expect(window.endLine).toBe(105);
    expect(excerpt.startLine).toBe(55);
    expect(excerpt.text.split("\n")).toHaveLength(91);
  });
});

describe("toRender", () => {
  it("narrows a whole-region answer down to the lines that changed", () => {
    const document = createDocument(FILE);

    // The model echoes the region it was given and only renames one line, which
    // is the common shape of an answer — the ghost text must not repaint the
    // whole window.
    const render = toRender(asDocument(document), {
      startLine: 1,
      endLine: 5,
      text: [
        "const a = 1;",
        "function f(userId) {",
        "  return userId;",
        "}",
        "export { f };",
      ].join("\n"),
    });

    expect(render?.range.start).toEqual({ line: 1, character: 0 });
    expect(render?.range.end).toEqual({ line: 2, character: 12 });
    expect(render?.text).toBe("function f(userId) {\n  return userId;");
    // Replaced lines are also the lines the accept removes, which is what the
    // strikethrough is drawn on (spec 故事 1 场景 4).
    expect(render?.removed).toHaveLength(1);
    expect(render?.removed[0]).toEqual(render?.range);
  });

  it("expresses a pure deletion as replace-with-the-next-line", () => {
    const document = createDocument(FILE);

    const render = toRender(asDocument(document), {
      startLine: 2,
      endLine: 3,
      text: "",
    });

    // Deleting lines 2-3 keeps `}` as the insertion so ghost text has something
    // to draw; accepting it removes exactly those two lines.
    expect(render?.range.start).toEqual({ line: 1, character: 0 });
    expect(render?.range.end).toEqual({ line: 3, character: 1 });
    expect(render?.text).toBe("}");
    expect(render?.removed[0]).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 2, character: 12 },
    });
  });

  it("borrows the line above when the deletion reaches the end of the file", () => {
    const document = createDocument(FILE);

    const render = toRender(asDocument(document), {
      startLine: 4,
      endLine: 5,
      text: "",
    });

    // The two lines under the deletion go; line 3 survives as the anchor.
    expect(render?.range.start).toEqual({ line: 2, character: 0 });
    expect(render?.range.end).toEqual({ line: 4, character: 13 });
    expect(render?.text).toBe("  return id;");
  });

  it("renders a pure insertion as a zero-width range", () => {
    const document = createDocument(FILE);

    const render = toRender(asDocument(document), {
      startLine: 1,
      endLine: 5,
      text: ["const a = 1;", "const b = 2;", ...FILE.split("\n").slice(1)].join(
        "\n",
      ),
    });

    expect(render?.text).toBe("\nconst b = 2;");
    expect(render?.range.start).toEqual(render?.range.end);
    expect(render?.removed).toEqual([]);
  });

  it("shows nothing when the answer is the region verbatim", () => {
    const document = createDocument(FILE);

    expect(
      toRender(asDocument(document), {
        startLine: 1,
        endLine: 5,
        text: `${FILE}\n`,
      }),
    ).toBeUndefined();
  });

  it("rejects a suggestion past the end of the file", () => {
    const document = createDocument(FILE);

    expect(
      toRender(asDocument(document), { startLine: 4, endLine: 99, text: "x" }),
    ).toBeUndefined();
  });
});

describe("NextEditService", () => {
  let fetch: ReturnType<typeof vi.fn<NextEditFetcher>>;

  beforeEach(() => {
    fetch = vi.fn<NextEditFetcher>();
  });

  it("does not ask without an edit trajectory", async () => {
    const document = createDocument(FILE);
    const service = new NextEditService(fetch, new NextEditHistory(), FAST);

    const render = await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(new FakeToken()),
      true,
    );

    expect(render).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the rewritten window as a replacement", async () => {
    const document = createDocument(FILE);
    const service = new NextEditService(fetch, primedHistory(document), FAST);
    fetch.mockResolvedValue({
      suggestion: {
        startLine: 3,
        endLine: 3,
        text: "  return userId;",
      },
    });

    const render = await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(new FakeToken()),
      true,
    );

    expect(render?.text).toBe("  return userId;");
    expect(fetch.mock.calls[0][0].edits).toEqual([
      { oldText: "id", newText: "userId" },
    ]);
    expect(fetch.mock.calls[0][0].region.startLine).toBe(1);
  });

  it("replays the suggestion it already has once the caret is inside it", async () => {
    const document = createDocument(FILE);
    const service = new NextEditService(fetch, primedHistory(document), FAST);
    fetch.mockResolvedValue({
      suggestion: { startLine: 3, endLine: 3, text: "  return userId;" },
    });

    const first = await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(new FakeToken()),
      true,
    );
    // The jump command moved the caret into the suggested range; VS Code asks
    // again — this must not cost a second model call (spec 故事 4 场景 2).
    const second = await service.getSuggestion(
      asDocument(document),
      at(2, 0),
      asToken(new FakeToken()),
      true,
    );

    expect(first).toBeDefined();
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("hands the suggestion over once, for the accept command to apply", async () => {
    const document = createDocument(FILE);
    const service = new NextEditService(fetch, primedHistory(document), FAST);
    fetch.mockResolvedValue({
      suggestion: { startLine: 3, endLine: 3, text: "  return userId;" },
    });
    await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(new FakeToken()),
      true,
    );

    expect(service.takePending(asDocument(document))).toBeDefined();
    // Taken once: applying it again would rewrite text that has already moved
    // (spec 故事 2 场景 3).
    expect(service.takePending(asDocument(document))).toBeUndefined();
  });

  it("does not hand over a suggestion the document has moved past", async () => {
    const document = createDocument(FILE);
    const service = new NextEditService(fetch, primedHistory(document), FAST);
    fetch.mockResolvedValue({
      suggestion: { startLine: 3, endLine: 3, text: "  return userId;" },
    });
    await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(new FakeToken()),
      true,
    );

    const edited = createDocument(FILE, { version: 2 });

    expect(service.takePending(asDocument(edited))).toBeUndefined();
  });

  it("does not replay across a document change", async () => {
    const document = createDocument(FILE);
    const service = new NextEditService(fetch, primedHistory(document), FAST);
    fetch.mockResolvedValue({
      suggestion: { startLine: 3, endLine: 3, text: "  return userId;" },
    });
    await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(new FakeToken()),
      true,
    );

    const edited = createDocument(FILE, { version: 2 });

    // Line numbers from the previous version no longer describe this text, so
    // the jump target must be gone (spec 故事 4 场景 5).
    expect(service.pendingRange(asDocument(edited))).toBeUndefined();
  });

  it("drops a suggestion whose document version moved on", async () => {
    const document = createDocument(FILE);
    const service = new NextEditService(fetch, primedHistory(document), FAST);
    fetch.mockImplementation(async () => {
      // The user kept typing while the model was thinking.
      document.version = 2;
      return {
        suggestion: { startLine: 3, endLine: 3, text: "  return userId;" },
      };
    });

    const render = await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(new FakeToken()),
      true,
    );

    expect(render).toBeUndefined();
  });

  it("asks at most once for the same state", async () => {
    const document = createDocument(FILE);
    const service = new NextEditService(fetch, primedHistory(document), FAST);
    fetch.mockResolvedValue({ suggestion: null });

    const token = new FakeToken();
    await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(token),
      true,
    );
    await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(token),
      true,
    );

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats a timeout as no suggestion", async () => {
    const document = createDocument(FILE);
    const service = new NextEditService(fetch, primedHistory(document), FAST);
    fetch.mockImplementation(() => new Promise(() => {}));

    const render = await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(new FakeToken()),
      true,
    );

    expect(render).toBeUndefined();
  });

  it("calls it a miss when the CLI answers with an error", async () => {
    const document = createDocument(FILE);
    const service = new NextEditService(fetch, primedHistory(document), FAST);
    fetch.mockRejectedValue(new Error("no session"));

    const render = await service.getSuggestion(
      asDocument(document),
      at(2, 2),
      asToken(new FakeToken()),
      true,
    );

    expect(render).toBeUndefined();
  });
});
