import * as vscode from "vscode";
import type { NextEditRender } from "./nextEditService.js";

/**
 * Command the user runs to go to a suggestion that is not at the caret.
 *
 * VS Code draws a replacement suggestion only where the caret is, so a next-edit
 * suggestion the user has not walked into yet can be shown as a hint and nothing
 * else. Going there is the user's move, never automatic (spec 故事 4).
 */
export const JUMP_TO_NEXT_EDIT_COMMAND = "wave.nextEdit.jump";

/**
 * Paints what ghost text cannot: the lines a suggestion would delete, the text it
 * would put there instead, and the "the suggestion is over there" hint.
 *
 * VS Code's inline completion API shows a suggestion only when it inserts at the
 * caret: an item with a non-empty range is accepted by the API and then never
 * rendered (verified in the real editor — see `tests-e2e/specs/nextEdit.spec.cjs`).
 * A rewrite therefore has to be drawn by hand (spec 故事 1 场景 4), and taken with
 * its own command (spec 故事 2). Decorations never touch the document, which keeps
 * the rule that accepting a suggestion is the only thing that writes.
 */
export class NextEditPresenter implements vscode.Disposable {
  private readonly removed: vscode.TextEditorDecorationType;
  private readonly preview: vscode.TextEditorDecorationType;
  private readonly hint: vscode.TextEditorDecorationType;

  constructor() {
    // Same colours the editor itself uses to mark a removal in a diff, so the
    // rendering reads as "this is what the change looks like" rather than as a
    // wave-specific overlay.
    this.removed = vscode.window.createTextEditorDecorationType({
      textDecoration: "line-through",
      backgroundColor: new vscode.ThemeColor(
        "diffEditor.removedTextBackground",
      ),
      overviewRulerColor: new vscode.ThemeColor(
        "editorOverviewRuler.deletedForeground",
      ),
    });
    this.preview = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
      },
    });
    this.hint = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
      },
    });
  }

  /**
   * Draws one render.
   *
   * `ghostText` means VS Code is showing the suggestion itself (an insertion at
   * the caret): then there is nothing to add. Otherwise the removals are struck
   * through, the replacement is spelled out on the line it belongs to, and the
   * caret's line carries the two chords that work on it.
   */
  show(
    editor: vscode.TextEditor,
    render: NextEditRender,
    ghostText: boolean,
  ): void {
    editor.setDecorations(this.removed, render.removed);
    if (ghostText) {
      editor.setDecorations(this.preview, []);
      editor.setDecorations(this.hint, []);
      return;
    }
    editor.setDecorations(this.preview, [previewFor(editor, render)]);
    editor.setDecorations(this.hint, [hintFor(editor)]);
  }

  /** Takes the overlay down. Never touches the document. */
  clear(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    editor.setDecorations(this.removed, []);
    editor.setDecorations(this.preview, []);
    editor.setDecorations(this.hint, []);
  }

  dispose(): void {
    this.removed.dispose();
    this.preview.dispose();
    this.hint.dispose();
  }
}

/** The chords the hint line advertises. */
const HINT_TEXT = " ⤴ 下一步建议：Ctrl+Alt+Enter 接受 · Ctrl+Alt+] 跳转";

/** How much of the new text the preview may carry before it is cut short. */
const PREVIEW_MAX_CHARS = 80;

/**
 * Spells out what the suggestion would put in place of the struck-through lines,
 * attached to the line it starts at — one line of new text is readable, a whole
 * rewritten block is not, so a long answer is cut short.
 */
function previewFor(
  editor: vscode.TextEditor,
  render: NextEditRender,
): vscode.DecorationOptions {
  const line = render.removed.length
    ? render.removed[0].start.line
    : render.range.start.line;
  const anchorLine = Math.min(line, editor.document.lineCount - 1);
  const added =
    render.text.trim() === ""
      ? "（删除这几行）"
      : render.text
          .split("\n")
          .map((text) => text.trim())
          .join(" ⏎ ");
  return {
    range: new vscode.Range(
      editor.document.lineAt(anchorLine).range.end,
      editor.document.lineAt(anchorLine).range.end,
    ),
    renderOptions: {
      after: {
        contentText: `  →  ${
          added.length > PREVIEW_MAX_CHARS
            ? `${added.slice(0, PREVIEW_MAX_CHARS)} …`
            : added
        }`,
      },
    },
  };
}

/**
 * The hint on the caret's own line: that is where the user is looking, while the
 * suggestion may be several lines away.
 */
function hintFor(editor: vscode.TextEditor): vscode.DecorationOptions {
  const line = Math.min(
    editor.selection.active.line,
    editor.document.lineCount - 1,
  );
  const end = editor.document.lineAt(line).range.end;
  return {
    range: new vscode.Range(end, end),
    renderOptions: { after: { contentText: HINT_TEXT } },
  };
}
