import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChatApp } from './ChatApp';
import { DesktopSidebar, SESSION_DRAG_MIME } from './DesktopSidebar';
import type { DesktopHostProps, DesktopPane, VsCodeApi } from '../types';
import '../styles/DesktopApp.css';

const MIN_PANE_WIDTH = 360;
const HINT_DURATION_MS = 2400;
const PANE_DRAG_MIME = 'application/x-wave-pane';

interface DesktopShellProps {
  vscode: VsCodeApi;
  host: DesktopHostProps;
  /** Sidebar more-menu actions — owned by the delegating ChatApp instance. */
  onOpenSettings: () => void;
  onOpenEnterpriseConsole: () => void;
  onLogin: () => void;
  onLogout: () => void;
  isAuthenticated: boolean;
}

/**
 * Desktop split-view layout: sidebar on the left, N chat panes in the middle,
 * preview pane (owned by the single-pane ChatApp) on the right.
 *
 * Rendered when the host pushes ≥1 pane via `desktopPanes`. ChatApp delegates
 * here; for each pane it renders one paneId-scoped ChatApp instance, which
 * filters host pushes by paneId and tags outgoing commands with it.
 *
 * The layout itself is host-authoritative: Cmd/Ctrl+Click on a sidebar session
 * appends a pane (`desktopOpenPane`), dragging a sidebar session onto a pane
 * gap inserts there (anywhere else appends), dragging a pane header reorders
 * (`desktopMovePane`), and dragging a separator resizes the adjacent pair
 * (`desktopResizePanes`, with a live local preview). The webview never applies
 * the new order or widths on its own — it waits for the next `desktopPanes`.
 */
export const DesktopShell: React.FC<DesktopShellProps> = ({
  vscode,
  host,
  onOpenSettings,
  onOpenEnterpriseConsole,
  onLogin,
  onLogout,
  isAuthenticated,
}) => {
  const panes: DesktopPane[] = host.panes ?? [];
  const focusedPaneId = host.focusedPaneId ?? panes[0]?.paneId ?? null;
  const [hint, setHint] = useState<string | null>(null);
  const [dropIndicatorX, setDropIndicatorX] = useState<number | null>(null);
  const [resizePreview, setResizePreview] = useState<number[] | null>(null);
  const [activeSeparator, setActiveSeparator] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paneNodes = useRef(new Map<string, HTMLDivElement>());
  // Insertion boundary (0..panes.length) tracked while a pane header drags.
  const dropBoundary = useRef<number | null>(null);
  const resizePreviewRef = useRef<number[] | null>(null);

  const showHint = useCallback((text: string) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHint(text);
    hintTimer.current = setTimeout(() => setHint(null), HINT_DURATION_MS);
  }, []);

  const canAddPane = useCallback((): boolean => {
    const rowWidth = rowRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    return rowWidth / (panes.length + 1) >= MIN_PANE_WIDTH;
  }, [panes.length]);

  // Cmd/Ctrl+Click on a sidebar session or a sidebar drag-drop — guarded by
  // the same min-width rule the host applies, so the refusal hint shows
  // without a round trip. An already-visible session skips the width gate:
  // the host just focuses its pane instead of adding one.
  const handleOpenPane = useCallback((workdir: string, sessionId: string, insertionIndex?: number) => {
    if (!panes.some((p) => p.sessionId === sessionId) && !canAddPane()) {
      showHint('窗口宽度不足，无法添加更多分屏');
      return;
    }
    host.onOpenPane(workdir, sessionId, insertionIndex);
  }, [canAddPane, host, panes, showHint]);

  const handleFocusPane = useCallback((paneId: string) => {
    if (paneId === focusedPaneId) return;
    vscode.postMessage({ command: 'desktopFocusPane', paneId });
  }, [focusedPaneId, vscode]);

  const handleClosePane = useCallback((paneId: string) => {
    vscode.postMessage({ command: 'desktopClosePane', paneId });
  }, [vscode]);

  // The pane header is rendered inside each pane-scoped ChatApp (a shared
  // component), so the reorder drag source is wired imperatively here rather
  // than threading drag props through the shared chat tree.
  useLayoutEffect(() => {
    const disposers: Array<() => void> = [];
    panes.forEach((pane, index) => {
      const header = paneNodes.current.get(pane.paneId)?.querySelector<HTMLElement>('.chat-header');
      if (!header) return;
      header.draggable = true;
      // A press that begins on an interactive header child (panel toggle,
      // popup menu items) must stay a click: any pointer movement during the
      // press would otherwise start a pane drag and swallow the click.
      // dragstart is dispatched to the draggable header itself, so the press
      // target is recorded on mousedown and the drag is vetoed here.
      let pressTarget: EventTarget | null = null;
      const onMouseDown = (e: MouseEvent) => {
        pressTarget = e.target;
      };
      const onDragStart = (e: DragEvent) => {
        if (!e.dataTransfer) return;
        if (
          pressTarget instanceof Element &&
          pressTarget.closest('button, a, input, select, textarea, [role="button"]')
        ) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(PANE_DRAG_MIME, JSON.stringify({ paneId: pane.paneId, fromIndex: index }));
        try {
          e.dataTransfer.effectAllowed = 'move';
        } catch {
          // jsdom's DataTransfer polyfill exposes a read-only effectAllowed.
        }
      };
      const onDragEnd = () => {
        pressTarget = null;
        dropBoundary.current = null;
        setDropIndicatorX(null);
      };
      header.addEventListener('mousedown', onMouseDown);
      header.addEventListener('dragstart', onDragStart);
      header.addEventListener('dragend', onDragEnd);
      disposers.push(() => {
        header.removeEventListener('mousedown', onMouseDown);
        header.removeEventListener('dragstart', onDragStart);
        header.removeEventListener('dragend', onDragEnd);
        header.draggable = false;
      });
    });
    return () => disposers.forEach((dispose) => dispose());
  }, [panes]);

  // Records the insertion boundary and places the marker at markerX (viewport
  // coordinates), converted into row-content coordinates for the overlay.
  const showDropIndicator = useCallback((boundary: number, markerX: number) => {
    const rowEl = rowRef.current;
    if (!rowEl) return;
    dropBoundary.current = boundary;
    const rowRect = rowEl.getBoundingClientRect();
    // Center the 2px bar on the boundary, clamped inside the content box: an
    // absolutely positioned child past the right content edge would extend the
    // row's scrollable overflow, surfacing a horizontal scrollbar and pushing
    // the bar itself out of view.
    const x = markerX - rowRect.left + rowEl.scrollLeft - 1;
    const maxX = rowEl.scrollWidth - 2;
    setDropIndicatorX(Math.max(0, Math.min(x, maxX)));
  }, []);

  const handlePaneDragOver = useCallback((e: React.DragEvent, index: number) => {
    if (!e.dataTransfer.types.includes(PANE_DRAG_MIME)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {
      // jsdom's DataTransfer polyfill exposes a read-only dropEffect.
    }
    const pane = panes[index];
    const paneEl = pane ? paneNodes.current.get(pane.paneId) : undefined;
    if (!paneEl) return;
    const rect = paneEl.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    showDropIndicator(before ? index : index + 1, before ? rect.left : rect.right);
  }, [panes, showDropIndicator]);

  const handleSeparatorDragOver = useCallback((e: React.DragEvent, boundary: number) => {
    if (!e.dataTransfer.types.includes(PANE_DRAG_MIME)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {
      // jsdom's DataTransfer polyfill exposes a read-only dropEffect.
    }
    showDropIndicator(boundary, e.currentTarget.getBoundingClientRect().left);
  }, [showDropIndicator]);

  const handlePaneDrop = useCallback((e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(PANE_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    setDropIndicatorX(null);
    try {
      const { paneId, fromIndex } = JSON.parse(raw);
      const boundary = dropBoundary.current;
      dropBoundary.current = null;
      if (!paneId || boundary == null) return;
      // The boundary refers to the current order; after pulling the dragged
      // pane out, boundaries to its right shift one slot left.
      const toIndex = boundary > fromIndex ? boundary - 1 : boundary;
      if (toIndex === fromIndex) return;
      vscode.postMessage({ command: 'desktopMovePane', paneId, toIndex });
    } catch {
      // Not a pane payload — ignore.
    }
  }, [vscode]);

  // Sidebar session drags are handled at row level (pane/separator dragovers
  // ignore the session MIME and let the event bubble up here). The insertion
  // boundary follows the same midpoint rule as pane-header drags: hovering a
  // pane's left half inserts before it, right half after it; gaps between
  // panes snap to that boundary; past the last pane appends at the right end.
  const handleSessionDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(SESSION_DRAG_MIME)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'copy';
    } catch {
      // jsdom's DataTransfer polyfill exposes a read-only dropEffect.
    }
    for (let i = 0; i < panes.length; i += 1) {
      const el = paneNodes.current.get(panes[i].paneId);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left) {
        // In the gap before this pane.
        showDropIndicator(i, rect.left);
        return;
      }
      if (e.clientX <= rect.right) {
        const before = e.clientX < rect.left + rect.width / 2;
        showDropIndicator(before ? i : i + 1, before ? rect.left : rect.right);
        return;
      }
      // Past this pane — keep looking (covers inter-pane gaps).
    }
    const lastEl = paneNodes.current.get(panes[panes.length - 1]?.paneId);
    if (lastEl) showDropIndicator(panes.length, lastEl.getBoundingClientRect().right);
  }, [panes, showDropIndicator]);

  const handleSessionDrop = useCallback((e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(SESSION_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    setDropIndicatorX(null);
    const boundary = dropBoundary.current;
    dropBoundary.current = null;
    try {
      const { workdir, sessionId } = JSON.parse(raw);
      if (!workdir || !sessionId) return;
      handleOpenPane(workdir, sessionId, boundary ?? undefined);
    } catch {
      // Not a session payload — ignore.
    }
  }, [handleOpenPane]);

  // Clear the indicator when the drag leaves the row entirely.
  const handleRowDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget;
    if (next instanceof Node && rowRef.current?.contains(next)) return;
    dropBoundary.current = null;
    setDropIndicatorX(null);
  }, []);

  // Sidebar drags end on the sidebar item (no drop on the row) — clear the
  // indicator from anywhere. The pane-header dragend does the same for its
  // own drag; this is the backstop for every source.
  useEffect(() => {
    const clear = () => {
      dropBoundary.current = null;
      setDropIndicatorX(null);
    };
    document.addEventListener('dragend', clear);
    return () => document.removeEventListener('dragend', clear);
  }, []);

  const handleSeparatorMouseDown = useCallback((e: React.MouseEvent, separatorIndex: number) => {
    e.preventDefault();
    const startX = e.clientX;
    const widths = panes.map((pane) => paneNodes.current.get(pane.paneId)?.getBoundingClientRect().width ?? 0);
    const pairTotal = widths[separatorIndex] + widths[separatorIndex + 1];
    setActiveSeparator(separatorIndex);
    const onMouseMove = (ev: MouseEvent) => {
      // Both panes of the pair keep at least the minimum width; a pair that
      // can't satisfy that is frozen in place.
      if (pairTotal < MIN_PANE_WIDTH * 2) return;
      const clamped = Math.max(
        MIN_PANE_WIDTH,
        Math.min(pairTotal - MIN_PANE_WIDTH, widths[separatorIndex] + ev.clientX - startX),
      );
      const next = [...widths];
      next[separatorIndex] = clamped;
      next[separatorIndex + 1] = pairTotal - clamped;
      resizePreviewRef.current = next;
      setResizePreview(next);
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setActiveSeparator(null);
      const preview = resizePreviewRef.current;
      resizePreviewRef.current = null;
      setResizePreview(null);
      if (!preview) return;
      const sum = preview.reduce((total, w) => total + w, 0);
      if (sum <= 0) return;
      vscode.postMessage({ command: 'desktopResizePanes', widths: preview.map((w) => w / sum) });
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [panes, vscode]);

  const focusedSessionId = panes.find((p) => p.paneId === focusedPaneId)?.sessionId;

  return (
    <div className="desktop-layout" data-testid="desktop-shell">
      <DesktopSidebar
        onNewSession={() => vscode.postMessage({ command: 'clearChat' })}
        isStreaming={false}
        disabled={!host.workdir}
        onOpenSettings={onOpenSettings}
        onOpenEnterpriseConsole={onOpenEnterpriseConsole}
        onLogin={onLogin}
        onLogout={onLogout}
        isAuthenticated={isAuthenticated}
        sessionTree={host.sessionTree}
        currentSessionId={focusedSessionId}
        onSelectSession={host.onSelectSession}
        onOpenPane={handleOpenPane}
        onDeleteSession={host.onDeleteSession}
      />
      <div
        ref={rowRef}
        className="desktop-pane-row"
        data-testid="desktop-pane-row"
        onDragOver={handleSessionDragOver}
        onDrop={handleSessionDrop}
        onDragLeave={handleRowDragLeave}
      >
        {panes.map((pane, index) => {
          const paneStyle: React.CSSProperties = { minWidth: MIN_PANE_WIDTH };
          if (resizePreview && resizePreview[index] != null) {
            // Live preview while a separator drags (pixel widths).
            paneStyle.flex = `0 0 ${resizePreview[index]}px`;
          } else if (pane.width != null) {
            paneStyle.flex = `0 0 ${pane.width * 100}%`;
          }
          return (
            <React.Fragment key={pane.paneId}>
              {index > 0 && (
                <div
                  className={`desktop-pane-separator${activeSeparator === index - 1 ? ' desktop-pane-separator--active' : ''}`}
                  onMouseDown={(e) => handleSeparatorMouseDown(e, index - 1)}
                  onDragOver={(e) => handleSeparatorDragOver(e, index)}
                  onDrop={handlePaneDrop}
                  data-testid={`desktop-pane-separator-${index - 1}`}
                />
              )}
              <div
                ref={(el) => {
                  if (el) paneNodes.current.set(pane.paneId, el);
                  else paneNodes.current.delete(pane.paneId);
                }}
                className={`desktop-pane${pane.paneId === focusedPaneId ? ' desktop-pane--focused' : ''}${panes.length > 1 ? ' desktop-pane--closable' : ''}`}
                style={paneStyle}
                onMouseDown={() => handleFocusPane(pane.paneId)}
                onDragOver={(e) => handlePaneDragOver(e, index)}
                onDrop={handlePaneDrop}
                data-testid={`desktop-pane-${pane.paneId}`}
              >
                {panes.length > 1 && (
                  <button
                    className="desktop-pane-close"
                    title="关闭分屏"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => handleClosePane(pane.paneId)}
                    data-testid={`desktop-pane-close-${pane.paneId}`}
                  >
                    <span className="codicon codicon-close"></span>
                  </button>
                )}
                <ChatApp vscode={vscode} host={host} paneId={pane.paneId} />
              </div>
            </React.Fragment>
          );
        })}
        {dropIndicatorX != null && (
          <div
            className="desktop-pane-drop-indicator"
            style={{ left: dropIndicatorX }}
            data-testid="desktop-pane-drop-indicator"
          />
        )}
        {hint && (
          <div className="desktop-pane-hint" role="status" data-testid="desktop-pane-hint">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
};

export default DesktopShell;
