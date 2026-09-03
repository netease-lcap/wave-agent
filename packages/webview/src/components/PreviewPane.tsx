import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VsCodeApi } from "../types";
import {
  InspectorCursorIcon,
  OpenBrowserIcon,
  RefreshIcon,
} from "./HeaderIcons";
import { PanelKindIcon } from "./PanelKindIcon";

/**
 * Desktop-only preview pane: renders localhost dev servers in a sandboxed
 * <webview> next to the chat, with an element picker whose comments are
 * appended to the chat input so several can be edited and sent together.
 *
 * Single-window preview (设计定稿：去掉预览内浏览器标签条): the pane holds one
 * guest window with no internal tab bar — the parent feeds a URL via the `url`
 * prop (localhost link click / forward established) and the pane navigates its
 * single guest, or the user types into the address bar. The parent's own
 * panel tabs (一级 tab) handle window management, so this pane never
 * accumulates multiple pages.
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
  /** Bypass the HTTP cache entirely — the refresh button uses this so a dev
   * server's stale cache headers can't hide the latest build. */
  reloadIgnoringCache(): void;
  getURL(): string;
  setZoomFactor(factor: number): void;
  getZoomFactor(): number;
  executeJavaScript<T>(code: string): Promise<T>;
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
  const location = [
    msg.summary ? `\`${msg.summary}\`` : "",
    msg.text ? `「${msg.text}」` : "",
  ]
    .filter(Boolean)
    .join("");
  const lines = [
    `**预览评论** · ${msg.url ?? ""}`,
    `${location} · \`${msg.selector ?? ""}\``,
    "",
    msg.comment ?? "",
  ];
  return lines.join("\n");
}

/**
 * Rewrite a picker comment's URL from the forwarded address the guest is
 * actually showing back to the original address the user cares about (scenario
 * 17). The guest loads `http://127.0.0.1:<localPort>/path` for a tunnel
 * forwarding `http://localhost:<remotePort>/path`; comments must record the
 * latter so they read naturally in the chat and stay valid after the tunnel
 * dies. Only the origin is remapped — path/search/hash pass through unchanged,
 * and any URL that isn't on the forwarded origin is returned untouched.
 */
export function rewriteCommentUrl(
  commentUrl: string,
  forwardedBase: string,
  originalBase: string,
): string {
  try {
    const fwd = new URL(forwardedBase);
    const orig = new URL(originalBase);
    const comment = new URL(commentUrl);
    if (comment.origin !== fwd.origin) return commentUrl;
    return `${orig.protocol}//${orig.host}${comment.pathname}${comment.search}${comment.hash}`;
  } catch {
    return commentUrl;
  }
}

const MIN_WIDTH = 320;

/**
 * Overflow auto-fit (spec desktop-app.md「localhost 原型预览」scenario 7, aligned
 * with Claude Desktop's browser pane): when the guest page is wider than the
 * panel and offers no horizontal scroll of its own, scale the whole page down
 * so the overflowing part stays visible and clickable instead of being clipped.
 * Only shrink — a page that already fits is never zoomed above 100%.
 */
const MIN_FIT_ZOOM = 0.3;
// scrollWidth of <html> alone misses pages that clip on <body> itself
// (overflow-x: hidden admin layouts) — the body then becomes the scroll
// container and its own scrollWidth still reports the full content width.
// Only the width is read: the guest's clientWidth can lag behind a resize
// (its layout viewport resizes asynchronously), while the overflowing
// content's natural width is stable at any zoom.
const FIT_MEASURE_JS =
  "(() => Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0))()";
const clampFitZoom = (z: number): number =>
  Math.max(MIN_FIT_ZOOM, Math.min(1, z));

/** Colors the guest picker can't read cross-origin — sampled from the host theme. */
const readPalette = (): Record<string, string> => {
  const styles = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: pick("--vscode-button-background", "#0e639c"),
    accentForeground: pick("--vscode-button-foreground", "#ffffff"),
    foreground: pick("--vscode-foreground", "#cccccc"),
    background:
      pick("--vscode-panel-background", "") ||
      pick("--vscode-editor-background", "#1e1e1e"),
    border: pick("--vscode-panel-border", "rgba(128, 128, 128, 0.35)"),
    inputBackground: pick("--vscode-input-background", "#3c3c3c"),
    inputForeground: pick("--vscode-input-foreground", "#cccccc"),
  };
};

/** Address-bar input → loadable URL: bare hostnames get http://. */
const normalizeUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // "localhost:5173" reads like a scheme to the generic regex — a colon
  // followed by digits is a port, not a scheme, so those stay bare-host.
  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:\d/.test(trimmed)
  ) {
    return trimmed;
  }
  return `http://${trimmed}`;
};

export interface PreviewPaneProps {
  url: string;
  vscode: VsCodeApi;
  /** Controlled width (px); the parent enforces the conversation-area minimum. */
  width: number;
  onWidthChange: (width: number) => void;
  /** Upper bound so the conversation area keeps its minimum width. */
  maxWidth: number;
  /** Receives a formatted picker comment; appended to this pane's chat input. */
  onAddComment?: (text: string) => void;
  /** Remote sessions: the original (pre-forward) URL the pane is showing; picker
   * comments are rewritten back to it (scenario 17). Undefined for local URLs. */
  originalUrl?: string;
  /** Remote sessions: re-establish the port forward on error retry (scenario
   * 16). Undefined for local URLs, where the retry reloads the guest instead. */
  onRetry?: () => void;
  /** Kept for parent API compatibility — single-window preview has no tab
   * bar and no close button of its own (关闭统一由一级 tab 控制), so this
   * never fires. */
  onLastTabClosed?: () => void;
  /** The guest page's title (webview page-title-updated) — the parent shows
   * it on the panel tab like a regular browser tab. */
  onTitleChange?: (title: string) => void;
  /** The URL the guest actually shows after a navigation (address-bar commit
   * that succeeded, or in-guest navigation). The parent persists it on the
   * preview tab so a session switch / remount restores the same page instead
   * of falling back to the originally-requested URL. */
  onNavigate?: (url: string) => void;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({
  url,
  vscode,
  width,
  onWidthChange,
  maxWidth,
  onAddComment,
  originalUrl,
  onRetry,
  onTitleChange,
  onNavigate,
}) => {
  // URL the address bar shows — "" while empty (blank pane awaiting an
  // address); follows in-guest navigation via did-navigate.
  const [displayUrl, setDisplayUrl] = useState(url);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addressEditing, setAddressEditing] = useState(false);
  const [editingUrl, setEditingUrl] = useState("");
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
  // Same ref pattern for the tab title callback: the page-title-updated
  // handler runs long after the []-deps wiring effect captured its closures.
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  // Same again for the navigate callback (did-navigate / address-bar commits).
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  // The last address a did-navigate event actually confirmed the guest on.
  // Null until the first navigation: the [url] effect must still drive the
  // initial load (or a restored one after remount). Once set, an incoming
  // `url` prop equal to it is our own report echoing back through the parent's
  // tab state — reloading the identical page would be a wasteful double load.
  const lastShownUrlRef = useRef<string | null>(null);
  // Prop mirrors for the []-deps wiring effect below: the ipc handler runs
  // long after the effect captured its closures, so it reads current values
  // from refs (same pattern as onAddCommentRef).
  const urlPropRef = useRef(url);
  urlPropRef.current = url;
  const originalUrlRef = useRef(originalUrl);
  originalUrlRef.current = originalUrl;
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  // Overflow auto-fit: guest content width (CSS px) remembered while zoomed
  // out, so a wider panel can zoom back in without re-measuring it.
  const fitContentWidthRef = useRef<number | null>(null);
  // Generation guard: a newer pass (reload / resize) invalidates the in-flight
  // one so two passes can't fight over the zoom factor.
  const fitGenRef = useRef(0);

  // Fallback width for the fit pass when the element reports no size (jsdom /
  // first paint) — mirror of the controlled `width` prop.
  const widthRef = useRef(width);
  widthRef.current = width;

  /** Actual host-side panel width for the fit pass. The controlled `width` prop
   * equals the CSS width, EXCEPT when preview fullscreen stretches the pane via
   * CSS (`width: 100% !important`) or a hidden tab is shown again — the prop is
   * unchanged while the pane really is far wider. Measuring the element keeps
   * the fit honest: fullscreen re-fits the page to the full width instead of
   * keeping a zoom computed for the pre-fullscreen narrow panel. Falls back to
   * the prop when the element reports no size. Stable ([] deps) so the wiring /
   * resize effects that read it never re-run on width changes. */
  const measurePanelWidth = useCallback((): number => {
    const el = asideRef.current;
    if (!el) return widthRef.current;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 ? rect.width : widthRef.current;
  }, []);

  /** One auto-fit pass: measure the guest's content width and set the zoom so
   * it fits the panel. The viewport width comes from the HOST's panel width,
   * not the guest's clientWidth — the guest layout viewport resizes
   * asynchronously and can be stale mid-drag, while the overflowing content's
   * natural width is stable at any zoom. */
  const runFitPass = useCallback(
    async (panelWidth: number, initialDelay = 0) => {
      const wv = webviewRef.current;
      if (!wv || !domReadyRef.current || panelWidth <= 0) return;
      const gen = ++fitGenRef.current;
      for (let i = 0; i < 4; i++) {
        // First round waits for the initial paint; later rounds let the layout
        // settle after a zoom change (media queries may change the width need).
        await new Promise((r) => setTimeout(r, i === 0 ? initialDelay : 180));
        if (gen !== fitGenRef.current || !domReadyRef.current) return;
        let sw: number;
        try {
          sw = await wv.executeJavaScript<number>(FIT_MEASURE_JS);
        } catch {
          return; // guest torn down mid-pass
        }
        if (gen !== fitGenRef.current || !domReadyRef.current || sw <= 0)
          return;
        const z = wv.getZoomFactor();
        const viewport = panelWidth / z;
        let next: number;
        if (sw > viewport + 1) {
          // Content needs more width than the viewport: scale down to fit.
          next = clampFitZoom(panelWidth / sw);
          fitContentWidthRef.current = sw;
        } else if (fitContentWidthRef.current !== null) {
          // Content fits: zoom back in toward the remembered natural width.
          next = clampFitZoom(panelWidth / fitContentWidthRef.current);
          if (next >= 1) fitContentWidthRef.current = null;
        } else {
          break; // fluid page already at its natural zoom — nothing to do
        }
        if (Math.abs(next - z) <= 0.004) break; // converged / at the floor
        wv.setZoomFactor(next);
      }
    },
    [],
  );

  // Focus the address bar while editing / on a blank pane.
  useEffect(() => {
    if (addressEditing || !displayUrl) addressInputRef.current?.focus();
  }, [addressEditing, displayUrl]);

  const sendPicker = useCallback((action: "activate" | "deactivate") => {
    const wv = webviewRef.current;
    if (!wv || !domReadyRef.current) return;
    wv.send(
      "wave-picker",
      action === "activate" ? { action, palette: readPalette() } : { action },
    );
  }, []);

  const deactivatePicker = useCallback(() => {
    pickerActiveRef.current = false;
    setPickerActive(false);
    sendPicker("deactivate");
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
      if (pickerActiveRef.current) sendPicker("activate");
    };
    const onDidNavigate = (e: Event) => {
      const navUrl = (e as { url?: string }).url;
      if (navUrl) {
        currentUrlRef.current = navUrl;
        lastShownUrlRef.current = navUrl;
        setDisplayUrl(navUrl);
        // The parent records where this session's preview actually is, so a
        // session switch / remount restores the same page.
        onNavigateRef.current?.(navUrl);
      }
      setLoadError(null);
      // Fresh document → guest preload restarts inactive.
      pickerReadyRef.current = false;
      pickerActiveRef.current = false;
      setPickerActive(false);
      setPickerUnsupported(false);
      // Fresh document → any fit zoom is stale: back to 100% and let the fit
      // pass after did-finish-load re-shrink if the new page overflows.
      fitContentWidthRef.current = null;
      fitGenRef.current++; // invalidate an in-flight pass
      try {
        wv.setZoomFactor(1);
      } catch {
        /* guest not attached yet */
      }
    };
    const onDidFinishLoad = () => {
      // 200ms: give the initial paint a chance before measuring (SPAs render
      // after load; the pass re-measures anyway). The width is measured, not
      // read from the prop — a guest finishing load while fullscreen (CSS
      // stretched) must fit the real width or it comes up shrunk.
      void runFitPass(measurePanelWidth(), 200);
    };
    const onDidNavigateInPage = (e: Event) => {
      const navUrl = (e as { url?: string }).url;
      if (navUrl) {
        currentUrlRef.current = navUrl;
        lastShownUrlRef.current = navUrl;
        setDisplayUrl(navUrl);
        onNavigateRef.current?.(navUrl);
      }
      // SPA navigation keeps the SAME preload alive — tell it to stand down.
      deactivatePicker();
    };
    const onPageTitleUpdated = (e: Event) => {
      const title = (e as { title?: string }).title;
      if (title) onTitleChangeRef.current?.(title);
    };
    const onDidFailLoad = (e: Event) => {
      const detail = e as {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      if (detail.isMainFrame === false) return;
      if (detail.errorCode === -3) return; // ERR_ABORTED: superseded by a newer load
      setLoadError(detail.errorDescription || "ERR_FAILED");
    };
    const onIpcMessage = (e: Event) => {
      const { channel, args } = e as unknown as {
        channel: string;
        args: PreviewComment[];
      };
      if (channel !== "wave-picker") return;
      const msg = args?.[0];
      if (msg?.type === "ready") {
        pickerReadyRef.current = true;
        return;
      }
      if (msg?.type === "submit" && msg.comment) {
        // Append to the chat input instead of sending: the user batches
        // several element comments and sends them together. The picker
        // stays active for the next pick. The guest reports its actual
        // (forwarded) address — rewrite back to the original for remote
        // tunnels so the comment records the URL the user clicked (scenario
        // 17); local previews pass through unchanged.
        const originalBase = originalUrlRef.current;
        const rewritten = originalBase
          ? rewriteCommentUrl(msg.url ?? "", urlPropRef.current, originalBase)
          : (msg.url ?? "");
        onAddCommentRef.current?.(
          formatPreviewComment({ ...msg, url: rewritten }),
        );
      }
    };

    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigateInPage);
    wv.addEventListener("did-fail-load", onDidFailLoad);
    wv.addEventListener("did-finish-load", onDidFinishLoad);
    wv.addEventListener("ipc-message", onIpcMessage);
    wv.addEventListener("page-title-updated", onPageTitleUpdated);
    return () => {
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigateInPage);
      wv.removeEventListener("did-fail-load", onDidFailLoad);
      wv.removeEventListener("did-finish-load", onDidFinishLoad);
      wv.removeEventListener("ipc-message", onIpcMessage);
      wv.removeEventListener("page-title-updated", onPageTitleUpdated);
    };
    // deactivatePicker/sendPicker/runFitPass/measurePanelWidth are stable
    // useCallbacks, so this still only runs once per mount.
  }, [deactivatePicker, sendPicker, runFitPass, measurePanelWidth]);

  // Panel resized → re-fit (debounced; drag resizes fire this continuously).
  // 250ms after the debounce: the guest's layout viewport also updates
  // asynchronously, so give it a beat before the first measurement. Two
  // triggers converge here: the controlled `width` prop (drag resize) and a
  // ResizeObserver on the pane element (next effect), which also catches sizes
  // the prop can't see — fullscreen stretches the pane via CSS (`!important`,
  // prop unchanged) and tab switches restore a hidden stack (display:none →
  // visible). Both must re-fit, or the guest keeps a zoom computed for the
  // pre-change narrow panel and looks shrunk with empty space around it.
  useEffect(() => {
    if (!domReadyRef.current) return;
    const t = window.setTimeout(
      () => void runFitPass(measurePanelWidth(), 250),
      150,
    );
    return () => window.clearTimeout(t);
  }, [width, runFitPass, measurePanelWidth]);

  // Physical size changes the `width` prop can't report: preview fullscreen
  // widens the pane via CSS only, and switching tabs toggles the containing
  // stack between display:none and visible. Observe the pane element so either
  // re-fits the guest to its actual width.
  useEffect(() => {
    const el = asideRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: number | undefined;
    const ro = new ResizeObserver(() => {
      // The RO fires with 0×0 while the pane sits in a hidden tab stack
      // (display:none). Skipping those is essential: fitting a hidden guest
      // would run against the element's reported 0 width and (via the prop
      // fallback) shrink its zoom for a width it no longer has — the page then
      // comes back shrunk. The pass that matters fires when the tab becomes
      // visible again and the element reports its real width.
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || !domReadyRef.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => void runFitPass(el.getBoundingClientRect().width, 250),
        150,
      );
    });
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [runFitPass]);

  // Parent asked for a URL (localhost link click / forward established /
  // session switch restoring a remembered address): navigate the single window
  // — there is no tab bar to accumulate pages into (一级 tab 承载窗口管理).
  // The effect only reruns when `url` changes, so re-feeding the same URL
  // leaves the guest alone. When the changed `url` is exactly what this pane
  // already confirmed via did-navigate (its own report echoed back through the
  // parent's tab state), it is skipped too — reloading the identical page
  // would flash a wasteful double load.
  useEffect(() => {
    if (!url) return;
    if (url === lastShownUrlRef.current) return;
    currentUrlRef.current = url;
    setDisplayUrl(url);
    setLoadError(null);
    const wv = webviewRef.current;
    if (!wv) return;
    if (domReadyRef.current) {
      void wv.loadURL(url);
    } else {
      // Guest hasn't finished its first load yet — retarget the initial src.
      wv.setAttribute("src", url);
    }
  }, [url]);

  /** Commit the address bar into the single window. */
  const navigateTo = useCallback((target: string) => {
    const finalUrl = normalizeUrl(target);
    if (!finalUrl) return;
    currentUrlRef.current = finalUrl;
    setDisplayUrl(finalUrl);
    setLoadError(null);
    const wv = webviewRef.current;
    if (!wv) return;
    if (domReadyRef.current) {
      void wv.loadURL(finalUrl);
    } else {
      wv.setAttribute("src", finalUrl);
    }
  }, []);

  const startEditing = () => {
    setEditingUrl(displayUrl);
    setAddressEditing(true);
  };
  const commitAddress = () => {
    const target = editingUrl;
    setAddressEditing(false);
    navigateTo(target);
  };
  const cancelAddress = () => {
    setAddressEditing(false);
    setEditingUrl(displayUrl);
  };

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
    sendPicker(next ? "activate" : "deactivate");
  };

  // Transient "picker unsupported" hint.
  useEffect(() => {
    if (!pickerUnsupported) return;
    const timer = setTimeout(() => setPickerUnsupported(false), 3000);
    return () => clearTimeout(timer);
  }, [pickerUnsupported]);

  const handleRefresh = () => {
    setLoadError(null);
    // Force-refresh: plain reload() honors the HTTP cache, which can hide a
    // dev server's latest output behind stale cache headers.
    webviewRef.current?.reloadIgnoringCache();
  };

  const handleOpenExternal = () => {
    vscode.postMessage({ command: "openExternal", url: currentUrlRef.current });
  };

  const asideRef = useRef<HTMLElement | null>(null);
  // Dragging the left edge resizes this panel: the panels to the right keep
  // their widths, so the aside's right edge is fixed for the drag.
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    // Keep the handle lit + cursor locked for the whole drag — :hover and the
    // 6px-only col-resize cursor both flicker as the pointer outruns the handle.
    handle.style.background = "var(--vscode-focusBorder, #007fd4)";
    document.body.classList.add("is-panel-resizing");
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
    };
    const onUp = () => {
      handle.style.background = "";
      document.body.classList.remove("is-panel-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <aside
      ref={asideRef}
      className="preview-pane"
      style={{ width }}
      data-testid="preview-pane"
    >
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          {addressEditing || !displayUrl ? (
            <input
              ref={addressInputRef}
              className="preview-pane-address"
              value={editingUrl}
              onChange={(e) => setEditingUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitAddress();
                else if (e.key === "Escape") cancelAddress();
              }}
              placeholder="输入网址，例如 localhost:5173"
              data-testid="preview-address-input"
            />
          ) : (
            <span
              className="preview-pane-url"
              title={displayUrl}
              onClick={startEditing}
              data-testid="preview-address-display"
            >
              {/* 显示态 = 编辑态胶囊同款纯文字地址（Figma 13438:7439 Header
                  地址胶囊无前置图标，font 14/26 高），点击进入编辑。 */}
              <span className="preview-pane-url-text">{displayUrl}</span>
            </span>
          )}
          <button
            className={`preview-pane-button${pickerActive ? " active" : ""}`}
            title="选择元素并评论"
            aria-pressed={pickerActive}
            data-testid="preview-picker-toggle"
            onClick={togglePicker}
          >
            <InspectorCursorIcon className="preview-pane-icon" />
          </button>
          <button
            className="preview-pane-button"
            title="刷新"
            data-testid="preview-refresh"
            onClick={handleRefresh}
          >
            <RefreshIcon className="preview-pane-icon" />
          </button>
          <button
            className="preview-pane-button"
            title="在浏览器中打开"
            data-testid="preview-open-external"
            onClick={handleOpenExternal}
          >
            <OpenBrowserIcon className="preview-pane-icon" />
          </button>
        </div>
        {pickerUnsupported && (
          <div
            className="preview-pane-hint"
            data-testid="preview-picker-unsupported"
          >
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
          {!displayUrl && (
            <div className="preview-tab-new" data-testid="preview-tab-new">
              <PanelKindIcon
                kind="preview"
                size={28}
                className="preview-tab-new-icon"
              />
              <span>在上方地址栏输入网址开始预览</span>
            </div>
          )}
          {loadError && (
            <div className="preview-pane-error" data-testid="preview-error">
              <span>页面加载失败：{loadError}</span>
              <button
                className="preview-pane-button"
                data-testid="preview-retry"
                onClick={() => {
                  setLoadError(null);
                  (onRetry ?? handleRefresh)();
                }}
              >
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
