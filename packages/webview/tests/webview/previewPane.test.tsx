import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
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

type MockWebview = Omit<
  WebviewTagElement,
  "send" | "loadURL" | "reload" | "reloadIgnoringCache" | "getURL"
> & {
  send: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  reloadIgnoringCache: ReturnType<typeof vi.fn>;
  getURL: ReturnType<typeof vi.fn>;
};

function renderPane(options?: {
  url?: string;
  onClose?: () => void;
  onAddComment?: (text: string) => void;
  originalUrl?: string;
  onRetry?: () => void;
  onLastTabClosed?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const vscode = createMockVscode();
  const url = options?.url ?? "http://localhost:5173/app";
  const onClose = options?.onClose ?? vi.fn();
  const onAddComment = options?.onAddComment ?? vi.fn();
  const originalUrl = options?.originalUrl;
  const onRetry = options?.onRetry;
  const onLastTabClosed = options?.onLastTabClosed ?? vi.fn();
  const fullscreen = options?.fullscreen ?? false;
  const onToggleFullscreen = options?.onToggleFullscreen ?? vi.fn();
  // Controlled-width harness: PreviewPane no longer owns its width state.
  const Harness = ({ url: u }: { url: string }) => {
    const [width, setWidth] = React.useState(420);
    return (
      <PreviewPane
        url={u}
        vscode={vscode}
        onClose={onClose}
        width={width}
        onWidthChange={setWidth}
        maxWidth={716}
        onAddComment={onAddComment}
        originalUrl={originalUrl}
        onRetry={onRetry}
        onLastTabClosed={onLastTabClosed}
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
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
  const rerenderWithUrl = (u: string) => result.rerender(<Harness url={u} />);
  return {
    ...result,
    rerenderWithUrl,
    vscode,
    wv,
    url,
    onClose,
    onAddComment,
    onLastTabClosed,
    onToggleFullscreen,
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
const firePickerSubmit = (wv: MockWebview, payload: Record<string, unknown>) =>
  fireEvent(
    wv,
    Object.assign(new Event("ipc-message"), {
      channel: "wave-picker",
      args: [payload],
    }),
  );

describe("PreviewPane", () => {
  it("loads the URL into the guest and shows it in the toolbar", () => {
    const { wv, url } = renderPane();
    expect(wv.getAttribute("src")).toBe(url);
    expect(screen.getByText(url)).toBeInTheDocument();
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

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    renderPane({ onClose });
    fireEvent.click(screen.getByTestId("preview-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates via loadURL when a different URL arrives after dom-ready", () => {
    const { wv, rerenderWithUrl } = renderPane();
    fireDomReady(wv);
    rerenderWithUrl("http://localhost:3000/other");
    expect(wv.loadURL).toHaveBeenCalledWith("http://localhost:3000/other");
  });

  it("fullscreen toggle button calls onToggleFullscreen and switches icon (spec 场景 1)", () => {
    const onToggleFullscreen = vi.fn();
    const { rerender } = renderPane({ onToggleFullscreen });

    const btn = screen.getByTestId("preview-fullscreen");
    expect(btn).toHaveAttribute("title", "全屏预览");
    expect(btn.querySelector(".codicon-screen-full")).not.toBeNull();
    fireEvent.click(btn);
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);

    // Fullscreen state: icon flips to 退出全屏 (screen-normal).
    rerender(
      <PreviewPane
        url="http://localhost:5173/app"
        vscode={createMockVscode()}
        onClose={vi.fn()}
        width={420}
        onWidthChange={vi.fn()}
        maxWidth={716}
        fullscreen
        onToggleFullscreen={onToggleFullscreen}
      />,
    );
    const fsBtn = screen.getByTestId("preview-fullscreen");
    expect(fsBtn).toHaveAttribute("title", "退出全屏");
    expect(fsBtn.querySelector(".codicon-screen-normal")).not.toBeNull();
    expect(fsBtn).toHaveAttribute("aria-pressed", "true");
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

  describe("preview tabs (spec 预览多标签页)", () => {
    const tabCount = () =>
      screen.getByTestId("preview-tab-bar").querySelectorAll(".preview-tab")
        .length;

    it("opens a second tab for a new URL and selects it (scenario 1)", () => {
      const { wv, rerenderWithUrl } = renderPane();
      fireDomReady(wv);
      rerenderWithUrl("http://localhost:3000/other");

      expect(tabCount()).toBe(2);
      const bar = screen.getByTestId("preview-tab-bar");
      const active = bar.querySelector(".preview-tab.active") as HTMLElement;
      expect(active.textContent).toContain("localhost:3000");
      expect(wv.loadURL).toHaveBeenCalledWith("http://localhost:3000/other");
    });

    it("reuses an existing tab when the same URL is requested again", () => {
      const { wv, rerenderWithUrl } = renderPane();
      fireDomReady(wv);
      rerenderWithUrl("http://localhost:3000/other");
      expect(tabCount()).toBe(2);

      rerenderWithUrl("http://localhost:3000/other");
      expect(tabCount()).toBe(2);
      // Switching back to the reused tab does not re-navigate the guest.
      expect(wv.loadURL).toHaveBeenCalledTimes(1);
    });

    it("switches tabs on click (scenario 2)", () => {
      const { rerenderWithUrl } = renderPane();
      rerenderWithUrl("http://localhost:3000/other");
      const bar = screen.getByTestId("preview-tab-bar");
      const first = bar.querySelectorAll(".preview-tab")[0] as HTMLElement;

      fireEvent.click(first);

      expect(first.classList.contains("active")).toBe(true);
      expect(bar.querySelector(".preview-tab.active")).toBe(first);
      // Address bar shows the selected tab's URL.
      expect(screen.getByTestId("preview-address-display")).toHaveTextContent(
        "http://localhost:5173/app",
      );
    });

    it("closing the selected tab falls back to its left neighbor (scenario 4)", () => {
      const { onClose, rerenderWithUrl } = renderPane();
      rerenderWithUrl("http://localhost:3000/other");
      rerenderWithUrl("http://localhost:3000/third");
      const bar = screen.getByTestId("preview-tab-bar");
      expect(tabCount()).toBe(3);

      // Close the currently active (rightmost) tab.
      const tabs = bar.querySelectorAll(".preview-tab");
      fireEvent.click(
        tabs[2].querySelector(".preview-tab-close") as HTMLElement,
      );

      const remaining = bar.querySelectorAll(".preview-tab");
      expect(remaining).toHaveLength(2);
      expect(remaining[1].classList.contains("active")).toBe(true);
      expect(remaining[1].textContent).toContain("localhost:3000/other");
      expect(onClose).not.toHaveBeenCalled();
    });

    it("closing the last tab collapses the panel (scenario 4)", () => {
      const onClose = vi.fn();
      const onLastTabClosed = vi.fn();
      renderPane({ onClose, onLastTabClosed });
      expect(tabCount()).toBe(1);

      fireEvent.click(
        screen
          .getByTestId("preview-tab-bar")
          .querySelector(".preview-tab-close") as HTMLElement,
      );

      expect(onLastTabClosed).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("add-blank button shows the new-tab placeholder; committing the address loads it (scenario 5)", () => {
      const { wv, rerenderWithUrl } = renderPane();
      fireDomReady(wv);
      rerenderWithUrl("http://localhost:3000/other");
      wv.loadURL.mockClear();

      fireEvent.click(screen.getByTestId("preview-tab-add"));

      expect(tabCount()).toBe(3);
      expect(screen.getByTestId("preview-tab-new")).toBeInTheDocument();
      expect(screen.getByTestId("preview-address-input")).toBeInTheDocument();

      // Commit a bare hostname — normalized with http:// and loaded.
      fireEvent.change(screen.getByTestId("preview-address-input"), {
        target: { value: "localhost:4000" },
      });
      fireEvent.keyDown(screen.getByTestId("preview-address-input"), {
        key: "Enter",
      });

      expect(screen.queryByTestId("preview-tab-new")).not.toBeInTheDocument();
      expect(screen.getByTestId("preview-address-display")).toHaveTextContent(
        "http://localhost:4000",
      );
      expect(wv.loadURL).toHaveBeenCalledWith("http://localhost:4000");
    });

    it("Escape cancels address editing back to the tab's URL", () => {
      const { rerenderWithUrl } = renderPane();
      rerenderWithUrl("http://localhost:3000/other");
      fireEvent.click(screen.getByTestId("preview-address-display"));

      const input = screen.getByTestId("preview-address-input");
      expect(input).toHaveValue("http://localhost:3000/other");
      fireEvent.change(input, { target: { value: "localhost:9999" } });
      fireEvent.keyDown(input, { key: "Escape" });

      // Editing abandoned — display restored, tab untouched.
      expect(screen.getByTestId("preview-address-display")).toHaveTextContent(
        "http://localhost:3000/other",
      );
      expect(tabCount()).toBe(2);
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

    fireEvent.click(screen.getByTestId("preview-close"));
    // Close = uncheck: the panel stays mounted (guest not reloaded), just hidden.
    const slot = screen.getByTestId("preview-pane").parentElement;
    expect(slot).toHaveClass("desktop-panel-slot");
    expect(slot).toHaveStyle({ display: "none" });
  });

  it("multi-tab: a second link opens a new tab; closing the last tab collapses the panel", () => {
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

    // Second localhost link → a second tab, selected.
    fireEvent.click(screen.getByText("二"));
    const bar = screen.getByTestId("preview-tab-bar");
    expect(bar.querySelectorAll(".preview-tab")).toHaveLength(2);
    expect(bar.querySelector(".preview-tab.active")?.textContent).toContain(
      "localhost:5173/b",
    );

    // Close the active tab, then the last one → panel collapses.
    fireEvent.click(
      bar.querySelectorAll(".preview-tab-close")[1] as HTMLElement,
    );
    fireEvent.click(
      bar.querySelectorAll(".preview-tab-close")[0] as HTMLElement,
    );
    const slot = screen.getByTestId("preview-pane-empty").parentElement;
    expect(slot).toHaveClass("desktop-panel-slot");
    expect(slot).toHaveStyle({ display: "none" });
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

  it("fullscreen hides the conversation column and other panels; button and Esc restore (spec 场景 1-4)", () => {
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
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" }); // close the toggle menu

    const body = screen
      .getByTestId("preview-pane")
      .closest(".desktop-chat-body") as HTMLElement;
    expect(body.querySelector(".desktop-chat-main")).not.toBeNull();
    expect(document.querySelectorAll(".desktop-panel-slot")).toHaveLength(2);

    // Enter fullscreen via the toolbar button.
    fireEvent.click(screen.getByTestId("preview-fullscreen"));
    expect(body).toHaveClass("preview-fullscreen");
    expect(body.querySelector(".desktop-chat-main")).toBeNull();
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();

    // Esc exits fullscreen and restores the previous layout (spec 场景 2).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(body).not.toHaveClass("preview-fullscreen");
    expect(body.querySelector(".desktop-chat-main")).not.toBeNull();
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();

    // The button toggles back as well (spec 场景 2).
    fireEvent.click(screen.getByTestId("preview-fullscreen"));
    expect(body).toHaveClass("preview-fullscreen");
    fireEvent.click(screen.getByTestId("preview-fullscreen"));
    expect(body).not.toHaveClass("preview-fullscreen");
  });
});
