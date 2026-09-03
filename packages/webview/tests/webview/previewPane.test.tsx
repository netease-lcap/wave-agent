import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import React from "react";
import {
  PreviewPane,
  formatPreviewComment,
  rewriteCommentUrl,
} from "../../src/components/PreviewPane";
import type { WebviewTagElement } from "../../src/components/PreviewPane";
import { DesktopApp } from "../../src/components/DesktopApp";
import { convertToMarkdown } from "../../src/utils/messageUtils";
import { createMockVscode, sendCommand } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

// Multi-instance tabs can render several preview panes at once. Find the one
// belonging to the ACTIVE tab — the only visible .desktop-panel-stack.
const activePane = (testId: string) =>
  screen
    .getAllByTestId(testId)
    .find(
      (p) =>
        (p.closest(".desktop-panel-stack") as HTMLElement | null)?.style
          .display !== "none",
    );

type MockWebview = Omit<
  WebviewTagElement,
  | "send"
  | "loadURL"
  | "reload"
  | "reloadIgnoringCache"
  | "getURL"
  | "setZoomFactor"
  | "getZoomFactor"
  | "executeJavaScript"
> & {
  send: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  reloadIgnoringCache: ReturnType<typeof vi.fn>;
  getURL: ReturnType<typeof vi.fn>;
  setZoomFactor: ReturnType<typeof vi.fn>;
  getZoomFactor: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
};

function renderPane(options?: {
  url?: string;
  onAddComment?: (text: string) => void;
  originalUrl?: string;
  onRetry?: () => void;
  onLastTabClosed?: () => void;
  onTitleChange?: (title: string) => void;
  onNavigate?: (url: string) => void;
}) {
  const vscode = createMockVscode();
  const url = options?.url ?? "http://localhost:5173/app";
  const onAddComment = options?.onAddComment ?? vi.fn();
  const originalUrl = options?.originalUrl;
  const onRetry = options?.onRetry;
  const onLastTabClosed = options?.onLastTabClosed ?? vi.fn();
  const onTitleChange = options?.onTitleChange ?? vi.fn();
  const onNavigate = options?.onNavigate ?? vi.fn();
  // Controlled-width harness: PreviewPane no longer owns its width state.
  // `width` prop on rerender overrides the internal state so tests can drive
  // panel resizes without going through the drag handle.
  const Harness = ({
    url: u,
    width: wProp,
  }: {
    url: string;
    width?: number;
  }) => {
    const [width, setWidth] = React.useState(420);
    return (
      <PreviewPane
        url={u}
        vscode={vscode}
        width={wProp ?? width}
        onWidthChange={setWidth}
        maxWidth={716}
        onAddComment={onAddComment}
        originalUrl={originalUrl}
        onRetry={onRetry}
        onLastTabClosed={onLastTabClosed}
        onTitleChange={onTitleChange}
        onNavigate={onNavigate}
      />
    );
  };
  const result = render(<Harness url={url} />);
  const wv = result.container.querySelector(
    "webview",
  ) as unknown as MockWebview;
  wv.send = vi.fn();
  wv.loadURL = vi.fn().mockResolvedValue(undefined);
  wv.reload = vi.fn();
  wv.reloadIgnoringCache = vi.fn();
  wv.getURL = vi.fn(() => url);
  wv.setZoomFactor = vi.fn();
  wv.getZoomFactor = vi.fn(() => 1);
  wv.executeJavaScript = vi.fn(async () => 0);
  const rerenderWithUrl = (u: string, width?: number) =>
    result.rerender(<Harness url={u} width={width} />);
  return {
    ...result,
    rerenderWithUrl,
    vscode,
    wv,
    url,
    onAddComment,
    onLastTabClosed,
    onTitleChange,
    onNavigate,
  };
}

const fireDomReady = (wv: MockWebview) => fireEvent(wv, new Event("dom-ready"));
const firePickerReady = (wv: MockWebview) =>
  fireEvent(
    wv,
    Object.assign(new Event("ipc-message"), {
      channel: "wave-picker",
      args: [{ type: "ready" }],
    }),
  );
const fireDidNavigate = (wv: MockWebview, url: string) =>
  fireEvent(wv, Object.assign(new Event("did-navigate"), { url }));
const fireInPageNavigate = (wv: MockWebview, url: string) =>
  fireEvent(wv, Object.assign(new Event("did-navigate-in-page"), { url }));
const fireDidFinishLoad = (wv: MockWebview) =>
  fireEvent(wv, new Event("did-finish-load"));

/** Stub the guest metric APIs for the overflow auto-fit: the guest reports a
 * fixed `contentWidth` (the natural width of an overflowing document — stable
 * at any zoom, which is exactly what the fit pass relies on); the zoom is
 * mutable so consecutive fit rounds see the value previous rounds set. */
function mockGuestMetrics(wv: MockWebview, contentWidth: number) {
  let zoom = 1;
  wv.setZoomFactor = vi.fn((f: number) => {
    zoom = f;
  });
  wv.getZoomFactor = vi.fn(() => zoom);
  wv.executeJavaScript = vi.fn(async () => contentWidth);
}
const firePickerSubmit = (wv: MockWebview, payload: Record<string, unknown>) =>
  fireEvent(
    wv,
    Object.assign(new Event("ipc-message"), {
      channel: "wave-picker",
      args: [payload],
    }),
  );

// PreviewPane watches its own element with a ResizeObserver so a CSS-driven
// width change (fullscreen !important / a tab stack turning visible again)
// re-fits the guest — the controlled `width` prop can't see those. jsdom has
// no layout and test-utils' shared RO mock swallows callbacks, so capture the
// instances here and fire size changes manually.
class CapturingResizeObserver {
  static instances: CapturingResizeObserver[] = [];
  static reset() {
    CapturingResizeObserver.instances = [];
  }
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    CapturingResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
function installCapturingResizeObserver(): () => void {
  const previous = globalThis.ResizeObserver;
  CapturingResizeObserver.reset();
  globalThis.ResizeObserver =
    CapturingResizeObserver as unknown as typeof ResizeObserver;
  return () => {
    globalThis.ResizeObserver = previous;
  };
}
const fireResize = () => {
  const all = CapturingResizeObserver.instances;
  const ro = all[all.length - 1];
  if (!ro)
    throw new Error("no ResizeObserver captured — did PreviewPane mount?");
  act(() => {
    ro.callback(
      [] as unknown as ResizeObserverEntry[],
      ro as unknown as ResizeObserver,
    );
  });
};

describe("PreviewPane", () => {
  it("loads the URL into the guest and shows it in the toolbar", () => {
    const { wv, url } = renderPane();
    expect(wv.getAttribute("src")).toBe(url);
    expect(screen.getByText(url)).toBeInTheDocument();
  });

  it("reports the guest page title via page-title-updated (tab 显示页面名称)", () => {
    const { wv, onTitleChange } = renderPane();
    fireDomReady(wv);
    fireEvent(
      wv,
      Object.assign(new Event("page-title-updated"), {
        title: "登录页 · 我的应用",
      }),
    );
    expect(onTitleChange).toHaveBeenCalledWith("登录页 · 我的应用");
  });

  it("toggles the picker: activate sends palette, second click deactivates", () => {
    const { wv } = renderPane();
    fireDomReady(wv);
    firePickerReady(wv);

    fireEvent.click(screen.getByTestId("preview-picker-toggle"));
    expect(wv.send).toHaveBeenCalledWith("wave-picker", {
      action: "activate",
      palette: expect.objectContaining({
        accent: expect.any(String),
        inputBackground: expect.any(String),
      }),
    });
    expect(screen.getByTestId("preview-picker-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId("preview-picker-toggle"));
    expect(wv.send).toHaveBeenLastCalledWith("wave-picker", {
      action: "deactivate",
    });
    expect(screen.getByTestId("preview-picker-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows the unsupported hint when toggling before the guest preload is ready", () => {
    const { wv } = renderPane();
    fireDomReady(wv);
    // ready message never arrives → injection failed
    fireEvent.click(screen.getByTestId("preview-picker-toggle"));
    expect(wv.send).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("preview-picker-unsupported"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("preview-picker-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // recover once ready is received
    firePickerReady(wv);
    fireEvent.click(screen.getByTestId("preview-picker-toggle"));
    expect(wv.send).toHaveBeenCalledWith(
      "wave-picker",
      expect.objectContaining({ action: "activate" }),
    );
    expect(
      screen.queryByTestId("preview-picker-unsupported"),
    ).not.toBeInTheDocument();
  });

  it("does not send picker messages before dom-ready", () => {
    const { wv } = renderPane();
    firePickerReady(wv);
    fireEvent.click(screen.getByTestId("preview-picker-toggle"));
    expect(wv.send).not.toHaveBeenCalled();
  });

  it("full navigation updates the URL and resets the picker", () => {
    const { wv } = renderPane();
    fireDomReady(wv);
    firePickerReady(wv);
    fireEvent.click(screen.getByTestId("preview-picker-toggle"));
    wv.send.mockClear();

    fireDidNavigate(wv, "http://localhost:5173/other");

    expect(screen.getByText("http://localhost:5173/other")).toBeInTheDocument();
    expect(screen.getByTestId("preview-picker-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // Fresh document restarts the preload inactive — no deactivate needed.
    expect(wv.send).not.toHaveBeenCalled();
  });

  it("SPA in-page navigation actively deactivates the still-running preload", () => {
    const { wv } = renderPane();
    fireDomReady(wv);
    firePickerReady(wv);
    fireEvent.click(screen.getByTestId("preview-picker-toggle"));
    wv.send.mockClear();

    fireInPageNavigate(wv, "http://localhost:5173/app#section");

    expect(
      screen.getByText("http://localhost:5173/app#section"),
    ).toBeInTheDocument();
    expect(wv.send).toHaveBeenCalledWith("wave-picker", {
      action: "deactivate",
    });
    expect(screen.getByTestId("preview-picker-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("picker stays on across manual refresh (re-activates after dom-ready)", () => {
    const { wv } = renderPane();
    fireDomReady(wv);
    firePickerReady(wv);
    fireEvent.click(screen.getByTestId("preview-picker-toggle"));
    wv.send.mockClear();

    fireEvent.click(screen.getByTestId("preview-refresh"));
    expect(wv.reloadIgnoringCache).toHaveBeenCalled();
    fireDomReady(wv);
    firePickerReady(wv); // fresh document re-announces ready
    expect(wv.send).toHaveBeenCalledWith(
      "wave-picker",
      expect.objectContaining({ action: "activate" }),
    );
  });

  it("shows an error state with retry on did-fail-load, ignores ERR_ABORTED (-3)", () => {
    const { wv } = renderPane();
    fireEvent(
      wv,
      Object.assign(new Event("did-fail-load"), {
        errorCode: -3,
        errorDescription: "ERR_ABORTED",
        isMainFrame: true,
      }),
    );
    expect(screen.queryByTestId("preview-error")).not.toBeInTheDocument();

    fireEvent(
      wv,
      Object.assign(new Event("did-fail-load"), {
        errorCode: -105,
        errorDescription: "ERR_NAME_NOT_RESOLVED",
        isMainFrame: true,
      }),
    );
    expect(screen.getByTestId("preview-error")).toHaveTextContent(
      "ERR_NAME_NOT_RESOLVED",
    );

    fireEvent.click(screen.getByTestId("preview-retry"));
    expect(wv.reloadIgnoringCache).toHaveBeenCalled();
    expect(screen.queryByTestId("preview-error")).not.toBeInTheDocument();
  });

  it("open-external posts the CURRENT guest URL (follows in-guest navigation)", () => {
    const { vscode, wv } = renderPane();
    fireDomReady(wv);
    fireDidNavigate(wv, "http://localhost:5173/deep/page");

    fireEvent.click(screen.getByTestId("preview-open-external"));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openExternal",
      url: "http://localhost:5173/deep/page",
    });
  });

  it("navigates via loadURL when a different URL arrives after dom-ready", () => {
    const { wv, rerenderWithUrl } = renderPane();
    fireDomReady(wv);
    rerenderWithUrl("http://localhost:3000/other");
    expect(wv.loadURL).toHaveBeenCalledWith("http://localhost:3000/other");
  });

  it("drag handle resizes within min/max bounds", () => {
    const { container } = renderPane();
    const pane = screen.getByTestId("preview-pane");
    const handle = container.querySelector(
      ".preview-pane-drag-handle",
    ) as HTMLElement;
    // jsdom rects are all-zero; pin the aside's right edge at 1024.
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      right: 1024,
    } as DOMRect);

    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(window, { clientX: 624 }); // 1024 - 624 = 400
    expect(pane).toHaveStyle({ width: "400px" });
    fireEvent.mouseMove(window, { clientX: 950 }); // 74 → clamped to 320
    expect(pane).toHaveStyle({ width: "320px" });
    fireEvent.mouseMove(window, { clientX: 10 }); // 1014 → clamped to maxWidth 716
    expect(pane).toHaveStyle({ width: "716px" });
    fireEvent.mouseUp(window);
  });

  it("picker submit appends a formatted comment via onAddComment and keeps the picker active", () => {
    const { vscode, wv, onAddComment } = renderPane();
    fireDomReady(wv);
    firePickerReady(wv);
    fireEvent.click(screen.getByTestId("preview-picker-toggle"));
    expect(screen.getByTestId("preview-picker-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    firePickerSubmit(wv, {
      type: "submit",
      url: "http://localhost:5173/login",
      selector: "#app > div > button.primary",
      summary: "button.primary",
      text: "立即购买",
      comment: "这个按钮颜色太淡了",
    });

    expect(onAddComment).toHaveBeenCalledWith(
      [
        "**预览评论** · http://localhost:5173/login",
        "`button.primary`「立即购买」 · `#app > div > button.primary`",
        "",
        "这个按钮颜色太淡了",
      ].join("\n"),
    );
    // Nothing is sent to the agent directly — comments batch in the input.
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
    // Picker stays active so the user can keep picking elements.
    expect(screen.getByTestId("preview-picker-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("ignores ipc messages on other channels", () => {
    const { vscode, wv } = renderPane();
    fireDomReady(wv);
    fireEvent(
      wv,
      Object.assign(new Event("ipc-message"), {
        channel: "something-else",
        args: [{ type: "submit", comment: "x" }],
      }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });

  it("rewrites picker comment URLs back to the original address (remote tunnel)", () => {
    const onAddComment = vi.fn();
    const onRetry = vi.fn();
    const { wv } = renderPane({
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
      onRetry,
      onAddComment,
    });
    fireDomReady(wv);
    firePickerReady(wv);
    fireEvent.click(screen.getByTestId("preview-picker-toggle"));

    firePickerSubmit(wv, {
      type: "submit",
      url: "http://127.0.0.1:5173/login?tab=2",
      selector: "#app > button",
      summary: "button",
      text: "登录",
      comment: "按钮间距不对",
    });

    // The comment must reference the remote original URL (localhost:5173),
    // not the local tunnel address — the tunnel dies with the panel.
    expect(onAddComment).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:5173/login?tab=2"),
    );
    expect(onAddComment).not.toHaveBeenCalledWith(
      expect.stringContaining("127.0.0.1"),
    );
  });

  it("error retry re-establishes the forward when onRetry is provided (remote)", () => {
    const onRetry = vi.fn();
    const { wv } = renderPane({
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
      onRetry,
    });
    fireEvent(
      wv,
      Object.assign(new Event("did-fail-load"), {
        errorCode: -105,
        errorDescription: "ERR_NAME_NOT_RESOLVED",
        isMainFrame: true,
      }),
    );
    expect(screen.getByTestId("preview-error")).toHaveTextContent(
      "ERR_NAME_NOT_RESOLVED",
    );

    // Remote: retry means re-acquiring the tunnel (a plain reload would
    // hit the dead tunnel address again).
    fireEvent.click(screen.getByTestId("preview-retry"));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.queryByTestId("preview-error")).not.toBeInTheDocument();
  });

  describe("preview 单窗口（去掉浏览器标签条后的导航语义）", () => {
    it("a new URL from the parent navigates the single window (loadURL + address bar)", () => {
      const { wv, rerenderWithUrl } = renderPane();
      fireDomReady(wv);
      rerenderWithUrl("http://localhost:3000/other");

      expect(wv.loadURL).toHaveBeenCalledWith("http://localhost:3000/other");
      expect(screen.getByTestId("preview-address-display")).toHaveTextContent(
        "http://localhost:3000/other",
      );
      // Single-window: no tab bar, no "+" tab button.
      expect(screen.queryByTestId("preview-tab-bar")).not.toBeInTheDocument();
    });

    it("re-navigating the same URL does not reload the guest", () => {
      const { wv, rerenderWithUrl } = renderPane();
      fireDomReady(wv);
      rerenderWithUrl("http://localhost:3000/other");
      rerenderWithUrl("http://localhost:3000/other");

      expect(wv.loadURL).toHaveBeenCalledTimes(1);
    });

    it("Escape cancels address editing back to the shown URL", () => {
      const { rerenderWithUrl } = renderPane();
      rerenderWithUrl("http://localhost:3000/other");
      fireEvent.click(screen.getByTestId("preview-address-display"));

      const input = screen.getByTestId("preview-address-input");
      expect(input).toHaveValue("http://localhost:3000/other");
      fireEvent.change(input, { target: { value: "localhost:9999" } });
      fireEvent.keyDown(input, { key: "Escape" });

      // Editing abandoned — display restored.
      expect(screen.getByTestId("preview-address-display")).toHaveTextContent(
        "http://localhost:3000/other",
      );
    });

    it("reports a confirmed navigation to the parent (address bar + in-page)", () => {
      const { wv, onNavigate } = renderPane({ url: "" });
      fireDomReady(wv);

      // Address-bar commit navigates the guest…
      const input = screen.getByTestId("preview-address-input");
      fireEvent.change(input, { target: { value: "localhost:3000/other" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(wv.loadURL).toHaveBeenCalledWith("http://localhost:3000/other");

      // …and only once the guest confirms the load does the parent learn the
      // address (a failed load must not overwrite the remembered URL).
      fireDidNavigate(wv, "http://localhost:3000/other");
      expect(onNavigate).toHaveBeenCalledWith("http://localhost:3000/other");

      // SPA (hash/history) navigation is reported too.
      fireInPageNavigate(wv, "http://localhost:3000/other#/section");
      expect(onNavigate).toHaveBeenCalledWith(
        "http://localhost:3000/other#/section",
      );
    });

    it("an echoed navigation (parent persisted the URL back) does not reload the guest", () => {
      const { wv, onNavigate, rerenderWithUrl } = renderPane({ url: "" });
      fireDomReady(wv);
      const input = screen.getByTestId("preview-address-input");
      fireEvent.change(input, { target: { value: "localhost:3000/other" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(wv.loadURL).toHaveBeenCalledTimes(1);

      fireDidNavigate(wv, "http://localhost:3000/other");
      expect(onNavigate).toHaveBeenCalledWith("http://localhost:3000/other");

      // The parent writes the reported URL onto the tab → the `url` prop
      // changes to the address the guest is ALREADY showing. Reloading it
      // again would flash a wasteful double load.
      rerenderWithUrl("http://localhost:3000/other");
      expect(wv.loadURL).toHaveBeenCalledTimes(1);
    });

    it("in-guest SPA navigation echoed back does not reload the guest", () => {
      const { wv, rerenderWithUrl } = renderPane();
      fireDomReady(wv);
      fireInPageNavigate(wv, "http://localhost:5173/app#/section");
      // Parent persisted the #/section URL → prop now carries it.
      rerenderWithUrl("http://localhost:5173/app#/section");

      expect(wv.loadURL).not.toHaveBeenCalled();
      expect(screen.getByTestId("preview-address-display")).toHaveTextContent(
        "http://localhost:5173/app#/section",
      );
    });
  });

  describe("overflow auto-fit (spec scenario 7)", () => {
    it("shrinks the guest when the page is wider than the panel", async () => {
      const { wv } = renderPane();
      // Panel 420, content 1200 → zoom 420/1200 = 0.35; at 0.35 the viewport
      // is 1200 so the re-measure fits and the pass stops.
      mockGuestMetrics(wv, 1200);
      fireDomReady(wv);
      fireDidFinishLoad(wv);

      await vi.waitFor(() =>
        expect(wv.setZoomFactor).toHaveBeenCalledWith(0.35),
      );
      await vi.waitFor(() =>
        expect(wv.executeJavaScript).toHaveBeenCalledTimes(2),
      );
      expect(wv.setZoomFactor.mock.calls).toEqual([[0.35]]);
    });

    it("leaves pages that fit the panel untouched (never zooms above 100%)", async () => {
      const { wv } = renderPane();
      mockGuestMetrics(wv, 420);
      fireDomReady(wv);
      fireDidFinishLoad(wv);

      await vi.waitFor(() =>
        expect(wv.executeJavaScript).toHaveBeenCalledTimes(1),
      );
      expect(wv.setZoomFactor).not.toHaveBeenCalled();
    });

    it("zooms back in when the panel grows wider than the content needs", async () => {
      const { wv, rerenderWithUrl } = renderPane();
      mockGuestMetrics(wv, 1200);
      fireDomReady(wv);
      fireDidFinishLoad(wv);
      // Fit at 420 → zoom 420/1200 = 0.35.
      await vi.waitFor(() =>
        expect(wv.setZoomFactor).toHaveBeenCalledWith(0.35),
      );

      // Panel 840 → viewport 840/0.35 = 2400 > 1200: zoom 840/1200 = 0.7.
      rerenderWithUrl("http://localhost:5173/app", 840);
      await vi.waitFor(() =>
        expect(wv.setZoomFactor).toHaveBeenCalledWith(0.7),
      );

      // Panel 1300 ≥ content 1200 → zoom back to exactly 1.
      rerenderWithUrl("http://localhost:5173/app", 1300);
      await vi.waitFor(() =>
        expect(wv.setZoomFactor).toHaveBeenLastCalledWith(1),
      );
      expect(wv.setZoomFactor.mock.calls.map((c) => c[0])).toEqual([
        0.35, 0.7, 1,
      ]);
    });

    it("resets to 100% on navigation so a page that fits isn't stuck scaled down", async () => {
      const { wv } = renderPane();
      mockGuestMetrics(wv, 1200);
      fireDomReady(wv);
      fireDidFinishLoad(wv);
      await vi.waitFor(() =>
        expect(wv.setZoomFactor).toHaveBeenCalledWith(0.35),
      );

      fireDidNavigate(wv, "http://localhost:5173/other");
      expect(wv.setZoomFactor).toHaveBeenCalledWith(1);
    });

    it("stops shrinking at the 0.3 floor for extremely wide pages", async () => {
      const { wv } = renderPane();
      // 420/10000 = 0.042 → clamped to 0.3; at 0.3 the next candidate is the
      // same clamped value → converged, no further adjustment.
      mockGuestMetrics(wv, 10000);
      fireDomReady(wv);
      fireDidFinishLoad(wv);

      await vi.waitFor(() =>
        expect(wv.setZoomFactor).toHaveBeenCalledWith(0.3),
      );
      await vi.waitFor(() =>
        expect(wv.executeJavaScript).toHaveBeenCalledTimes(2),
      );
      expect(wv.setZoomFactor.mock.calls).toEqual([[0.3]]);
    });

    it("re-fits to the MEASURED pane width when fullscreen stretches it via CSS", async () => {
      // The pane's real width (what the guest fits against) diverges from the
      // controlled `width` prop while fullscreen — CSS widens the element but
      // the prop is unchanged. Regression: the fit must follow the measured
      // element or the guest keeps the zoom computed for the narrow
      // pre-fullscreen panel and looks shrunk in a sea of empty space.
      const restore = installCapturingResizeObserver();
      try {
        const { wv } = renderPane();
        const pane = screen.getByTestId("preview-pane");
        const rect = vi.spyOn(pane, "getBoundingClientRect");
        rect.mockReturnValue({ width: 420 } as DOMRect);
        mockGuestMetrics(wv, 1200);
        fireDomReady(wv);
        fireDidFinishLoad(wv);
        await vi.waitFor(() =>
          expect(wv.setZoomFactor).toHaveBeenCalledWith(0.35),
        );

        // Fullscreen: the element is really 1020 wide while the prop stays 420.
        rect.mockReturnValue({ width: 1020 } as DOMRect);
        fireResize();

        await vi.waitFor(() =>
          expect(wv.setZoomFactor).toHaveBeenLastCalledWith(0.85),
        );
      } finally {
        restore();
      }
    });

    it("re-fits when a hidden tab stack turns visible (ResizeObserver 0→width)", async () => {
      // Tab switching hides the inactive stack (display:none → 0×0) and shows
      // the active one; a pane observed at 0 must skip, and the next observed
      // real width must re-fit the guest. Fixes preview pages staying shrunk
      // after switching tabs in fullscreen.
      const restore = installCapturingResizeObserver();
      try {
        const { wv } = renderPane();
        const pane = screen.getByTestId("preview-pane");
        const rect = vi.spyOn(pane, "getBoundingClientRect");
        rect.mockReturnValue({ width: 0 } as DOMRect);
        mockGuestMetrics(wv, 1200);
        fireDomReady(wv);
        // Hidden stack: the RO reports 0×0 → the debounced fit pass skips.
        fireResize();
        expect(wv.setZoomFactor).not.toHaveBeenCalled();

        // Tab activated → the pane gets its real width again → re-fit.
        rect.mockReturnValue({ width: 1020 } as DOMRect);
        fireResize();
        await vi.waitFor(() =>
          expect(wv.setZoomFactor).toHaveBeenCalledWith(0.85),
        );
      } finally {
        restore();
      }
    });
  });
});

describe("formatPreviewComment", () => {
  it("omits the 「text」 segment when the element has no inner text", () => {
    expect(
      formatPreviewComment({
        url: "http://localhost:5173/",
        selector: "#app > div",
        summary: "div.container",
        comment: "间距太大",
      }),
    ).toBe(
      "**预览评论** · http://localhost:5173/\n`div.container` · `#app > div`\n\n间距太大",
    );
  });
});

describe("rewriteCommentUrl", () => {
  const tunnelBase = "http://127.0.0.1:5173/app";
  const originalBase = "http://localhost:5173/app";

  it("rewrites a comment on the tunnel origin back to the original host", () => {
    expect(
      rewriteCommentUrl(
        "http://127.0.0.1:5173/settings?tab=1#top",
        tunnelBase,
        originalBase,
      ),
    ).toBe("http://localhost:5173/settings?tab=1#top");
  });

  it("keeps path/query/hash but swaps scheme, host, and port", () => {
    expect(
      rewriteCommentUrl(
        "https://127.0.0.1:8443/admin/users",
        "https://127.0.0.1:8443/",
        "https://10.0.0.5:8443/admin",
      ),
    ).toBe("https://10.0.0.5:8443/admin/users");
  });

  it("leaves URLs on other origins untouched", () => {
    expect(
      rewriteCommentUrl("http://127.0.0.1:9999/x", tunnelBase, originalBase),
    ).toBe("http://127.0.0.1:9999/x");
    expect(
      rewriteCommentUrl("https://example.com/foo", tunnelBase, originalBase),
    ).toBe("https://example.com/foo");
  });

  it("leaves invalid inputs untouched", () => {
    expect(rewriteCommentUrl("not a url", tunnelBase, originalBase)).toBe(
      "not a url",
    );
    expect(
      rewriteCommentUrl("http://127.0.0.1:5173/x", "bad base", originalBase),
    ).toBe("http://127.0.0.1:5173/x");
    expect(
      rewriteCommentUrl("http://127.0.0.1:5173/x", tunnelBase, "bad base"),
    ).toBe("http://127.0.0.1:5173/x");
  });
});

describe("PreviewPane integration (DesktopApp)", () => {
  afterEach(() => {
    delete window.waveHostType;
  });

  it("clicking a localhost link in a message opens the preview pane", () => {
    window.waveHostType = "desktop";
    render(<DesktopApp vscode={createMockVscode()} />);
    sendCommand("desktopWorkdirState", {
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    });
    sendCommand("authStatusResponse", { isAuthenticated: true });
    sendCommand("updateMessages", {
      messages: [
        MockDataGenerator.createAssistantMessage(
          "原型在 [这里](http://localhost:5173/proto)",
        ),
      ],
    });

    expect(screen.queryByTestId("preview-pane")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("这里"));

    const pane = screen.getByTestId("preview-pane");
    expect(pane).toBeInTheDocument();
    expect(pane.querySelector("webview")?.getAttribute("src")).toBe(
      "http://localhost:5173/proto",
    );

    // 关闭统一走一级 tab 的关闭按钮。
    fireEvent.click(screen.getByTestId("panel-tab-close-preview-1"));
    // Closing the panel's only tab unmounts the pane; the still-expanded
    // panel falls back to its empty-state guide.
    expect(screen.getByTestId("desktop-panel-slot")).toBeInTheDocument();
    expect(screen.getByTestId("panel-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-pane")).not.toBeInTheDocument();
  });

  it("single window: a second localhost link opens a new preview tab (新链接新 tab)", () => {
    window.waveHostType = "desktop";
    render(<DesktopApp vscode={createMockVscode()} />);
    sendCommand("desktopWorkdirState", {
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    });
    sendCommand("authStatusResponse", { isAuthenticated: true });
    sendCommand("updateMessages", {
      messages: [
        MockDataGenerator.createAssistantMessage(
          "[一](http://localhost:5173/a) 与 [二](http://localhost:5173/b)",
        ),
      ],
    });

    fireEvent.click(screen.getByText("一"));
    const wv = screen
      .getByTestId("preview-pane")
      .querySelector("webview") as unknown as MockWebview;
    wv.send = vi.fn();
    wv.loadURL = vi.fn().mockResolvedValue(undefined);
    wv.reload = vi.fn();
    wv.reloadIgnoringCache = vi.fn();
    wv.getURL = vi.fn(() => "http://localhost:5173/a");
    fireDomReady(wv);

    // Second localhost link → a NEW preview tab opens (「新链接新 tab」): both
    // addresses stay open side by side, the new tab is active.
    fireEvent.click(screen.getByText("二"));
    expect(screen.getAllByTestId("preview-pane")).toHaveLength(2);
    expect(screen.getByTestId("panel-tab-preview-2")).toBeInTheDocument();
    const active = activePane("preview-pane");
    expect(active?.querySelector("webview")?.getAttribute("src")).toBe(
      "http://localhost:5173/b",
    );
    expect(
      active?.querySelector("[data-testid=preview-address-display]"),
    ).toHaveTextContent("http://localhost:5173/b");
    // The first tab keeps its own address.
    expect(screen.getAllByTestId("preview-address-display")).toHaveLength(2);
    expect(screen.queryByTestId("preview-tab-bar")).not.toBeInTheDocument();

    // Close the second (active) tab → falls back to the first preview tab.
    fireEvent.click(screen.getByTestId("panel-tab-close-preview-2"));
    expect(
      activePane("preview-pane")?.querySelector("webview")?.getAttribute("src"),
    ).toBe("http://localhost:5173/a");
  });

  it("picker comments land in the chat input (batched), nothing sent directly", () => {
    window.waveHostType = "desktop";
    const vscode = createMockVscode();
    render(<DesktopApp vscode={vscode} />);
    sendCommand("desktopWorkdirState", {
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    });
    sendCommand("authStatusResponse", { isAuthenticated: true });
    sendCommand("updateMessages", {
      messages: [
        MockDataGenerator.createAssistantMessage(
          "原型在 [这里](http://localhost:5173/proto)",
        ),
      ],
    });
    fireEvent.click(screen.getByText("这里"));

    const wv = screen
      .getByTestId("preview-pane")
      .querySelector("webview") as unknown as MockWebview;
    wv.send = vi.fn();
    wv.loadURL = vi.fn().mockResolvedValue(undefined);
    wv.reload = vi.fn();
    wv.reloadIgnoringCache = vi.fn();
    wv.getURL = vi.fn(() => "http://localhost:5173/proto");
    fireDomReady(wv);
    firePickerReady(wv);
    fireEvent.click(screen.getByTestId("preview-picker-toggle"));

    const comment1 = {
      type: "submit",
      url: "http://localhost:5173/proto",
      selector: "#app > div > button.primary",
      summary: "button.primary",
      text: "去支付",
      comment: "这里改成主要按钮样式",
    };
    firePickerSubmit(wv, comment1);

    const input = screen.getByTestId("message-input") as HTMLElement;
    expect(input.textContent).toContain(
      "**预览评论** · http://localhost:5173/proto",
    );
    expect(input.textContent).toContain("这里改成主要按钮样式");
    expect(document.activeElement).toBe(input);
    // Round-trip through the markdown the send path actually consumes.
    expect(convertToMarkdown(input).markdown).toBe(
      formatPreviewComment(comment1),
    );

    // A second pick appends after the first instead of replacing it.
    firePickerSubmit(wv, {
      ...comment1,
      selector: "#app > div > input",
      summary: "input",
      text: "",
      comment: "占位文字再明显一点",
    });
    expect(convertToMarkdown(input).markdown).toBe(
      formatPreviewComment(comment1) +
        "\n\n" +
        formatPreviewComment({
          ...comment1,
          selector: "#app > div > input",
          summary: "input",
          text: "",
          comment: "占位文字再明显一点",
        }),
    );

    // No direct sendMessage — the user reviews the batch and sends manually.
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "updateInputContent" }),
    );
    // Picker stays active for continuous picking.
    expect(screen.getByTestId("preview-picker-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("fullscreen hides the conversation column; button and Esc restore (spec 场景 1-4)", () => {
    window.waveHostType = "desktop";
    render(<DesktopApp vscode={createMockVscode()} />);
    sendCommand("desktopWorkdirState", {
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    });
    sendCommand("authStatusResponse", { isAuthenticated: true });
    sendCommand("updateMessages", {
      messages: [
        MockDataGenerator.createAssistantMessage(
          "[这里](http://localhost:5173/proto)",
        ),
      ],
    });
    fireEvent.click(screen.getByText("这里"));
    // Open diff as well so fullscreen hides it (spec 场景 3).
    fireEvent.click(screen.getByTestId("panel-tabs-add"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" }); // close the + menu
    // Switch back to the preview tab — fullscreen shows the ACTIVE panel.
    fireEvent.click(screen.getByTestId("panel-tab-preview-1"));

    const body = screen
      .getByTestId("preview-pane")
      .closest(".desktop-chat-body") as HTMLElement;
    expect(body.querySelector(".desktop-chat-main")).not.toBeNull();
    // Tabbed layout: one shared slot for both panels.
    expect(document.querySelectorAll(".desktop-panel-slot")).toHaveLength(1);

    // Enter fullscreen via the tab-bar button.
    fireEvent.click(screen.getByTestId("panel-fullscreen"));
    expect(body).toHaveClass("preview-fullscreen");
    expect(body.querySelector(".desktop-chat-main")).toBeNull();
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();
    // The inactive diff tab stays mounted but hidden (content survives).
    expect(screen.getByTestId("diff-pane").parentElement).toHaveStyle({
      display: "none",
    });

    // Esc exits fullscreen and restores the previous layout (spec 场景 2).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(body).not.toHaveClass("preview-fullscreen");
    expect(body.querySelector(".desktop-chat-main")).not.toBeNull();
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();

    // The button toggles back as well (spec 场景 2).
    fireEvent.click(screen.getByTestId("panel-fullscreen"));
    expect(body).toHaveClass("preview-fullscreen");
    fireEvent.click(screen.getByTestId("panel-fullscreen"));
    expect(body).not.toHaveClass("preview-fullscreen");
  });
});
