import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  loadEditorLib,
  type ReadOnlyCodeViewHandle,
  type ReadOnlyHit,
  type WaveEditorGlobal,
} from "./editorLoader";
import { isDarkTheme } from "../../utils/theme";

export interface ReadOnlyCodeViewProps {
  /** Path of the file being read — the syntax mode, and part of the mount key. */
  path: string;
  /** The file's text. A new read of the same path remounts the view. */
  content: string;
  /** Attach `data-comment-unit` to every line (the comment entries' anchor). */
  commentUnits?: boolean;
  /** Line range highlighted on open (1-based, inclusive). */
  activeFrom?: number;
  activeTo?: number;
  /** Where the view scrolls itself once it has a height. */
  startLine?: number;
  /** Find hits, in panel coordinates (line + offset in it). */
  hits?: ReadOnlyHit[];
  /** The code scrolled — the comment chip re-anchors against the new geometry. */
  onScroll?: () => void;
  /** DOM slot for the inline comment box (the panel portals the box into it). */
  onCommentSlot?: (slot: HTMLElement | null) => void;
}

export interface ReadOnlyCodeViewRef {
  scrollToLine(line: number): void;
  /** Insert (or remove) the slot the inline comment box is portalled into. */
  setCommentBox(line: number | null): void;
  getScrollTop(): number;
  setScrollTop(top: number): void;
}

/**
 * Mounts the lazily loaded CodeMirror *read-only* surface for the file panel.
 *
 * Structurally the sibling of `FileEditor` (same chunk, same load/status
 * pattern, uncontrolled on purpose), but the mount key is the path *and* the
 * text: the host may re-read the same file, and the viewer has to show the new
 * bytes rather than the ones it was mounted with.
 */
export const ReadOnlyCodeView = forwardRef<
  ReadOnlyCodeViewRef,
  ReadOnlyCodeViewProps
>(function ReadOnlyCodeView(
  {
    path,
    content,
    commentUnits,
    activeFrom,
    activeTo,
    startLine,
    hits,
    onScroll,
    onCommentSlot,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ReadOnlyCodeViewHandle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  // Latest callbacks and decorations, so a re-render never forces a remount:
  // everything that can change while the view is mounted is pushed through the
  // handle below instead of going into the mount options.
  const latestRef = useRef({ onScroll, onCommentSlot });
  latestRef.current = { onScroll, onCommentSlot };

  useEffect(() => {
    let disposed = false;
    const attach = (lib: WaveEditorGlobal) => {
      if (disposed || !hostRef.current) return;
      const { onScroll: scroll, onCommentSlot: slot } = latestRef.current;
      handleRef.current = lib.createReadOnlyCodeView(hostRef.current, {
        doc: content,
        path,
        dark: isDarkTheme(),
        commentUnits: commentUnits === true,
        onScroll: () => scroll?.(),
        onCommentSlot: (el) => slot?.(el),
      });
      setStatus("ready");
    };
    // Chunk already injected (the panel prefetches it, and every file after the
    // first one reuses it): mount in the same effect instead of flashing the
    // loading state for a promise hop.
    if (typeof window !== "undefined" && window.WaveEditor) {
      attach(window.WaveEditor);
    } else {
      setStatus("loading");
      loadEditorLib()
        .then(attach)
        .catch(() => {
          if (!disposed) setStatus("failed");
        });
    }
    return () => {
      disposed = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [path, content, commentUnits]);

  // Decorations follow the panel's state without touching the mounted view.
  useEffect(() => {
    handleRef.current?.setActiveRange(activeFrom, activeTo);
  }, [activeFrom, activeTo, status]);

  useEffect(() => {
    handleRef.current?.setHits(hits ?? []);
  }, [hits, status]);

  // The jump-to-line request (open a file at a line, or re-open the same file at
  // another one) is a scroll, not a remount. After the first paint, so
  // CodeMirror has measured line heights and can resolve the target.
  useEffect(() => {
    if (startLine === undefined) return;
    const frame = requestAnimationFrame(() => {
      handleRef.current?.scrollToLine(startLine);
    });
    return () => cancelAnimationFrame(frame);
  }, [startLine, status]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToLine: (line: number) => handleRef.current?.scrollToLine(line),
      setCommentBox: (line: number | null) =>
        handleRef.current?.setCommentBox(line),
      getScrollTop: () => handleRef.current?.getScrollTop() ?? 0,
      setScrollTop: (top: number) => handleRef.current?.setScrollTop(top),
    }),
    [],
  );

  return (
    <>
      {status === "loading" && (
        <div
          className="file-pane-status file-pane-status--loading"
          data-testid="file-view-loading"
        >
          <i className="codicon codicon-loading codicon-modifier-spin" />
          <span>正在加载…</span>
        </div>
      )}
      {status === "failed" && (
        <div
          className="file-pane-status file-pane-status--failed"
          data-testid="file-view-failed"
        >
          <i className="codicon codicon-error file-pane-status-icon" />
          <span>文件内容加载失败</span>
        </div>
      )}
      <div ref={hostRef} className="file-pane-view-host" />
    </>
  );
});

export default ReadOnlyCodeView;
