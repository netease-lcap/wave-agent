import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChatApp } from './ChatApp';
import { DesktopSidebar, SESSION_DRAG_MIME } from './DesktopSidebar';
import type { DesktopHostProps, DesktopPane, OpenPaneOptions, VsCodeApi } from '../types';
import '../styles/DesktopApp.css';

const MIN_PANE_WIDTH = 360;
/** Minimum height of a pane row; splitting into two rows needs 2× this and
    the row separator clamps to it (the desktop host enforces the same limit). */
const MIN_ROW_HEIGHT = 280;
const HINT_DURATION_MS = 2400;
const PANE_DRAG_MIME = 'application/x-wave-pane';

type DropZone = 'above' | 'below';

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
 * Desktop split-view layout: sidebar on the left, up to two rows of chat
 * panes in the middle, preview pane (owned by the single-pane ChatApp) on the
 * right.
 *
 * Rendered when the host pushes ≥1 pane via `desktopPanes`. ChatApp delegates
 * here; for each pane it renders one paneId-scoped ChatApp instance, which
 * filters host pushes by paneId and tags outgoing commands with it.
 *
 * The layout itself is host-authoritative: Cmd/Ctrl+Click on a sidebar session
 * appends a pane to the focused pane's row (`desktopOpenPane`), dragging a
 * sidebar session onto a pane gap inserts there, dragging a pane header
 * reorders within a row or moves across rows (`desktopMovePane`), dragging a
 * pane/session onto the top or bottom edge band of a single-row layout splits
 * it into two rows (VS Code-style translucent drop zone), and dragging a
 * separator resizes the adjacent pair (`desktopResizePanes`) or the two rows
 * (`desktopResizePaneRows`), with a live local preview. The webview never
 * applies the new order or sizes on its own — it waits for `desktopPanes`.
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
  // Panes grouped by row (0 = top, 1 = bottom); the host guarantees row 0 is
  // non-empty and at most two rows exist.
  const paneRows: DesktopPane[][] = [[], []];
  for (const p of panes) paneRows[p.row === 1 ? 1 : 0].push(p);
  if (paneRows[1].length === 0) paneRows.pop();
  const hasTwoRows = paneRows.length === 2;

  const [hint, setHint] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ row: number; x: number } | null>(null);
  // VS Code-style translucent overlay while hovering an edge band (only in a
  // single-row layout): drop splits the layout into two rows.
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const [resizePreview, setResizePreview] = useState<{ row: number; widths: number[] } | null>(null);
  const [rowResizePreview, setRowResizePreview] = useState<number[] | null>(null);
  const [activeSeparator, setActiveSeparator] = useState<{ row: number; index: number } | null>(null);
  const [rowSeparatorActive, setRowSeparatorActive] = useState(false);
  const rowsContainerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paneNodes = useRef(new Map<string, HTMLDivElement>());
  // Insertion boundary (row + gap index) tracked while a pane/session drags.
  const dropBoundary = useRef<{ row: number; index: number } | null>(null);
  const resizePreviewRef = useRef<{ row: number; widths: number[] } | null>(null);

  const showHint = useCallback((text: string) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHint(text);
    hintTimer.current = setTimeout(() => setHint(null), HINT_DURATION_MS);
  }, []);

  const clearDragFeedback = useCallback(() => {
    dropBoundary.current = null;
    setDropIndicator(null);
    setDropZone(null);
  }, []);

  const canAddPane = useCallback((row: number): boolean => {
    const rowCount = panes.filter((p) => (p.row === 1 ? 1 : 0) === row).length;
    const rowWidth = rowRefs.current[row]?.getBoundingClientRect().width ?? window.innerWidth;
    return rowWidth / (rowCount + 1) >= MIN_PANE_WIDTH;
  }, [panes]);

  const canSplitRows = useCallback((): boolean => {
    const height = rowsContainerRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    return height / 2 >= MIN_ROW_HEIGHT;
  }, []);

  const rowOfPane = useCallback((paneId: string): number => {
    return panes.find((p) => p.paneId === paneId)?.row === 1 ? 1 : 0;
  }, [panes]);

  // Cmd/Ctrl+Click on a sidebar session or a sidebar drag-drop — guarded by
  // the same min-size rules the host applies, so the refusal hint shows
  // without a round trip. An already-visible session skips the gates: the
  // host just focuses its pane instead of adding one.
  const handleOpenPane = useCallback((workdir: string, sessionId: string, opts?: OpenPaneOptions) => {
    if (!panes.some((p) => p.sessionId === sessionId)) {
      if (opts?.newRow && !hasTwoRows) {
        if (!canSplitRows()) {
          showHint('窗口高度不足，无法拆分为两行');
          return;
        }
      } else if (!canAddPane(opts?.row ?? rowOfPane(focusedPaneId ?? ''))) {
        showHint('窗口宽度不足，无法添加更多分屏');
        return;
      }
    }
    host.onOpenPane(workdir, sessionId, opts);
  }, [canAddPane, canSplitRows, focusedPaneId, hasTwoRows, host, panes, rowOfPane, showHint]);

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
    panes.forEach((pane) => {
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
        e.dataTransfer.setData(PANE_DRAG_MIME, JSON.stringify({ paneId: pane.paneId }));
        try {
          e.dataTransfer.effectAllowed = 'move';
        } catch {
          // jsdom's DataTransfer polyfill exposes a read-only effectAllowed.
        }
      };
      const onDragEnd = () => {
        pressTarget = null;
        clearDragFeedback();
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
  }, [panes, clearDragFeedback]);

  // Records the insertion boundary in a row and places the marker at markerX
  // (viewport coordinates), converted into row-content coordinates.
  const showDropIndicator = useCallback((row: number, boundary: number, markerX: number) => {
    const rowEl = rowRefs.current[row];
    if (!rowEl) return;
    dropBoundary.current = { row, index: boundary };
    const rowRect = rowEl.getBoundingClientRect();
    // Center the 2px bar on the boundary, clamped inside the content box: an
    // absolutely positioned child past the right content edge would extend the
    // row's scrollable overflow, surfacing a horizontal scrollbar and pushing
    // the bar itself out of view.
    const x = markerX - rowRect.left + rowEl.scrollLeft - 1;
    const maxX = rowEl.scrollWidth - 2;
    setDropZone(null);
    setDropIndicator({ row, x: Math.max(0, Math.min(x, maxX)) });
  }, []);

  // In a single-row layout the top/bottom edge bands are drop zones that
  // split the layout into two rows. Returns the zone and updates the overlay,
  // or null (and clears the overlay) when the pointer is mid-row or splitting
  // is impossible.
  const updateEdgeZone = useCallback((e: React.DragEvent, enabled: boolean): DropZone | null => {
    if (!enabled || hasTwoRows) return null;
    const rowEl = rowRefs.current[0];
    if (!rowEl) return null;
    const rect = rowEl.getBoundingClientRect();
    const band = Math.max(48, rect.height * 0.25);
    const zone: DropZone | null = e.clientY < rect.top + band ? 'above' : e.clientY > rect.bottom - band ? 'below' : null;
    if (!zone) {
      setDropZone(null);
      return null;
    }
    if (!canSplitRows()) {
      setDropZone(null);
      showHint('窗口高度不足，无法拆分为两行');
      return null;
    }
    dropBoundary.current = null;
    setDropIndicator(null);
    setDropZone(zone);
    return zone;
  }, [canSplitRows, hasTwoRows, showHint]);

  const handlePaneDragOver = useCallback((e: React.DragEvent, row: number, index: number) => {
    if (!e.dataTransfer.types.includes(PANE_DRAG_MIME)) return;
    e.preventDefault();
    // Splitting the only pane into its own row is a no-op — hide the zone.
    if (updateEdgeZone(e, panes.length > 1)) return;
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {
      // jsdom's DataTransfer polyfill exposes a read-only dropEffect.
    }
    const rowPanes = panes.filter((p) => (p.row === 1 ? 1 : 0) === row);
    const pane = rowPanes[index];
    const paneEl = pane ? paneNodes.current.get(pane.paneId) : undefined;
    if (!paneEl) return;
    const rect = paneEl.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    showDropIndicator(row, before ? index : index + 1, before ? rect.left : rect.right);
  }, [panes, showDropIndicator, updateEdgeZone]);

  const handleSeparatorDragOver = useCallback((e: React.DragEvent, row: number, boundary: number) => {
    if (!e.dataTransfer.types.includes(PANE_DRAG_MIME)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {
      // jsdom's DataTransfer polyfill exposes a read-only dropEffect.
    }
    setDropZone(null);
    showDropIndicator(row, boundary, e.currentTarget.getBoundingClientRect().left);
  }, [showDropIndicator]);

  const handlePaneDrop = useCallback((e: React.DragEvent, row: number) => {
    const raw = e.dataTransfer.getData(PANE_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const zone = dropZone;
    const boundary = dropBoundary.current;
    clearDragFeedback();
    try {
      const { paneId } = JSON.parse(raw);
      if (!paneId) return;
      if (zone) {
        vscode.postMessage({ command: 'desktopMovePane', paneId, newRow: zone });
        return;
      }
      if (!boundary || boundary.row !== row) return;
      const fromRow = rowOfPane(paneId);
      const rowPanes = panes.filter((p) => (p.row === 1 ? 1 : 0) === row);
      let toIndex = boundary.index;
      // The boundary refers to the current row order; after pulling the
      // dragged pane out, boundaries to its right shift one slot left.
      if (fromRow === row) {
        const fromIndex = rowPanes.findIndex((p) => p.paneId === paneId);
        if (toIndex > fromIndex && fromIndex !== -1) toIndex -= 1;
        if (toIndex === fromIndex) return;
      }
      vscode.postMessage({ command: 'desktopMovePane', paneId, toRow: row, toIndex });
    } catch {
      // Not a pane payload — ignore.
    }
  }, [vscode, dropZone, clearDragFeedback, rowOfPane, panes]);

  // Sidebar session drags are handled at row level (pane/separator dragovers
  // ignore the session MIME and let the event bubble up here). The insertion
  // boundary follows the same midpoint rule as pane-header drags: hovering a
  // pane's left half inserts before it, right half after it; gaps between
  // panes snap to that boundary; past the last pane appends at the right end.
  const handleSessionDragOver = useCallback((e: React.DragEvent, row: number) => {
    if (!e.dataTransfer.types.includes(SESSION_DRAG_MIME)) return;
    e.preventDefault();
    if (updateEdgeZone(e, true)) return;
    try {
      e.dataTransfer.dropEffect = 'copy';
    } catch {
      // jsdom's DataTransfer polyfill exposes a read-only dropEffect.
    }
    const rowPanes = panes.filter((p) => (p.row === 1 ? 1 : 0) === row);
    for (let i = 0; i < rowPanes.length; i += 1) {
      const el = paneNodes.current.get(rowPanes[i].paneId);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left) {
        // In the gap before this pane.
        showDropIndicator(row, i, rect.left);
        return;
      }
      if (e.clientX <= rect.right) {
        const before = e.clientX < rect.left + rect.width / 2;
        showDropIndicator(row, before ? i : i + 1, before ? rect.left : rect.right);
        return;
      }
      // Past this pane — keep looking (covers inter-pane gaps).
    }
    const lastEl = paneNodes.current.get(rowPanes[rowPanes.length - 1]?.paneId);
    if (lastEl) showDropIndicator(row, rowPanes.length, lastEl.getBoundingClientRect().right);
  }, [panes, showDropIndicator, updateEdgeZone]);

  const handleSessionDrop = useCallback((e: React.DragEvent, row: number) => {
    const raw = e.dataTransfer.getData(SESSION_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const zone = dropZone;
    const boundary = dropBoundary.current;
    clearDragFeedback();
    try {
      const { workdir, sessionId } = JSON.parse(raw);
      if (!workdir || !sessionId) return;
      if (zone) {
        handleOpenPane(workdir, sessionId, { newRow: zone });
        return;
      }
      handleOpenPane(workdir, sessionId, {
        row: row === 1 ? 1 : 0,
        insertionIndex: boundary && boundary.row === row ? boundary.index : undefined,
      });
    } catch {
      // Not a session payload — ignore.
    }
  }, [dropZone, clearDragFeedback, handleOpenPane]);

  // Clear the indicator/zone when the drag leaves a row entirely.
  const handleRowDragLeave = useCallback((e: React.DragEvent, row: number) => {
    const next = e.relatedTarget;
    if (next instanceof Node && rowRefs.current[row]?.contains(next)) return;
    clearDragFeedback();
  }, [clearDragFeedback]);

  // Sidebar drags end on the sidebar item (no drop on a row) — clear the
  // indicator from anywhere. The pane-header dragend does the same for its
  // own drag; this is the backstop for every source.
  useEffect(() => {
    document.addEventListener('dragend', clearDragFeedback);
    return () => document.removeEventListener('dragend', clearDragFeedback);
  }, [clearDragFeedback]);

  const handleSeparatorMouseDown = useCallback((e: React.MouseEvent, row: number, separatorIndex: number) => {
    e.preventDefault();
    const rowPanes = panes.filter((p) => (p.row === 1 ? 1 : 0) === row);
    const startX = e.clientX;
    const widths = rowPanes.map((pane) => paneNodes.current.get(pane.paneId)?.getBoundingClientRect().width ?? 0);
    const pairTotal = widths[separatorIndex] + widths[separatorIndex + 1];
    setActiveSeparator({ row, index: separatorIndex });
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
      resizePreviewRef.current = { row, widths: next };
      setResizePreview({ row, widths: next });
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setActiveSeparator(null);
      const preview = resizePreviewRef.current;
      resizePreviewRef.current = null;
      setResizePreview(null);
      if (!preview) return;
      const sum = preview.widths.reduce((total, w) => total + w, 0);
      if (sum <= 0) return;
      vscode.postMessage({ command: 'desktopResizePanes', row, widths: preview.widths.map((w) => w / sum) });
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [panes, vscode]);

  // Drag the horizontal separator between the two rows: live pixel preview,
  // final heights reported on mouseup.
  const handleRowSeparatorMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = rowsContainerRef.current;
    const heights = host.rowHeights;
    if (!container || !heights) return;
    const total = container.getBoundingClientRect().height;
    const startY = e.clientY;
    const startTop = heights[0] * total;
    setRowSeparatorActive(true);
    const onMouseMove = (ev: MouseEvent) => {
      const top = Math.max(MIN_ROW_HEIGHT, Math.min(total - MIN_ROW_HEIGHT, startTop + ev.clientY - startY));
      setRowResizePreview([top, total - top]);
    };
    const onMouseUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setRowSeparatorActive(false);
      setRowResizePreview(null);
      const top = Math.max(MIN_ROW_HEIGHT, Math.min(total - MIN_ROW_HEIGHT, startTop + ev.clientY - startY));
      vscode.postMessage({ command: 'desktopResizePaneRows', heights: [top, total - top] });
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [host.rowHeights, vscode]);

  const focusedSessionId = panes.find((p) => p.paneId === focusedPaneId)?.sessionId;
  // Every session shown in a pane is highlighted in the sidebar — the focused
  // one strongly (current), the rest weakly. New-session panes carry no id.
  const visibleSessionIds = panes.map((p) => p.sessionId).filter((id): id is string => id != null);

  const rowStyle = (row: number): React.CSSProperties | undefined => {
    if (!hasTwoRows) return undefined;
    if (rowResizePreview) return { flex: `0 0 ${rowResizePreview[row]}px` };
    const heights = host.rowHeights;
    if (!heights) return undefined;
    return { flex: `0 0 ${heights[row] * 100}%` };
  };

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
        visibleSessionIds={visibleSessionIds}
        onSelectSession={host.onSelectSession}
        onOpenPane={handleOpenPane}
        onDeleteSession={host.onDeleteSession}
      />
      <div className="desktop-pane-rows" ref={rowsContainerRef} data-testid="desktop-pane-rows">
        {paneRows.map((rowPanes, rowIdx) => (
          <React.Fragment key={rowIdx}>
            {rowIdx > 0 && (
              <div
                className={`desktop-row-separator${rowSeparatorActive ? ' desktop-row-separator--active' : ''}`}
                onMouseDown={handleRowSeparatorMouseDown}
                data-testid="desktop-row-separator"
              />
            )}
            <div
              ref={(el) => {
                rowRefs.current[rowIdx] = el;
              }}
              className="desktop-pane-row"
              style={rowStyle(rowIdx)}
              data-testid={rowIdx === 0 ? 'desktop-pane-row' : `desktop-pane-row-${rowIdx}`}
              onDragOver={(e) => handleSessionDragOver(e, rowIdx)}
              onDrop={(e) => handleSessionDrop(e, rowIdx)}
              onDragLeave={(e) => handleRowDragLeave(e, rowIdx)}
            >
              {rowPanes.map((pane, index) => {
                const paneStyle: React.CSSProperties = { minWidth: MIN_PANE_WIDTH };
                if (resizePreview && resizePreview.row === rowIdx && resizePreview.widths[index] != null) {
                  // Live preview while a separator drags (pixel widths).
                  paneStyle.flex = `0 0 ${resizePreview.widths[index]}px`;
                } else if (pane.width != null) {
                  paneStyle.flex = `0 0 ${pane.width * 100}%`;
                }
                return (
                  <React.Fragment key={pane.paneId}>
                    {index > 0 && (
                      <div
                        className={`desktop-pane-separator${activeSeparator?.row === rowIdx && activeSeparator.index === index - 1 ? ' desktop-pane-separator--active' : ''}`}
                        onMouseDown={(e) => handleSeparatorMouseDown(e, rowIdx, index - 1)}
                        onDragOver={(e) => handleSeparatorDragOver(e, rowIdx, index)}
                        onDrop={(e) => handlePaneDrop(e, rowIdx)}
                        data-testid={rowIdx === 0 ? `desktop-pane-separator-${index - 1}` : `desktop-pane-separator-${rowIdx}-${index - 1}`}
                      />
                    )}
                    <div
                      ref={(el) => {
                        if (el) paneNodes.current.set(pane.paneId, el);
                        else paneNodes.current.delete(pane.paneId);
                      }}
                      className={`desktop-pane${pane.paneId === focusedPaneId ? ' desktop-pane--focused' : ''}`}
                      style={paneStyle}
                      onMouseDown={() => handleFocusPane(pane.paneId)}
                      onDragOver={(e) => handlePaneDragOver(e, rowIdx, index)}
                      onDrop={(e) => handlePaneDrop(e, rowIdx)}
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
              {dropIndicator && dropIndicator.row === rowIdx && (
                <div
                  className="desktop-pane-drop-indicator"
                  style={{ left: dropIndicator.x }}
                  data-testid="desktop-pane-drop-indicator"
                />
              )}
            </div>
          </React.Fragment>
        ))}
        {dropZone && (
          <div
            className={`desktop-pane-dropzone desktop-pane-dropzone--${dropZone}`}
            data-testid="desktop-pane-dropzone"
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
