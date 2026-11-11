/**
 * The file panel's in-panel editor (CodeMirror 6).
 *
 * Lives in the desktop-only `editor.js` chunk (see `src/editor-entry.ts`) and is
 * reached through `window.WaveEditor`, so the framework-free surface below is
 * deliberately tiny: mount, read back, destroy. Everything else (toolbar,
 * dirty state, save/conflict UI) stays in React — this file only owns the text
 * surface, which is what makes "editing" look like the read-only viewer next to
 * it (same monospace text, same 20px line rhythm, horizontal scroll instead of
 * wrapping, line numbers in a gutter).
 */
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { chrome, highlightStyle, languageFor } from "./editorTheme";

export interface CodeEditorOptions {
  /** Initial document (the file's current text). The editor owns it afterwards. */
  doc: string;
  /** File path — only its extension is used, to pick the syntax mode. */
  path: string;
  /** Follows `<html data-theme>`; drives the token palette. */
  dark: boolean;
  /** Fires on every document change with the full text. */
  onChange?: (value: string) => void;
  /** Cmd/Ctrl+S. */
  onSave?: () => void;
}

export interface CodeEditorHandle {
  getValue(): string;
  focus(): void;
  destroy(): void;
}

const saveKeymap = (onSave: () => void) =>
  keymap.of([
    {
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        onSave();
        return true;
      },
    },
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
  ]);

export function createCodeEditor(
  parent: HTMLElement,
  options: CodeEditorOptions,
): CodeEditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        saveKeymap(() => options.onSave?.()),
        languageFor(options.path),
        chrome(options.dark),
        syntaxHighlighting(highlightStyle(options.dark)),
        EditorView.contentAttributes.of({
          "aria-label": "文件编辑器",
          "data-testid": "file-pane-editor",
          spellcheck: "false",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            options.onChange?.(update.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
