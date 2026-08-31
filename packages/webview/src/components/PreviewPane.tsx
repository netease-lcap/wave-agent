import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VsCodeApi } from "../types";

/**
 * Desktop-only preview pane: renders localhost dev servers in a sandboxed
 * <webview> next to the chat, with an element picker whose comments are
 * appended to the chat input so several can be edited and sent together.
 *
 * Multiple tabs (spec desktop-app.md 预览多标签页): each tab carries one
 * preview page; the tab bar scrolls horizontally when it overflows, clicking a
 * tab switches it, closing a tab removes it (the active tab falls back to its
 * left neighbor), and closing the last tab collapses the panel. Tabs are
 * internal state — the parent only feeds new URLs via the `url` prop, which
 * reuses an existing tab with the same URL or appends a new one.
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

/** One preview tab (spec 预览多标签页 scenario 1). */
interface PreviewTab {
  id: string;
  /** URL the guest loads; "" = blank tab awaiting an address. */
  url: string;
  /** URL actually shown in the address bar — follows in-guest navigation. */
  displayUrl: string;
  loadError: string | null;
}

let tabSeq = 0;
const genTabId = (): string => `preview-tab-${++tabSeq}`;

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

/** Tab label: host + non-root path — the panel is narrow, full URLs overflow. */
const shortLabel = (u: string): string => {
  if (!u) return "新标签页";
  try {
    const parsed = new URL(u);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return u;
  }
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
  /** Remote sessions: the original (pre-forward) URL the pane is showing; picker
   * comments are rewritten back to it (scenario 17). Undefined for local URLs. */
  originalUrl?: string;
  /** Remote sessions: re-establish the port forward on error retry (scenario
   * 16). Undefined for local URLs, where the retry reloads the guest instead. */
  onRetry?: () => void;
  /** Closing the LAST tab collapses the panel — the parent resets its preview
   * URL to the empty stub so a later link click reopens cleanly. */
  onLastTabClosed?: () => void;
  /** Fullscreen mode (desktop): the pane fills the content area, the
   * conversation column and other panels are hidden (spec: 预览面板全屏). */
  fullscreen?: boolean;
  /** Toggles fullscreen mode (desktop). */
  onToggleFullscreen?: () => void;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({
  url,
  vscode,
  onClose,
  width,
  onWidthChange,
  maxWidth,
  onAddComment,
  originalUrl,
  onRetry,
  onLastTabClosed,
  fullscreen,
  onToggleFullscreen,
}) => {
  const [tabs, setTabs] = useState<PreviewTab[]>(() =>
    url ? [{ id: genTabId(), url, displayUrl: url, loadError: null }] : [],
  );
  // "" until the mount effect below selects the initial tab — keeps the first
  // render free of the "active tab is null" branch flicker.
  const [activeTabId, setActiveTabId] = useState("");
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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onLastTabClosedRef = useRef(onLastTabClosed);
  onLastTabClosedRef.current = onLastTabClosed;
  // Prop mirrors for the []-deps wiring effect below: the ipc handler runs
  // long after the effect captured its closures, so it reads current values
  // from refs (same pattern as onAddCommentRef).
  const urlPropRef = useRef(url);
  urlPropRef.current = url;
  const originalUrlRef = useRef(originalUrl);
  originalUrlRef.current = originalUrl;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  // (tabId, url) already handed to the guest — dedups tab switches and the
  // same-url reuse in openUrlInTab, like the old single-tab [url] effect.
  const lastLoadedRef = useRef("");
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  // Overflow auto-fit: guest content width (CSS px) remembered while zoomed
  // out, so a wider panel can zoom back in without re-measuring it.
  const fitContentWidthRef = useRef<number | null>(null);
  // Generation guard: a newer pass (reload / resize) invalidates the in-flight
  // one so two passes can't fight over the zoom factor.
  const fitGenRef = useRef(0);
  // Host-side panel width for the did-finish-load pass (the width effect can't
  // see prop changes that happened while the guest was still loading).
  const widthRef = useRef(width);
  widthRef.current = width;

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

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

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

  // Focus the address bar on a blank tab / while editing it.
  useEffect(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    if (addressEditing || !tab?.url) addressInputRef.current?.focus();
  }, [addressEditing, activeTabId]);

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
      const tabId = activeTabIdRef.current;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, displayUrl: navUrl ?? t.displayUrl, loadError: null }
            : t,
        ),
      );
      if (navUrl) currentUrlRef.current = navUrl;
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
      // after load; the pass re-measures anyway).
      void runFitPass(widthRef.current, 200);
    };
    const onDidNavigateInPage = (e: Event) => {
      const navUrl = (e as { url?: string }).url;
      const tabId = activeTabIdRef.current;
      if (navUrl) {
        currentUrlRef.current = navUrl;
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, displayUrl: navUrl } : t)),
        );
      }
      // SPA navigation keeps the SAME preload alive — tell it to stand down.
      deactivatePicker();
    };
    const onDidFailLoad = (e: Event) => {
      const detail = e as {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      if (detail.isMainFrame === false) return;
      if (detail.errorCode === -3) return; // ERR_ABORTED: superseded by a newer load
      const tabId = activeTabIdRef.current;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, loadError: detail.errorDescription || "ERR_FAILED" }
            : t,
        ),
      );
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
    return () => {
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigateInPage);
      wv.removeEventListener("did-fail-load", onDidFailLoad);
      wv.removeEventListener("did-finish-load", onDidFinishLoad);
      wv.removeEventListener("ipc-message", onIpcMessage);
    };
    // deactivatePicker/sendPicker/runFitPass are stable useCallbacks, so this
    // still only runs once per mount.
  }, [deactivatePicker, sendPicker, runFitPass]);

  // Panel resized → re-fit (debounced; drag resizes fire this continuously).
  // 250ms after the debounce: the guest's layout viewport also updates
  // asynchronously, so give it a beat before the first measurement.
  useEffect(() => {
    if (!domReadyRef.current) return;
    const t = window.setTimeout(() => void runFitPass(width, 250), 150);
    return () => window.clearTimeout(t);
  }, [width, runFitPass]);

  // Select the initial tab once mounted (tabs may start empty for a blank pane).
  useEffect(() => {
    if (tabsRef.current.length > 0) {
      setActiveTabId(tabsRef.current[0].id);
    }
  }, []);

  // Parent asked for a URL (localhost link click / forward established): reuse
  // a tab already showing it, else append a new one (spec scenario 1).
  const openUrlInTab = useCallback((target: string) => {
    const existing = tabsRef.current.find((t) => t.url === target);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const tab: PreviewTab = {
      id: genTabId(),
      url: target,
      displayUrl: target,
      loadError: null,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const lastRequestedUrlRef = useRef(url);
  useEffect(() => {
    if (!url || url === lastRequestedUrlRef.current) return;
    lastRequestedUrlRef.current = url;
    openUrlInTab(url);
  }, [url, openUrlInTab]);

  // Load the active tab into the single guest; switching tabs navigates it
  // (no per-tab page state survives, dev-server reloads are cheap).
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || !tab.url) return;
    const key = `${tab.id}:${tab.url}`;
    if (lastLoadedRef.current === key) return;
    lastLoadedRef.current = key;
    const wv = webviewRef.current;
    if (!wv) return;
    currentUrlRef.current = tab.url;
    if (domReadyRef.current) {
      void wv.loadURL(tab.url);
    } else {
      // Guest hasn't finished its first load yet — retarget the initial src.
      wv.setAttribute("src", tab.url);
    }
  }, [activeTabId, tabs]);

  /** Commit the address bar into the active tab (spec scenario 5). */
  const navigateActiveTab = useCallback((target: string) => {
    const finalUrl = normalizeUrl(target);
    if (!finalUrl) return;
    const tabId = activeTabIdRef.current;
    setTabs((prev) => {
      if (!prev.some((t) => t.id === tabId)) {
        // No active tab (edge case): promote the navigation to a new tab.
        const tab: PreviewTab = {
          id: genTabId(),
          url: finalUrl,
          displayUrl: finalUrl,
          loadError: null,
        };
        setActiveTabId(tab.id);
        return [...prev, tab];
      }
      return prev.map((t) =>
        t.id === tabId
          ? { ...t, url: finalUrl, displayUrl: finalUrl, loadError: null }
          : t,
      );
    });
  }, []);

  const addBlankTab = useCallback(() => {
    const tab: PreviewTab = {
      id: genTabId(),
      url: "",
      displayUrl: "",
      loadError: null,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setEditingUrl("");
    setAddressEditing(true);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) {
        // Last tab closed → collapse the panel; the parent resets to the
        // empty stub so a later link click reopens (spec scenario 4).
        onLastTabClosedRef.current?.();
        onCloseRef.current?.();
        return next;
      }
      if (activeTabIdRef.current === tabId) {
        // Closing the selected tab → fall back to its left neighbor.
        const nextActive = next[Math.max(0, idx - 1)];
        setActiveTabId(nextActive.id);
      }
      return next;
    });
  }, []);

  const startEditing = () => {
    const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    setEditingUrl(tab?.displayUrl ?? "");
    setAddressEditing(true);
  };
  const commitAddress = () => {
    const target = editingUrl;
    setAddressEditing(false);
    navigateActiveTab(target);
  };
  const cancelAddress = () => {
    setAddressEditing(false);
    const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    setEditingUrl(tab?.displayUrl ?? "");
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
    const tabId = activeTabIdRef.current;
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, loadError: null } : t)),
    );
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
        <div className="preview-tab-bar" data-testid="preview-tab-bar">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`preview-tab${tab.id === activeTabId ? " active" : ""}`}
              onClick={() => setActiveTabId(tab.id)}
              title={tab.displayUrl || "新标签页"}
              data-testid={`preview-tab-${tab.id}`}
            >
              <span className="preview-tab-label">
                {shortLabel(tab.displayUrl)}
              </span>
              <button
                className="preview-tab-close"
                title="关闭标签页"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                data-testid={`preview-tab-close-${tab.id}`}
              >
                <i className="codicon codicon-close" />
              </button>
            </div>
          ))}
          <button
            className="preview-tab-add"
            title="新建标签页"
            aria-label="新建标签页"
            onClick={addBlankTab}
            data-testid="preview-tab-add"
          >
            <i className="codicon codicon-add" />
          </button>
        </div>
        <div className="preview-pane-toolbar">
          {addressEditing || !activeTab?.url ? (
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
              title={activeTab.displayUrl}
              onClick={startEditing}
              data-testid="preview-address-display"
            >
              {activeTab.displayUrl}
            </span>
          )}
          <button
            className={`preview-pane-button${pickerActive ? " active" : ""}`}
            title="选择元素并评论"
            aria-pressed={pickerActive}
            data-testid="preview-picker-toggle"
            onClick={togglePicker}
          >
            <i className="codicon codicon-inspect" />
          </button>
          <button
            className="preview-pane-button"
            title="刷新"
            data-testid="preview-refresh"
            onClick={handleRefresh}
          >
            <i className="codicon codicon-refresh" />
          </button>
          <button
            className="preview-pane-button"
            title="在浏览器中打开"
            data-testid="preview-open-external"
            onClick={handleOpenExternal}
          >
            <i className="codicon codicon-link-external" />
          </button>
          {onToggleFullscreen && (
            <button
              className="preview-pane-button"
              title={fullscreen ? "退出全屏" : "全屏预览"}
              aria-label={fullscreen ? "退出全屏" : "全屏预览"}
              aria-pressed={fullscreen}
              data-testid="preview-fullscreen"
              onClick={onToggleFullscreen}
            >
              <i
                className={`codicon ${
                  fullscreen ? "codicon-screen-normal" : "codicon-screen-full"
                }`}
              />
            </button>
          )}
          <button
            className="preview-pane-button"
            title="关闭"
            data-testid="preview-close"
            onClick={onClose}
          >
            <i className="codicon codicon-close" />
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
          {activeTab && !activeTab.url && (
            <div className="preview-tab-new" data-testid="preview-tab-new">
              <span className="codicon codicon-globe" />
              <span>在上方地址栏输入网址开始预览</span>
            </div>
          )}
          {activeTab?.loadError && (
            <div className="preview-pane-error" data-testid="preview-error">
              <span>页面加载失败：{activeTab.loadError}</span>
              <button
                className="preview-pane-button"
                data-testid="preview-retry"
                onClick={() => {
                  const tabId = activeTabIdRef.current;
                  setTabs((prev) =>
                    prev.map((t) =>
                      t.id === tabId ? { ...t, loadError: null } : t,
                    ),
                  );
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
