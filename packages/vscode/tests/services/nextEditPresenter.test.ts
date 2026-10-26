import { describe, it, expect, vi } from "vitest";

const decorationTypes: { dispose: ReturnType<typeof vi.fn> }[] = [];

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
  class ThemeColor {
    constructor(public id: string) {}
  }
  return {
    Position,
    Range,
    ThemeColor,
    window: {
      createTextEditorDecorationType: vi.fn(() => {
        const type = { dispose: vi.fn() };
        decorationTypes.push(type);
        return type;
      }),
    },
  };
});

import { NextEditPresenter } from "../../src/services/nextEditPresenter";
import type { NextEditRender } from "../../src/services/nextEditService";

interface FakeEditor {
  document: {
    lineCount: number;
    lineAt: (line: number) => {
      range: { end: { line: number; character: number } };
    };
  };
  selection: { active: { line: number } };
  setDecorations: ReturnType<typeof vi.fn>;
}

function createEditor(caretLine = 0): FakeEditor {
  const lineCount = 40;
  return {
    document: {
      lineCount,
      lineAt: (line: number) => ({
        range: { end: { line, character: line === 0 ? 7 : 12 } },
      }),
    },
    selection: { active: { line: caretLine } },
    setDecorations: vi.fn(),
  };
}

/** A replacement of lines 10-11 (0-based), as the service would produce it. */
function renderAt(line: number): NextEditRender {
  return {
    range: {
      start: { line, character: 0 },
      end: { line: line + 1, character: 12 },
    },
    text: "  return userId;",
    removed: [
      {
        start: { line, character: 0 },
        end: { line: line + 1, character: 12 },
      },
    ],
  } as unknown as NextEditRender;
}

const asEditor = (editor: FakeEditor) =>
  editor as unknown as import("vscode").TextEditor;

describe("NextEditPresenter", () => {
  it("paints only the removals when the editor draws the suggestion itself", () => {
    const presenter = new NextEditPresenter();
    const editor = createEditor();

    const render = renderAt(10);
    presenter.show(asEditor(editor), render, true);

    // Order: strikethrough, replacement preview, hint.
    expect(editor.setDecorations.mock.calls[0][1]).toEqual(render.removed);
    expect(editor.setDecorations.mock.calls[1][1]).toEqual([]);
    expect(editor.setDecorations.mock.calls[2][1]).toEqual([]);
  });

  it("spells out the replacement and the chords when it has to draw it", () => {
    const presenter = new NextEditPresenter();
    const editor = createEditor(4);

    presenter.show(asEditor(editor), renderAt(10), false);

    const preview = editor.setDecorations.mock.calls[1][1] as {
      range: { start: { line: number } };
      renderOptions: { after: { contentText: string } };
    }[];
    expect(preview).toHaveLength(1);
    // The new text hangs off the first line that would go away.
    expect(preview[0].range.start.line).toBe(10);
    expect(preview[0].renderOptions.after.contentText).toContain(
      "return userId;",
    );

    const hint = editor.setDecorations.mock.calls[2][1] as {
      range: { start: { line: number } };
      renderOptions: { after: { contentText: string } };
    }[];
    // The hint goes on the caret's line: that is where the user is looking.
    expect(hint[0].range.start.line).toBe(4);
    expect(hint[0].renderOptions.after.contentText).toContain("Ctrl+Alt+Enter");
  });

  it("takes the overlay down without touching the document", () => {
    const presenter = new NextEditPresenter();
    const editor = createEditor();

    presenter.show(asEditor(editor), renderAt(10), false);
    editor.setDecorations.mockClear();
    presenter.clear(asEditor(editor));

    expect(editor.setDecorations).toHaveBeenCalledTimes(3);
    for (const call of editor.setDecorations.mock.calls) {
      expect(call[1]).toEqual([]);
    }
  });

  it("disposes its decoration types", () => {
    decorationTypes.length = 0;
    new NextEditPresenter().dispose();

    expect(decorationTypes).toHaveLength(3);
    for (const type of decorationTypes) {
      expect(type.dispose).toHaveBeenCalled();
    }
  });
});
