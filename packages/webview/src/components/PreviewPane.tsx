import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { VsCodeApi } from '../types';

/**
 * Desktop-only preview pane: renders a localhost dev server in a
 * sandboxed <webview> next to the chat, with an element picker whose comments
 * are appended to the chat input so several can be edited and sent together.
 *
 * Communication with the picker preload inside the guest:
 *   host → guest : wv.send('wave-picker', { action, palette? })
 *   guest → host : 'ipc-message' DOM event, channel 'wave-picker'
 */

/** The subset of Electron's <webview> DOM API that PreviewPane uses. */
export interface WebviewTagElement extends HTMLElement {
  send(channel: string, ...args: unknown[]): void;
  loadURL(url: string): Promise<void>;
  reload(): void;
  getURL(): string;
}

export interface PreviewComment {
  type?: string;
  url?: string;
  selector?: string;
  summary?: string;
  text?: string;
  comment?: string;
}

/** User-visible markdown for a picker comment — appended to the chat input. */
export function formatPreviewComment(msg: PreviewComment): string {
  const location = [msg.summary ? `\`${msg.summary}\`` : '', msg.text ? `「${msg.text}」` : '']
    .filter(Boolean)
    .join('');
  const lines = [`**预览评论** · ${msg.url ?? ''}`, `${location} · \`${msg.selector ?? ''}\``, '', msg.comment ?? ''];
  return lines.join('\n');
}

const MIN_WIDTH = 320;

/** Colors the guest picker can't read cross-origin — sampled from the host theme. */
const readPalette = (): Record<string, string> => {
  const styles = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: pick('--vscode-button-background', '#0e639c'),
    accentForeground: pick('--vscode-button-foreground', '#ffffff'),
    foreground: pick('--vscode-foreground', '#cccccc'),
    background:
      pick('--vscode-panel-background', '') || pick('--vscode-editor-background', '#1e1e1e'),
    border: pick('--vscode-panel-border', 'rgba(128, 128, 128, 0.35)'),
    inputBackground: pick('--vscode-input-background', '#3c3c3c'),
    inputForeground: pick('--vscode-input-foreground', '#cccccc'),
  };
};

export interface PreviewPaneProps {
  url: string;
  vscode: VsCodeApi;
  onClose: () => void;
  /** Controlled width (px); the parent enforces the conversation-area minimum. */
  width: number;
  onWidthChange: (width: number) => void;
  /** Upper bound so the conversation area keeps its minimum width. */
  maxWidth: number;
  /** Receives a formatted picker comment; appended to this pane's chat input. */
  onAddComment?: (text: string) => void;
  /** Second-row layout: panels pack from the left, so the width drag anchors
   * the (fixed) left edge instead of the right edge. */
  widthFromLeft?: boolean;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({ url, vscode, onClose, width, onWidthChange, maxWidth, onAddComment, widthFromLeft }) => {
  const [displayUrl, setDisplayUrl] = useState(url);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickerActive, setPickerActive] = useState(false);
  const [pickerUnsupported, setPickerUnsupported] = useState(false);
  const webviewRef = useRef<WebviewTagElement | null>(null);
  // URL the guest is currently showing — follows in-guest navigation.
  const currentUrlRef = useRef(url);
  // webview.send() before dom-ready is silently dropped, so gate on it.
  const domReadyRef = useRef(false);
  // Guest preload announces { type: 'ready' }; if it never arrives the page
  // can't host the picker (injection failed).
  const pickerReadyRef = useRef(false);
  const pickerActiveRef = useRef(pickerActive);
  pickerActiveRef.current = pickerActive;
  const onAddCommentRef = useRef(onAddComment);
  onAddCommentRef.current = onAddComment;

  const sendPicker = useCallback((action: 'activate' | 'deactivate') => {
    const wv = webviewRef.current;
    if (!wv || !domReadyRef.current) return;
    wv.send('wave-picker', action === 'activate' ? { action, palette: readPalette() } : { action });
  }, []);

  const deactivatePicker = useCallback(() => {
    pickerActiveRef.current = false;
    setPickerActive(false);
    sendPicker('deactivate');
  }, [sendPicker]);

  // Wire the <webview> once. `src` is set imperatively (never from JSX) so
  // React re-renders can't reload the guest; later navigations use loadURL.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onDomReady = () => {
      domReadyRef.current = true;
      // Manual refresh keeps the picker on: the fresh guest preload starts
      // inactive, so re-send. (Real navigations already reset the toggle.)
      if (pickerActiveRef.current) sendPicker('activate');
    };
    const onDidNavigate = (e: Event) => {
      const navUrl = (e as { url?: string }).url;
      if (navUrl) {
        currentUrlRef.current = navUrl;
        setDisplayUrl(navUrl);
      }
      setLoadError(null);
      // Fresh document → guest preload restarts inactive.
      pickerReadyRef.current = false;
      pickerActiveRef.current = false;
      setPickerActive(false);
      setPickerUnsupported(false);
    };
    const onDidNavigateInPage = (e: Event) => {
      const navUrl = (e as { url?: string }).url;
      if (navUrl) {
        currentUrlRef.current = navUrl;
        setDisplayUrl(navUrl);
      }
      // SPA navigation keeps the SAME preload alive — tell it to stand down.
      deactivatePicker();
    };
    const onDidFailLoad = (e: Event) => {
      const detail = e as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      if (detail.isMainFrame === false) return;
      if (detail.errorCode === -3) return; // ERR_ABORTED: superseded by a newer load
      setLoadError(detail.errorDescription || 'ERR_FAILED');
    };
    const onIpcMessage = (e: Event) => {
      const { channel, args } = e as unknown as { channel: string; args: PreviewComment[] };
      if (channel !== 'wave-picker') return;
      const msg = args?.[0];
      if (msg?.type === 'ready') {
        pickerReadyRef.current = true;
        return;
      }
      if (msg?.type === 'submit' && msg.comment) {
        // Append to the chat input instead of sending: the user batches
        // several element comments and sends them together. The picker
        // stays active for the next pick.
        onAddCommentRef.current?.(formatPreviewComment(msg));
      }
    };

    wv.addEventListener('dom-ready', onDomReady);
    wv.addEventListener('did-navigate', onDidNavigate);
    wv.addEventListener('did-navigate-in-page', onDidNavigateInPage);
    wv.addEventListener('did-fail-load', onDidFailLoad);
    wv.addEventListener('ipc-message', onIpcMessage);
    wv.setAttribute('src', url);
    return () => {
      wv.removeEventListener('dom-ready', onDomReady);
      wv.removeEventListener('did-navigate', onDidNavigate);
      wv.removeEventListener('did-navigate-in-page', onDidNavigateInPage);
      wv.removeEventListener('did-fail-load', onDidFailLoad);
      wv.removeEventListener('ipc-message', onIpcMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigate when a different localhost link is clicked while the panel is open.
  const lastUrlRef = useRef(url);
  useEffect(() => {
    if (url === lastUrlRef.current) return;
    lastUrlRef.current = url;
    currentUrlRef.current = url;
    setDisplayUrl(url);
    setLoadError(null);
    const wv = webviewRef.current;
    if (!wv) return;
    if (domReadyRef.current) {
      void wv.loadURL(url);
    } else {
      // Guest hasn't finished its first load yet — retarget the initial src.
      wv.setAttribute('src', url);
    }
  }, [url]);

  const togglePicker = () => {
    const next = !pickerActiveRef.current;
    if (next && (!domReadyRef.current || !pickerReadyRef.current)) {
      // Guest preload never announced itself — injection failed.
      setPickerUnsupported(true);
      return;
    }
    setPickerUnsupported(false);
    pickerActiveRef.current = next;
    setPickerActive(next);
    sendPicker(next ? 'activate' : 'deactivate');
  };

  // Transient "picker unsupported" hint.
  useEffect(() => {
    if (!pickerUnsupported) return;
    const timer = setTimeout(() => setPickerUnsupported(false), 3000);
    return () => clearTimeout(timer);
  }, [pickerUnsupported]);

  const handleRefresh = () => {
    setLoadError(null);
    webviewRef.current?.reload();
  };

  const handleOpenExternal = () => {
    vscode.postMessage({ command: 'openExternal', url: currentUrlRef.current });
  };

  const asideRef = useRef<HTMLElement | null>(null);
  // Dragging the left edge resizes this panel. In the first row the panels to
  // the right keep their widths, so the aside's right edge is fixed for the
  // drag; in the second row the left edge is fixed instead.
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    // Keep the handle lit + cursor locked for the whole drag — :hover and the
    // 6px-only col-resize cursor both flicker as the pointer outruns the handle.
    handle.style.background = 'var(--vscode-focusBorder, #007fd4)';
    document.body.classList.add('is-panel-resizing');
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = widthFromLeft ? ev.clientX - (rect?.left ?? 0) : (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
    };
    const onUp = () => {
      handle.style.background = '';
      document.body.classList.remove('is-panel-resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <aside ref={asideRef} className="preview-pane" style={{ width }} data-testid="preview-pane">
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          <span className="preview-pane-url" title={displayUrl}>{displayUrl}</span>
          <button
            className={`preview-pane-button${pickerActive ? ' active' : ''}`}
            title="选择元素并评论"
            aria-pressed={pickerActive}
            data-testid="preview-picker-toggle"
            onClick={togglePicker}
          >
            <i className="codicon codicon-inspect" />
          </button>
          <button className="preview-pane-button" title="刷新" data-testid="preview-refresh" onClick={handleRefresh}>
            <i className="codicon codicon-refresh" />
          </button>
          <button className="preview-pane-button" title="在浏览器中打开" data-testid="preview-open-external" onClick={handleOpenExternal}>
            <i className="codicon codicon-link-external" />
          </button>
          <button className="preview-pane-button" title="关闭" data-testid="preview-close" onClick={onClose}>
            <i className="codicon codicon-close" />
          </button>
        </div>
        {pickerUnsupported && (
          <div className="preview-pane-hint" data-testid="preview-picker-unsupported">
            该页面暂不支持元素拾取
          </div>
        )}
        <div className="preview-pane-body">
          <webview
            ref={webviewRef}
            className="preview-pane-webview"
            preload={window.wavePickerPreloadPath}
            webpreferences="sandbox=yes, contextIsolation=yes"
          />
          {loadError && (
            <div className="preview-pane-error" data-testid="preview-error">
              <span>页面加载失败：{loadError}</span>
              <button className="preview-pane-button" data-testid="preview-retry" onClick={handleRefresh}>
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default PreviewPane;
