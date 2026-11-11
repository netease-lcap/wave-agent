/**
 * The file panel's read-only code surface (CodeMirror 6).
 *
 * Same chunk, same theme and same syntax modes as the editor next to it, but
 * with one deliberate difference: only `EditorState.readOnly` is set — never
 * `EditorView.editable(false)`. That keeps the code an ordinary focusable
 * `contenteditable` surface, which is what makes `Ctrl/Cmd+A` scope to the file
 * being read (that is how Claude's desktop file viewer behaves): with a focused
 * editable the select-all edit command stops at its boundary, so the toolbar
 * path, the tab strip, the truncation hint and the line numbers stay out of the
 * selection. A non-editable editor degrades to a document-wide selection, and
 * plain DOM rows don't scope it at all — the customer-reported bug.
 *
 * Everything else the panel needs rides on decorations instead of React nodes:
 * each line carries `data-testid="file-pane-line-N"` / `data-comment-unit`, the
 * jump-to range is a line class, find hits are marks, and the inline comment box
 * is a block widget whose DOM the file pane portals the React box into.
 */
import { defaultKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { chrome, highlightStyle, languageFor } from "./editorTheme";

/** A find hit, in the panel's own coordinates: 1-based line + offset in it. */
export interface ReadOnlyHit {
  line: number;
  index: number;
  length: number;
  /** The match the find bar is currently on — painted with the stronger style. */
  current?: boolean;
}

export interface ReadOnlyCodeViewOptions {
  doc: string;
  /** Only the extension is used, to pick the syntax mode. */
  path: string;
  dark: boolean;
  /** Attach `data-comment-unit` to every line (the comment entries' anchor). */
  commentUnits?: boolean;
  /** Line range to highlight on open (1-based, inclusive). */
  activeFrom?: number;
  activeTo?: number;
  hits?: ReadOnlyHit[];
  /** Fires when the code scrolled — the comment chip re-anchors against it. */
  onScroll?: () => void;
  /**
   * Receives the DOM slot the inline comment box is portalled into, and `null`
   * when the box closes. The slot sits right after the commented line as a block
   * widget, so the box pushes the following lines down instead of covering them.
   */
  onCommentSlot?: (slot: HTMLElement | null) => void;
}

export interface ReadOnlyCodeViewHandle {
  setActiveRange(from: number | undefined, to: number | undefined): void;
  setHits(hits: ReadOnlyHit[]): void;
  setCommentBox(line: number | null): void;
  scrollToLine(line: number): void;
  getScrollTop(): number;
  setScrollTop(top: number): void;
  /** The scrolling element (`.cm-scroller`) — the comment entries' origin. */
  readonly scrollElement: HTMLElement;
  destroy(): void;
}

interface ActiveRange {
  from: number;
  to: number;
}

const setActiveEffect = StateEffect.define<ActiveRange | null>();
const setHitsEffect = StateEffect.define<ReadOnlyHit[]>();
const setCommentBoxEffect = StateEffect.define<number | null>();

/** One line decoration per line: the testids and comment units the panel (and
 *  its tests) resolve lines by, plus the jump-to highlight. */
const buildLines = (
  doc: Text,
  active: ActiveRange | null,
  commentUnits: boolean,
): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const attributes: Record<string, string> = {
      "data-testid": `file-pane-line-${n}`,
    };
    if (commentUnits) attributes["data-comment-unit"] = String(n);
    if (active && n >= active.from && n <= active.to)
      attributes.class = "file-pane-line--active";
    builder.add(line.from, line.from, Decoration.line({ attributes }));
  }
  return builder.finish();
};

/** The jump-to highlight is dropped as soon as the file has a non-empty
 *  selection — same rule Claude's desktop viewer uses (`selection.ranges.some(r
 *  => !r.empty)` ⇒ empty decoration). Two background colours on screen at once
 *  read as one confusing "half selected" state; with the band out of the way a
 *  selection is unambiguous, and the band comes back when the selection is
 *  cleared. The line attributes themselves stay: they are the panel's line and
 *  comment anchors, not decoration. */
const lineField = (commentUnits: boolean) =>
  StateField.define<{
    active: ActiveRange | null;
    hasSelection: boolean;
    deco: DecorationSet;
  }>({
    create: (state) => ({
      active: null,
      hasSelection: false,
      deco: buildLines(state.doc, null, commentUnits),
    }),
    update: (value, tr) => {
      let active = value.active;
      let changed = tr.docChanged;
      for (const effect of tr.effects)
        if (effect.is(setActiveEffect)) {
          active = effect.value;
          changed = true;
        }
      const hasSelection = tr.state.selection.ranges.some((r) => !r.empty);
      if (hasSelection !== value.hasSelection) changed = true;
      return changed
        ? {
            active,
            hasSelection,
            deco: buildLines(
              tr.state.doc,
              hasSelection ? null : active,
              commentUnits,
            ),
          }
        : value;
    },
    provide: (field) => EditorView.decorations.from(field, (v) => v.deco),
  });

/** Find hits as marks. The ranges arrive in panel coordinates (line + offset) and
 *  are converted to document offsets here, so the panel never needs a copy of the
 *  document's line table. */
const buildHits = (doc: Text, hits: ReadOnlyHit[]): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...hits].sort((a, b) => a.line - b.line || a.index - b.index);
  let last = -1;
  for (const hit of sorted) {
    if (hit.line < 1 || hit.line > doc.lines) continue;
    const line = doc.line(hit.line);
    const from = line.from + Math.min(hit.index, line.length);
    const to = Math.min(line.to, from + hit.length);
    if (to <= from || from < last) continue;
    builder.add(
      from,
      to,
      Decoration.mark({
        class: hit.current
          ? "file-pane-find-hit file-pane-find-hit--current"
          : "file-pane-find-hit",
      }),
    );
    last = to;
  }
  return builder.finish();
};

const hitsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    for (const effect of tr.effects)
      if (effect.is(setHitsEffect))
        return buildHits(tr.state.doc, effect.value);
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The empty block the file pane portals the React comment box into. */
class CommentBoxWidget extends WidgetType {
  constructor(private readonly onMount: (el: HTMLElement | null) => void) {
    super();
  }

  // The box is the same widget whatever changed around it: keeping `eq` true
  // stops CodeMirror from rebuilding the DOM, which would unmount the portalled
  // textarea (and drop the half-typed comment) on every unrelated re-decoration.
  eq() {
    return true;
  }

  toDOM(): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "file-pane-comment-slot";
    slot.setAttribute("contenteditable", "false");
    this.onMount(slot);
    return slot;
  }

  destroy(): void {
    this.onMount(null);
  }

  // Events inside the box (typing, Enter, Esc) belong to the textarea, not to
  // the editor's own key/selection handling.
  ignoreEvent(): boolean {
    return true;
  }
}

const commentBoxField = (onMount: (el: HTMLElement | null) => void) =>
  StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (deco, tr) => {
      for (const effect of tr.effects) {
        if (!effect.is(setCommentBoxEffect)) continue;
        const line = effect.value;
        if (line === null || line < 1 || line > tr.state.doc.lines)
          return Decoration.none;
        return Decoration.set([
          Decoration.widget({
            widget: new CommentBoxWidget(onMount),
            block: true,
            side: 1,
          }).range(tr.state.doc.line(line).to),
        ]);
      }
      return deco.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });

/** Read-only dressing: no caret, no active-line band. */
const readOnlyChrome = EditorView.theme({
  ".cm-cursor, .cm-dropCursor": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-content": { cursor: "text" },
});

/** Scroll margin for jump-to-line: two lines of context above the target, the
 *  same shape the DOM viewer used to produce. */
const JUMP_MARGIN = 40;

export function createReadOnlyCodeView(
  parent: HTMLElement,
  options: ReadOnlyCodeViewOptions,
): ReadOnlyCodeViewHandle {
  const extensions: Extension[] = [
    lineNumbers(),
    // `readOnly` only — see the file comment. Keeping the surface editable is
    // what scopes the native select-all to the file.
    EditorState.readOnly.of(true),
    keymap.of([...defaultKeymap]),
    languageFor(options.path),
    chrome(options.dark),
    readOnlyChrome,
    syntaxHighlighting(highlightStyle(options.dark)),
    lineField(options.commentUnits === true),
    hitsField,
    commentBoxField(options.onCommentSlot ?? (() => {})),
    EditorView.contentAttributes.of({
      "aria-label": "文件内容",
      "data-testid": "file-pane-viewer",
      spellcheck: "false",
      autocapitalize: "off",
    }),
  ];

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: options.doc, extensions }),
  });

  if (options.activeFrom !== undefined) {
    // Applied in the same tick as the mount so the highlight is in the first
    // paint; the scroll is applied by the caller once the panel has a height.
    view.dispatch({
      effects: setActiveEffect.of({
        from: options.activeFrom,
        to: options.activeTo ?? options.activeFrom,
      }),
    });
  }
  if (options.hits && options.hits.length > 0) {
    view.dispatch({ effects: setHitsEffect.of(options.hits) });
  }

  const onScroll = () => options.onScroll?.();
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });

  const clampLine = (line: number) =>
    Math.min(Math.max(Math.round(line), 1), view.state.doc.lines);

  return {
    setActiveRange(from, to) {
      view.dispatch({
        effects: setActiveEffect.of(
          from === undefined ? null : { from, to: to ?? from },
        ),
      });
    },
    setHits(hits) {
      view.dispatch({ effects: setHitsEffect.of(hits) });
    },
    setCommentBox(line) {
      view.dispatch({ effects: setCommentBoxEffect.of(line) });
    },
    scrollToLine(line) {
      const from = view.state.doc.line(clampLine(line)).from;
      view.dispatch({
        effects: EditorView.scrollIntoView(from, {
          y: "start",
          yMargin: JUMP_MARGIN,
        }),
      });
    },
    getScrollTop: () => view.scrollDOM.scrollTop,
    setScrollTop: (top) => {
      view.scrollDOM.scrollTop = top;
    },
    scrollElement: view.scrollDOM,
    destroy() {
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.destroy();
    },
  };
}
