import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { VsCodeApi } from '../types';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { WebLinksAddon } from '@xterm/addon-web-links';
import { isLocalhostUrl } from '../utils/isLocalhostUrl';
import '../styles/TerminalPane.css';

declare global {
  interface Window {
    /** Set by the lazily injected desktop-only terminal chunk (terminal.js). */
    WaveTerminal?: {
      Terminal: typeof XtermTerminal;
      FitAddon: typeof FitAddon;
      WebLinksAddon: typeof WebLinksAddon;
    };
  }
}

const MIN_WIDTH = 320;

/** Singleton loader for the desktop-only xterm chunk. */
let terminalLibPromise: Promise<NonNullable<Window['WaveTerminal']>> | null = null;

function loadTerminalLib(): Promise<NonNullable<Window['WaveTerminal']>> {
  if (window.WaveTerminal) return Promise.resolve(window.WaveTerminal);
  if (terminalLibPromise) return terminalLibPromise;
  terminalLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './terminal.js';
    script.onload = () => {
      if (window.WaveTerminal) resolve(window.WaveTerminal);
      else reject(new Error('terminal chunk 未导出 WaveTerminal'));
    };
    script.onerror = () => reject(new Error('terminal.js 加载失败'));
    document.head.appendChild(script);
  });
  // Allow a later retry (e.g. 重启终端) after a failed load.
  terminalLibPromise.catch(() => {
    terminalLibPromise = null;
  });
  return terminalLibPromise;
}

/** Preload the xterm chunk so the first terminal open skips the fetch+parse. */
export function prefetchTerminalLib(): void {
  loadTerminalLib().catch(() => {});
}

/** Terminal colors follow the app theme via --vscode-* variables. */
const readTerminalTheme = () => {
  const styles = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  const background = pick('--vscode-panel-background', '') || pick('--vscode-editor-background', '#1e1e1e');
  const foreground = pick('--vscode-foreground', '#cccccc');
  return {
    background,
    foreground,
    cursor: pick('--vscode-editorCursor-foreground', foreground),
    selectionBackground: pick('--vscode-editor-selectionBackground', 'rgba(255, 255, 255, 0.25)'),
  };
};

type PaneStatus =
  | { kind: 'loading' }
  | { kind: 'running' }
  | { kind: 'exited'; detail: string };

export interface TerminalPaneProps {
  vscode: VsCodeApi;
  /** Effective cwd of the owning pane's session — a change signal only; the
   * host resolves the actual cwd from paneId. */
  workdir?: string;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
  onClose: () => void;
  /** Split-view pane identity: tags PTY create requests for cwd resolution. */
  paneId?: string;
  /** Hidden panels stay mounted; the PTY survives hiding. */
  visible: boolean;
  /** Session identity change → rebuild (visible) or kill (hidden). */
  sessionId?: string;
  /** Second-row layout: panels pack from the left, so the width drag anchors
   * the (fixed) left edge instead of the right edge. */
  widthFromLeft?: boolean;
  /** Desktop only: route localhost links printed in the terminal into the
   * preview pane, mirroring Message.tsx. Non-localhost links open externally. */
  onOpenPreview?: (url: string) => void;
}

/** Embedded PTY terminal panel: xterm.js frontend + node-pty in the desktop host. */
export const TerminalPane: React.FC<TerminalPaneProps> = ({
  vscode,
  width,
  onWidthChange,
  maxWidth,
  onClose,
  paneId,
  visible,
  sessionId,
  workdir,
  widthFromLeft,
  onOpenPreview,
}) => {
  const [status, setStatus] = useState<PaneStatus>({ kind: 'loading' });
  const asideRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Whether a PTY for this pane is believed alive in the host.
  const liveRef = useRef(false);
  const termId = `term-${paneId ?? 'main'}`;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // The terminal is built once on mount; keep the latest callback so the
  // click handler never sees a stale onOpenPreview closure.
  const onOpenPreviewRef = useRef(onOpenPreview);
  onOpenPreviewRef.current = onOpenPreview;

  const createPty = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    liveRef.current = true;
    setStatus({ kind: 'running' });
    vscode.postMessage({
      command: 'desktopTerminalCreate',
      termId,
      ...(paneId ? { paneId } : {}),
      cols: term.cols,
      rows: term.rows,
    });
  }, [vscode, termId, paneId]);

  const killPty = useCallback(() => {
    if (!liveRef.current) return;
    liveRef.current = false;
    vscode.postMessage({ command: 'desktopTerminalKill', termId });
  }, [vscode, termId]);

  // Bump to re-run the mount flow (chunk-load failure retry).
  const [bootNonce, setBootNonce] = useState(0);

  const restart = useCallback(() => {
    if (!termRef.current) {
      // The terminal was never built (chunk load failed) — re-run the mount
      // flow, which retries loadTerminalLib (its failure cache self-clears).
      setStatus({ kind: 'loading' });
      setBootNonce((n) => n + 1);
      return;
    }
    killPty();
    termRef.current.reset();
    createPty();
  }, [killPty, createPty]);

  // Mount: load the xterm chunk, build the terminal, wire IO. Unmount does
  // NOT kill the PTY — the host owns its lifecycle (pane close, session
  // switch, app quit) — so a pane moved across rows remounts this component
  // and reattaches to the live PTY (host replays the scrollback buffer).
  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.command === 'desktopTerminalData' && msg.termId === termId) {
        termRef.current?.write(msg.data);
      } else if (msg?.command === 'desktopTerminalExit' && msg.termId === termId) {
        liveRef.current = false;
        setStatus({
          kind: 'exited',
          detail: msg.error ?? `进程已退出（退出码 ${msg.exitCode ?? '未知'}）`,
        });
      } else if (msg?.command === 'desktopThemeChange') {
        // Follow the app theme live.
        if (termRef.current) termRef.current.options.theme = readTerminalTheme();
      }
    };
    window.addEventListener('message', onMessage);

    loadTerminalLib()
      .then((lib) => {
        if (disposed || !containerRef.current) return;
        const term = new lib.Terminal({
          fontFamily:
            getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-font-family').trim() ||
            'Menlo, Monaco, "Courier New", monospace',
          fontSize: 12,
          cursorBlink: true,
          theme: readTerminalTheme(),
        });
        const fit = new lib.FitAddon();
        term.loadAddon(fit);
        // Detect plain-text URLs in the output and route clicks the same way
        // Message.tsx does: localhost → preview pane, everything else → the
        // system browser. The handler reads the ref so a changed callback
        // (e.g. after a session switch) is picked up without rebuilding.
        const links = new lib.WebLinksAddon((_event, uri) => {
          if (isLocalhostUrl(uri) && onOpenPreviewRef.current) {
            onOpenPreviewRef.current(uri);
          } else {
            vscode.postMessage({ command: 'openExternal', url: uri });
          }
        });
        term.loadAddon(links);
        term.open(containerRef.current);
        termRef.current = term;
        fitRef.current = fit;
        term.onData((data) => {
          vscode.postMessage({ command: 'desktopTerminalInput', termId, data });
        });
        resizeObserver = new ResizeObserver(() => {
          const el = containerRef.current;
          // Hidden (display:none) panels report zero size; fitting then would
          // collapse the PTY to 0×0. The observer fires again on re-show.
          if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
          fit.fit();
          if (liveRef.current) {
            vscode.postMessage({
              command: 'desktopTerminalResize',
              termId,
              cols: term.cols,
              rows: term.rows,
            });
          }
        });
        resizeObserver.observe(containerRef.current);
        fit.fit();
        if (visibleRef.current) {
          createPty();
          // 首次打开走这条路径（chunk 异步加载完成后才建终端）——聚焦，
          // 对齐 VS Code 打开终端面板的行为。
          term.focus();
        }
      })
      .catch((err) => {
        if (!disposed) {
          setStatus({ kind: 'exited', detail: err instanceof Error ? err.message : String(err) });
        }
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      window.removeEventListener('message', onMessage);
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootNonce]);

  // Visibility / session-context changes. A hidden terminal is kept
  // alive; a session switch kills it (rebuilt with the new cwd if visible).
  const prevRef = useRef({ visible, sessionId, workdir });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { visible, sessionId, workdir };
    const becameVisible = visible && !prev.visible;
    const contextChanged = prev.sessionId !== sessionId || prev.workdir !== workdir;
    if (contextChanged) {
      killPty();
      if (visible) createPty();
    } else if (becameVisible) {
      // 用户主动打开终端面板（勾选/快捷键）——聚焦终端，对齐 VS Code 行为。
      if (!liveRef.current) createPty();
      termRef.current?.focus();
    }
  }, [visible, sessionId, workdir, killPty, createPty]);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = widthFromLeft ? ev.clientX - (rect?.left ?? 0) : (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <aside ref={asideRef} className="preview-pane terminal-pane" style={{ width }} data-testid="terminal-pane">
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          <span className="preview-pane-url">终端</span>
          <button
            className="preview-pane-button"
            title="重启终端"
            data-testid="terminal-restart"
            onClick={restart}
          >
            <i className="codicon codicon-debug-restart" />
          </button>
          <button
            className="preview-pane-button"
            title="关闭"
            data-testid="terminal-close"
            onClick={onClose}
          >
            <i className="codicon codicon-close" />
          </button>
        </div>
        <div className="terminal-pane-body" ref={containerRef} data-testid="terminal-body">
          {status.kind === 'loading' && (
            <div className="desktop-panel-placeholder">终端加载中…</div>
          )}
          {status.kind === 'exited' && (
            <div className="desktop-panel-placeholder terminal-pane-exited">
              <span>{status.detail}</span>
              <button className="preview-pane-button" data-testid="terminal-retry" onClick={restart}>
                重启终端
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default TerminalPane;
