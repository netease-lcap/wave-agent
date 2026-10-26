import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NEXT_EDIT_HISTORY_OPTIONS,
  NextEditHistory,
  type NextEditHistoryOptions,
} from "../../src/services/nextEditHistory";

interface FakeDocument {
  uri: { toString: () => string; scheme: string };
  lineCount: number;
  getText: () => string;
}

function createDocument(text: string): FakeDocument {
  return {
    uri: { toString: () => "file:///repo/a.ts", scheme: "file" },
    lineCount: text.split("\n").length,
    getText: () => text,
  };
}

/** A single typed change: replace `rangeLength` chars at `rangeOffset` with `text`. */
function change(
  rangeOffset: number,
  rangeLength: number,
  text: string,
): { rangeOffset: number; rangeLength: number; text: string } {
  return { rangeOffset, rangeLength, text };
}

const asDocument = (document: FakeDocument) =>
  document as unknown as import("vscode").TextDocument;
const asEvent = (document: FakeDocument, changes: unknown[]) =>
  ({
    document,
    contentChanges: changes,
  }) as unknown as import("vscode").TextDocumentChangeEvent;

const FAST: NextEditHistoryOptions = {
  ...NEXT_EDIT_HISTORY_OPTIONS,
  ttlMs: 1000,
};

describe("NextEditHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads removed and inserted text out of the primed shadow", () => {
    const history = new NextEditHistory(FAST);
    const before = createDocument("function f(id) {}");
    history.prime(asDocument(before));

    const after = createDocument("function f(userId) {}");
    history.record(
      asDocument(after),
      asEvent(after, [change(11, 2, "userId")]),
    );

    expect(history.recent(asDocument(after))).toEqual([
      { oldText: "id", newText: "userId" },
    ]);
  });

  it("treats a whole-document replace as not-a-user-edit and clears the trajectory", () => {
    const history = new NextEditHistory(FAST);
    const original = createDocument("const a = 1;\n");
    history.prime(asDocument(original));
    const edited = createDocument("const a = 2;\n");
    history.record(asDocument(edited), asEvent(edited, [change(8, 1, "2")]));
    expect(history.recent(asDocument(edited))).toHaveLength(1);

    // Branch switch / external formatter: the whole buffer arrives at once.
    const replaced = createDocument(
      "completely different file\ncontent here\n",
    );
    history.record(
      asDocument(replaced),
      asEvent(replaced, [
        change(0, original.getText().length, replaced.getText()),
      ]),
    );

    expect(history.recent(asDocument(replaced))).toEqual([]);
  });

  it("keeps only the newest entries", () => {
    const history = new NextEditHistory({ ...FAST, maxEntries: 2 });
    let text = "0";
    history.prime(asDocument(createDocument(text)));

    for (const next of ["01", "012", "0123"]) {
      const document = createDocument(next);
      history.record(
        asDocument(document),
        asEvent(document, [change(text.length, 0, next.slice(text.length))]),
      );
      text = next;
      history.prime(asDocument(document));
    }

    expect(history.recent(asDocument(createDocument(text)))).toEqual([
      { oldText: "", newText: "2" },
      { oldText: "", newText: "3" },
    ]);
  });

  it("drops edits older than the TTL", () => {
    const history = new NextEditHistory(FAST);
    const document = createDocument("ab");
    history.prime(asDocument(document));
    history.record(
      asDocument(document),
      asEvent(document, [change(1, 0, "x")]),
    );

    vi.advanceTimersByTime(1500);

    expect(history.recent(asDocument(document))).toEqual([]);
    expect(history.lastEditAt(asDocument(document))).toBeUndefined();
  });

  it("skips removals it cannot reconstruct instead of recording half an edit", () => {
    const history = new NextEditHistory(FAST);
    // No prime() call: the removed text is not recoverable.
    const document = createDocument("function f(userId) {}");

    history.record(
      asDocument(document),
      asEvent(document, [change(11, 2, "userId")]),
    );

    expect(history.recent(asDocument(document))).toEqual([]);
  });

  it("forgets a file's trajectory and shadow", () => {
    const history = new NextEditHistory(FAST);
    const document = createDocument("ab");
    history.prime(asDocument(document));
    history.record(
      asDocument(document),
      asEvent(document, [change(1, 0, "x")]),
    );

    history.forget(asDocument(document));

    expect(history.recent(asDocument(document))).toEqual([]);
    expect(history.lastEditAt(asDocument(document))).toBeUndefined();
  });
});
