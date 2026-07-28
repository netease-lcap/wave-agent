import React, { useCallback, useRef, useState } from 'react';
import { ChatApp } from './ChatApp';
import { DesktopSidebar } from './DesktopSidebar';
import type { DesktopHostProps, DesktopPane, VsCodeApi } from '../types';
import '../styles/DesktopApp.css';

const MIN_PANE_WIDTH = 360;
const HINT_DURATION_MS = 2400;

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
 * Desktop split-view layout (FR-032~036): sidebar on the left, N chat panes in
 * the middle, preview pane (owned by the single-pane ChatApp) on the right.
 *
 * Rendered when the host pushes ≥1 pane via `desktopPanes`. ChatApp delegates
 * here; for each pane it renders one paneId-scoped ChatApp instance, which
 * filters host pushes by paneId and tags outgoing commands with it.
 *
 * Drag & drop: sidebar session items carry a session payload; dropping anywhere
 * on the pane row appends a new right-hand pane via `desktopOpenPane` — unless
 * adding another pane would squeeze every pane below MIN_PANE_WIDTH.
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
  const [dropActive, setDropActive] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // HTML5 DnD fires dragenter on every child; a counter tracks nesting depth so
  // the highlight only clears when the drag truly leaves the row.
  const dragDepth = useRef(0);

  const showHint = useCallback((text: string) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHint(text);
    hintTimer.current = setTimeout(() => setHint(null), HINT_DURATION_MS);
  }, []);

  const canAddPane = useCallback((): boolean => {
    const rowWidth = rowRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    return rowWidth / (panes.length + 1) >= MIN_PANE_WIDTH;
  }, [panes.length]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-wave-session')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDropActive(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-wave-session')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback(() => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    const raw = e.dataTransfer.getData('application/x-wave-session');
    if (!raw) return;
    try {
      const { workdir, sessionId } = JSON.parse(raw);
      if (!sessionId) return;
      if (!canAddPane()) {
        showHint('窗口宽度不足，无法添加更多分屏');
        return;
      }
      host.onOpenPane(workdir, sessionId);
    } catch {
      // Not a session payload — ignore.
    }
  }, [canAddPane, host, showHint]);

  const handleFocusPane = useCallback((paneId: string) => {
    if (paneId === focusedPaneId) return;
    vscode.postMessage({ command: 'desktopFocusPane', paneId });
  }, [focusedPaneId, vscode]);

  const handleClosePane = useCallback((paneId: string) => {
    vscode.postMessage({ command: 'desktopClosePane', paneId });
  }, [vscode]);

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
        currentWorkdir={host.workdir}
        currentSessionId={focusedSessionId}
        onSelectSession={host.onSelectSession}
        onDeleteSession={host.onDeleteSession}
      />
      <div
        ref={rowRef}
        className={`desktop-pane-row${dropActive ? ' desktop-pane-row--drop' : ''}`}
        data-testid="desktop-pane-row"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {panes.map((pane) => (
          <div
            key={pane.paneId}
            className={`desktop-pane${pane.paneId === focusedPaneId ? ' desktop-pane--focused' : ''}`}
            style={{ minWidth: MIN_PANE_WIDTH }}
            onMouseDown={() => handleFocusPane(pane.paneId)}
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
        ))}
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
