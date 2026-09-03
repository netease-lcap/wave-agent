import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { ChatApp, prunePanelGroupCache } from "../../src/components/ChatApp";
import type { WebviewTagElement } from "../../src/components/PreviewPane";
import { READ_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME } from "wave-agent-sdk";
import {
  createMockVscode,
  sendCommand,
  sendHostMessage,
  renderChatApp,
  fireInput,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";
import { MockDataGenerator } from "../fixtures/mockData";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

/**
 * Conversation-level panel framework (FR-039/040/041/042): the header toggle
 * mounts/hides panel slots inside the desktop chat body, desktopTogglePanel
 * routes through the same handler, and desktopPanelState reports the toggle
 * state back to the host for the app-menu checkboxes.
 */

function renderDesktop(options?: { workdir?: string }) {
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(
    fixtures.desktopWorkdirState({
      workdir: options?.workdir,
      recentWorkdirs: options?.workdir ? [options.workdir] : [],
    }),
  );
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

const panelStatePosts = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .filter(([msg]) => msg.command === "desktopPanelState")
    .map(([msg]) => msg.checked as string[]);

const lastPanelState = (vscode: ReturnType<typeof createMockVscode>) => {
  const posts = panelStatePosts(vscode);
  return posts[posts.length - 1];
};

// Multi-instance tabs can render several panes of the same kind at once (e.g.
// two preview tabs). Find the pane belonging to the ACTIVE tab — the only one
// whose .desktop-panel-stack is visible.
const activePane = (testId: string) =>
  screen
    .getAllByTestId(testId)
    .find(
      (p) =>
        (p.closest(".desktop-panel-stack") as HTMLElement | null)?.style
          .display !== "none",
    );

beforeEach(() => {
  // The panel-group cache is module-level — isolate tests from each other.
  prunePanelGroupCache(new Set());
});

afterEach(() => {
  delete window.waveHostType;
  // TerminalPane may inject the lazy chunk script; clean it up.
  document.head
    .querySelectorAll('script[src="./terminal.js"]')
    .forEach((s) => s.remove());
});

describe("ChatApp desktop panel framework", () => {
  it("shows the header panel toggle on desktop but not in IDE hosts", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    expect(screen.getByTestId("panel-toggle-btn")).toBeInTheDocument();
  });

  it("hides the panel toggle outside the desktop host", () => {
    renderChatApp();
    expect(screen.queryByTestId("panel-toggle-btn")).not.toBeInTheDocument();
  });

  it("expanding the panel and picking 差异 from the empty state mounts the diff pane", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-empty-item-diff"));

    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopGetWorkspaceDiff",
    });
    // The header button is now an expand/collapse switch — no dropdown menu;
    // the empty state opened the tab directly.
    expect(screen.queryByTestId("panel-toggle-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("panel-tab-diff-1")).toBeInTheDocument();
  });

  it("multiple panels open as tabs in one shared slot; clicking a tab switches the active panel", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-empty-item-terminal"));
    fireEvent.click(screen.getByTestId("panel-tabs-add"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-preview"));
    fireEvent.click(screen.getByTestId("panel-tabs-add"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));

    // One shared slot hosts all three panels as tabs.
    expect(document.querySelectorAll(".desktop-panel-slot")).toHaveLength(1);
    expect(screen.getByTestId("panel-tab-terminal-1")).toBeInTheDocument();
    expect(screen.getByTestId("panel-tab-preview-1")).toBeInTheDocument();
    expect(screen.getByTestId("panel-tab-diff-1")).toBeInTheDocument();
    // The last opened panel is active; the others stay mounted but hidden.
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(screen.getByTestId("diff-pane").parentElement).not.toHaveStyle({
      display: "none",
    });
    expect(screen.getByTestId("terminal-pane").parentElement).toHaveStyle({
      display: "none",
    });
    expect(screen.getByTestId("preview-pane-empty").parentElement).toHaveStyle({
      display: "none",
    });

    // Clicking the preview tab switches the active panel.
    fireEvent.click(screen.getByTestId("panel-tab-preview-1"));
    expect(
      screen.getByTestId("preview-pane-empty").parentElement,
    ).not.toHaveStyle({ display: "none" });
    expect(screen.getByTestId("diff-pane").parentElement).toHaveStyle({
      display: "none",
    });
  });

  it("a preview tab shows the guest page title once the page reports one", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.updateMessages([
        MockDataGenerator.createAssistantMessage(
          "原型在 [这里](http://localhost:5173/app)",
        ),
      ]),
    );
    fireEvent.click(screen.getByText("这里"));
    // Until the page reports a title, the tab falls back to host+path.
    expect(screen.getByTestId("panel-tab-preview-1")).toHaveTextContent(
      "localhost:5173/app",
    );
    const wv = document.querySelector("webview") as unknown as Element;
    fireEvent(
      wv,
      Object.assign(new Event("page-title-updated"), { title: "登录页" }),
    );
    // The tab label follows the page title, like a regular browser tab.
    expect(screen.getByTestId("panel-tab-preview-1")).toHaveTextContent(
      "登录页",
    );
  });

  it("the empty preview pane (no URL) resizes via its left-edge handle", () => {
    window.waveHostType = "desktop";
    // jsdom reports 0 rects; pin a container width so panelMaxWidth stays
    // positive and the drag can actually widen the panel.
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 1024, right: 1024, left: 0 } as DOMRect);
    try {
      renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-preview"));

      const empty = screen.getByTestId("preview-pane-empty");
      // The tabbed layout opens at the shared default width (no auto-fill).
      expect(empty.style.width).toBe("420px");
      // The empty state must carry the same drag affordance as loaded panels.
      expect(empty.querySelector(".preview-pane-drag-handle")).not.toBeNull();

      // Single-row layout: width = rect.right - clientX.
      const handle = empty.querySelector(
        ".preview-pane-drag-handle",
      ) as HTMLElement;
      fireEvent.mouseDown(handle);
      fireEvent.mouseMove(window, { clientX: 624 }); // 1024 - 624 = 400
      expect(empty.style.width).toBe("400px");
      fireEvent.mouseUp(window);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("a panel opens at the default width, which fits in a narrow window", () => {
    window.waveHostType = "desktop";
    // 800px: 800 - 360 = 440 ≥ the 420px default — the panel opens at the
    // default width (no auto-fill in the tabbed layout).
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 800, right: 800 } as DOMRect);
    try {
      renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
      expect(screen.getByTestId("diff-pane").style.width).toBe("420px");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("the shared panel width persists after close/reopen (spec 场景 3)", () => {
    window.waveHostType = "desktop";
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 1400, right: 1400 } as DOMRect);
    try {
      renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
      const pane = screen.getByTestId("diff-pane");
      expect(pane.style.width).toBe("420px"); // default, not auto-filled

      // A drag moves the panel off the default width and locks it.
      const handle = pane.querySelector(
        ".preview-pane-drag-handle",
      ) as HTMLElement;
      fireEvent.mouseDown(handle);
      fireEvent.mouseMove(window, { clientX: 1000 }); // 1400 - 1000 = 400
      expect(pane.style.width).toBe("400px");
      fireEvent.mouseUp(window);

      // Close (last tab → the expanded panel falls back to its empty state),
      // then open 差异 again: the shared width is kept — no reset to default.
      fireEvent.click(screen.getByTestId("panel-tab-close-diff-1"));
      expect(screen.getByTestId("panel-empty-state")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
      expect(screen.getByTestId("diff-pane").style.width).toBe("400px");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("closing the last tab falls back to the empty state; reopening remounts the panel", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();

    // Closing the only open tab leaves the (still expanded) panel on its
    // empty-state guide — the tab instance is destroyed with the close.
    fireEvent.click(screen.getByTestId("panel-tab-close-diff-1"));
    expect(screen.getByTestId("desktop-panel-slot")).toBeInTheDocument();
    expect(screen.getByTestId("panel-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();

    // Opening again from the empty state mounts a fresh panel.
    fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
    expect(screen.getByTestId("desktop-panel-slot")).toBeInTheDocument();
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
  });

  it("the tab close button removes the only tab and the empty state takes over", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-empty-item-diff"));

    fireEvent.click(screen.getByTestId("panel-tab-close-diff-1"));
    expect(screen.getByTestId("desktop-panel-slot")).toBeInTheDocument();
    expect(screen.getByTestId("panel-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
  });

  it("reports toggle state to the host via desktopPanelState", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    // Initial report on mount.
    expect(lastPanelState(vscode)).toEqual([]);

    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
    expect(lastPanelState(vscode)).toEqual(["diff"]);

    fireEvent.click(screen.getByTestId("panel-tabs-add"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-terminal"));
    expect(lastPanelState(vscode)).toEqual(["diff", "terminal"]);

    // Closing the diff tab unchecks its kind (the header has no checkbox
    // menu anymore — closing happens on the tab).
    fireEvent.click(screen.getByTestId("panel-tab-close-diff-1"));
    expect(lastPanelState(vscode)).toEqual(["terminal"]);
  });

  it("desktopTogglePanel from the host takes the same path as the menu", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(fixtures.desktopTogglePanel("diff"));
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual(["diff"]);

    // Toggling off closes the only tab — the expanded panel shows the empty
    // state instead of the tab strip.
    sendHostMessage(fixtures.desktopTogglePanel("diff"));
    expect(screen.getByTestId("panel-empty-state")).toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual([]);
  });

  it("disables diff/terminal without a workdir; preview stays available", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop();
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));

    expect(screen.getByTestId("panel-empty-item-diff")).toBeDisabled();
    expect(screen.getByTestId("panel-empty-item-terminal")).toBeDisabled();
    expect(screen.getByTestId("panel-empty-item-preview")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "desktopGetWorkspaceDiff",
    });

    // Host-originated toggles hit the same guard.
    sendHostMessage(fixtures.desktopTogglePanel("terminal"));
    expect(screen.queryByTestId("terminal-pane")).not.toBeInTheDocument();
  });

  it("refuses to open a panel when it would squeeze the conversation below its minimum", () => {
    window.waveHostType = "desktop";
    // 500px fits the 420px default panel width only without the 360px
    // conversation minimum beside it — there is no second row to overflow
    // into, so the panel is rejected with a hint.
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 500, right: 500 } as DOMRect);
    try {
      const { vscode } = renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
      expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "空间不足，无法开启面板",
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("refuses to open a panel narrower than its own minimum width", () => {
    window.waveHostType = "desktop";
    // 300px is below the 420px default panel width even on the full pane
    // → the panel cannot open at all.
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 300, right: 300 } as DOMRect);
    try {
      const { vscode } = renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
      expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "空间不足，无法开启面板",
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("two panels fit as tabs in one slot with a shared width (no eviction)", () => {
    window.waveHostType = "desktop";
    // 800px fits one 420px panel beside the 360px conversation minimum; the
    // tabbed layout opens both as tabs in the SAME slot — nothing is evicted.
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 800, right: 800 } as DOMRect);
    try {
      const { vscode } = renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-file"));
      expect(screen.getByTestId("file-pane")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("panel-tabs-add"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-terminal"));
      expect(screen.getByTestId("terminal-pane")).toBeInTheDocument();
      // Both tabs open; terminal is active, file stays mounted but hidden.
      expect(screen.getByTestId("panel-tab-file-1")).toBeInTheDocument();
      expect(screen.getByTestId("panel-tab-terminal-1")).toBeInTheDocument();
      expect(screen.getByTestId("file-pane").parentElement).toHaveStyle({
        display: "none",
      });
      expect(screen.getByTestId("terminal-pane").parentElement).not.toHaveStyle(
        { display: "none" },
      );
      // No eviction hint — both coexist.
      expect(vscode.postMessage).not.toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: expect.stringContaining("已自动关闭"),
      });
      expect(lastPanelState(vscode)).toEqual(["file", "terminal"]);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("opening more panels keeps earlier ones as tabs; closing the active tab falls back left", () => {
    window.waveHostType = "desktop";
    // Wide window: all four panels coexist as tabs in the single slot.
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 1620, right: 1620 } as DOMRect);
    try {
      const { vscode } = renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-file"));
      fireEvent.click(screen.getByTestId("panel-tabs-add"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-terminal"));
      fireEvent.click(screen.getByTestId("panel-tabs-add"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-preview"));
      fireEvent.click(screen.getByTestId("panel-tabs-add"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));

      for (const kind of ["file", "terminal", "preview", "diff"]) {
        expect(screen.getByTestId(`panel-tab-${kind}-1`)).toBeInTheDocument();
      }
      expect(screen.getByTestId("diff-pane").parentElement).not.toHaveStyle({
        display: "none",
      });
      // No eviction hints at any point.
      expect(vscode.postMessage).not.toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: expect.stringContaining("已自动关闭"),
      });

      // Closing the ACTIVE diff tab falls back to its left neighbor
      // (preview — the previous tab in open order).
      fireEvent.click(screen.getByTestId("panel-tab-close-diff-1"));
      expect(
        screen.getByTestId("preview-pane-empty").parentElement,
      ).not.toHaveStyle({ display: "none" });
      // The closed tab is destroyed (browser-tab semantics): its pane
      // unmounts, the other tabs stay open.
      expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
      expect(lastPanelState(vscode)).toEqual(["file", "terminal", "preview"]);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("refuses to open when the window is too narrow and keeps the existing tab", () => {
    window.waveHostType = "desktop";
    let width = 700;
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ width, right: width }) as DOMRect);
    try {
      const { vscode } = renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-file"));
      expect(screen.getByTestId("file-pane")).toBeInTheDocument();
      // 700 - 360 = 340 ≥ the 320px minimum → opens, clamped to 340.
      expect(screen.getByTestId("file-pane").style.width).toBe("340px");

      // 650px: 650 - 360 = 290 < the 320px minimum → the new panel is
      // refused and the existing tab is untouched.
      width = 650;
      fireEvent.click(screen.getByTestId("panel-tabs-add"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-terminal"));
      expect(screen.queryByTestId("terminal-pane")).not.toBeInTheDocument();
      expect(screen.getByTestId("file-pane")).toBeInTheDocument();
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "空间不足，无法开启面板",
      });
      expect(lastPanelState(vscode)).toEqual(["file"]);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("clicking a file path switches the existing file tab to it (single-instance)", () => {
    window.waveHostType = "desktop";
    // 1200px: both panels fit as tabs in the shared slot.
    let width = 1200;
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ width, right: width }) as DOMRect);
    try {
      const { vscode } = renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-file"));
      fireEvent.click(screen.getByTestId("panel-tabs-add"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-terminal"));

      sendCommand("updateMessages", {
        messages: [
          MockDataGenerator.createAssistantMessageWithTool(
            "Reading a file.",
            READ_TOOL_NAME,
            JSON.stringify({ file_path: "/work/a/src/target.ts" }),
            "done",
          ),
        ],
      });
      const path = document.querySelector(".write-tool-path") as HTMLElement;
      expect(path).toBeInTheDocument();

      // The file panel is single-instance: clicking the path reuses the one
      // file tab (no second tab) and activates it with a loading stub.
      width = 1100;
      fireEvent.click(path);
      expect(activePane("file-pane")).toBeDefined();
      expect(screen.getByTestId("panel-tab-file-1")).toBeInTheDocument();
      expect(screen.queryByTestId("panel-tab-file-2")).not.toBeInTheDocument();
      expect(screen.getByTestId("terminal-pane").parentElement).toHaveStyle({
        display: "none",
      });
      expect(screen.getByTestId("panel-tab-terminal-1")).toBeInTheDocument();
      expect(vscode.postMessage).not.toHaveBeenCalledWith({
        command: "desktopShowHint",
      });
      expect(lastPanelState(vscode)).toEqual(["file", "terminal"]);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("clicking different file paths reuses the single file tab (spec 场景 6 单实例)", () => {
    window.waveHostType = "desktop";
    // 1000px fits the 420px file panel beside the 360px conversation
    // minimum. The file panel is single-instance: a second path switches the
    // one tab's content instead of opening a parallel tab.
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 1000, right: 1000 } as DOMRect);
    try {
      renderDesktop({ workdir: "/work/a" });
      const readMessage = (path: string) =>
        MockDataGenerator.createAssistantMessageWithTool(
          "Reading a file.",
          READ_TOOL_NAME,
          JSON.stringify({ file_path: path }),
          "done",
        );

      sendCommand("updateMessages", {
        messages: [readMessage("/work/a/src/first.ts")],
      });
      const firstPath = document.querySelector(
        ".write-tool-path",
      ) as HTMLElement;
      expect(firstPath).toBeInTheDocument();
      fireEvent.click(firstPath);

      const pane = activePane("file-pane");
      expect(pane).toBeDefined();
      expect(pane?.closest(".desktop-panel-slot")).toHaveClass(
        "desktop-panel-slot",
      );

      // A different file link reuses the SAME file tab — still one tab, the
      // fileView switches to the new path (loading until the host replies).
      sendCommand("updateMessages", {
        messages: [readMessage("/work/a/src/second.ts")],
      });
      fireEvent.click(
        document.querySelector(".write-tool-path") as HTMLElement,
      );

      expect(screen.getAllByTestId("file-pane")).toHaveLength(1);
      expect(screen.getByTestId("panel-tab-file-1")).toBeInTheDocument();
      expect(screen.queryByTestId("panel-tab-file-2")).not.toBeInTheDocument();
      expect(
        activePane("file-pane")?.closest(".desktop-panel-slot"),
      ).toHaveClass("desktop-panel-slot");
      // The tab is a loading stub pointing at the second path.
      expect(activePane("file-pane")).toHaveTextContent("second.ts");
      expect(
        screen.queryByTestId("desktop-panel-row-separator"),
      ).not.toBeInTheDocument();
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("does not show the panel toggle when waveHostType is not desktop", () => {
    const vscode = createMockVscode();
    render(<ChatApp vscode={vscode} />);
    sendHostMessage(fixtures.authStatusResponse());
    expect(screen.queryByTestId("panel-toggle-btn")).not.toBeInTheDocument();
    expect(document.querySelector(".desktop-panel-slot")).toBeNull();
  });

  it("collapsing keeps the tabs, width and active tab; expanding restores them", () => {
    window.waveHostType = "desktop";
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 1400, right: 1400 } as DOMRect);
    try {
      renderDesktop({ workdir: "/work/a" });
      // Open two tabs; diff is active.
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-preview"));
      fireEvent.click(screen.getByTestId("panel-tabs-add"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));

      // Drag the shared width off the default.
      const handle = screen
        .getByTestId("diff-pane")
        .querySelector(".preview-pane-drag-handle") as HTMLElement;
      fireEvent.mouseDown(handle);
      fireEvent.mouseMove(window, { clientX: 1000 }); // 1400-1000 = 400
      fireEvent.mouseUp(window);
      expect(screen.getByTestId("diff-pane").style.width).toBe("400px");

      // Collapse: the slot hides (display:none) but stays mounted — the open
      // tabs and the active tab keep their state.
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      expect(screen.getByTestId("panel-toggle-btn")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(screen.getByTestId("desktop-panel-slot")).toHaveStyle({
        display: "none",
      });
      expect(screen.getByTestId("panel-tab-diff-1")).toBeInTheDocument();
      expect(screen.getByTestId("panel-tab-preview-1")).toBeInTheDocument();

      // Expand again: the dragged width and the previously viewed tab return.
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      expect(screen.getByTestId("panel-toggle-btn")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByTestId("desktop-panel-slot")).not.toHaveStyle({
        display: "none",
      });
      expect(screen.getByTestId("diff-pane").style.width).toBe("400px");
      expect(screen.getByTestId("diff-pane").parentElement).not.toHaveStyle({
        display: "none",
      });
      expect(
        screen.getByTestId("preview-pane-empty").parentElement,
      ).toHaveStyle({ display: "none" });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("opening a tab through a message link auto-expands a collapsed panel", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();

    // Collapse while the diff tab stays open.
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    expect(screen.getByTestId("desktop-panel-slot")).toHaveStyle({
      display: "none",
    });

    // A link click raises a NEW preview tab and brings the panel back — the
    // newly raised tab wins over the previously viewed one.
    sendHostMessage(
      fixtures.updateMessages([
        MockDataGenerator.createAssistantMessage(
          "原型在 [这里](http://localhost:5173/app)",
        ),
      ]),
    );
    fireEvent.click(screen.getByText("这里"));
    expect(screen.getByTestId("desktop-panel-slot")).not.toHaveStyle({
      display: "none",
    });
    expect(screen.getByTestId("panel-tab-preview-1")).toBeInTheDocument();
    expect(screen.getByTestId("preview-pane").parentElement).not.toHaveStyle({
      display: "none",
    });
    expect(screen.getByTestId("diff-pane").parentElement).toHaveStyle({
      display: "none",
    });
  });

  it("expanding with no tabs shows the empty-state guide listing the five capabilities", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    // Initial state: no tabs, panel collapsed — nothing on the right.
    expect(screen.queryByTestId("desktop-panel-slot")).not.toBeInTheDocument();

    // Expand: the empty-state guide appears with all five capabilities.
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    expect(screen.getByTestId("panel-empty-state")).toBeInTheDocument();
    for (const kind of ["preview", "plan", "diff", "terminal", "file"]) {
      expect(
        screen.getByTestId(`panel-empty-item-${kind}`),
      ).toBeInTheDocument();
    }

    // Picking one opens the matching tab and leaves the empty state.
    fireEvent.click(screen.getByTestId("panel-empty-item-plan"));
    expect(screen.queryByTestId("panel-empty-state")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-pane")).toBeInTheDocument();
    expect(screen.getByTestId("panel-tab-plan-1")).toBeInTheDocument();
  });
});

/**
 * Panel groups follow the session, not the pane: switching the session bound
 * to a pane swaps the whole panel group (checked set, layout, preview URL),
 * and switching back restores it. A pane's new-session state has its own
 * bucket that migrates to the session id once the first message binds one.
 */
describe("session-level panel groups", () => {
  const session = (sessionId: string) => ({
    sessionId,
    title: sessionId,
    lastActiveAt: Date.now(),
    hasWorktree: false,
  });
  const pushPanes = (sessionId?: string) => {
    sendHostMessage(
      fixtures.desktopPanes({
        panes: [
          { paneId: "pane-1", sessionId, row: 0, host: "local", width: 0.5 },
        ],
        focusedPaneId: "pane-1",
      }),
    );
    // The pane-scoped ChatApp mounts on desktopPanes; initialize it so the
    // input area renders (pane-scoped instances only accept paneId-tagged
    // messages).
    sendCommand("setInitialState", { messages: [], paneId: "pane-1" });
  };
  const pushTree = (ids: string[]) =>
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: ids.map(session) },
        ],
      }),
    );
  const openPanel = (kind: string) => {
    // Expand the panel if it isn't already; with no tab open the empty-state
    // guide offers the five capabilities. When tabs exist, the "＋" menu adds
    // another instance.
    const btn = screen.getByTestId("panel-toggle-btn");
    if (btn.getAttribute("aria-expanded") === "false") {
      fireEvent.click(btn);
    }
    const emptyItem = screen.queryByTestId(`panel-empty-item-${kind}`);
    if (emptyItem) {
      fireEvent.click(emptyItem);
    } else {
      fireEvent.click(screen.getByTestId("panel-tabs-add"));
      fireEvent.click(screen.getByTestId(`panel-toggle-item-${kind}`));
    }
    fireEvent.mouseDown(document.body); // dismiss any menu
  };

  it("switching sessions swaps the panel group; switching back restores it", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    pushTree(["s1", "s2"]);
    pushPanes("s1");
    openPanel("diff");
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual(["diff"]);

    // s2 has no remembered group — the diff panel must not leak into it.
    pushPanes("s2");
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual([]);

    // s2 gets its own group; the two sessions coexist independently.
    openPanel("terminal");
    expect(screen.getByTestId("terminal-pane")).toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual(["terminal"]);

    pushPanes("s1");
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-pane")).not.toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual(["diff"]);

    pushPanes("s2");
    expect(screen.getByTestId("terminal-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual(["terminal"]);
  });

  it("the new-session bucket migrates to the session id bound by the first message", async () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    pushTree(["s1", "s2"]);
    pushPanes(undefined); // new-session state, no session bound
    openPanel("diff");
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();

    // Send the first message — this is what makes the coming session bind
    // a continuation of the new-session state (vs a sidebar switch).
    const input = screen.getByTestId("message-input");
    act(() => {
      input.textContent = "hi";
    });
    await fireInput(input, { data: "hi", inputType: "insertText" });
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    // The message binds session s1: the panel setup carries over.
    pushPanes("s1");
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();

    // ...and is remembered under that session from then on.
    pushPanes("s2");
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
    pushPanes("s1");
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
  });

  it("the new-session bucket does not leak into an existing session", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    pushPanes(undefined);
    openPanel("diff");

    // Switching to an existing session swaps in its own (empty) group…
    pushPanes("s2");
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();

    // …and returning to the new-session state restores the bucket.
    pushPanes(undefined);
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
  });

  it("a deleted session forgets its panel group", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    pushTree(["s1", "s2"]);
    pushPanes("s1");
    openPanel("diff");

    // While s1 lives in the sidebar tree its group survives switches.
    pushPanes("s2");
    pushPanes("s1");
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();

    // Deleting s1 (gone from the tree, no pane bound to it) prunes it.
    pushPanes("s2");
    pushTree(["s2"]);
    pushPanes("s1");
    expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
  });

  it("a URL typed into the preview address bar survives a session switch (restored on return)", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    pushTree(["s1", "s2"]);
    pushPanes("s1");
    openPanel("preview");

    // Blank preview tab — type a URL into the address bar and commit it.
    const input = screen.getByTestId("preview-address-input");
    fireEvent.change(input, { target: { value: "localhost:8899/" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Guest never became dom-ready in jsdom: the initial src is retargeted.
    expect(
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
    ).toBe("http://localhost:8899/");

    // The guest loads and reports its real address.
    const wv = screen
      .getByTestId("preview-pane")
      .querySelector("webview") as Element;
    fireEvent(
      wv,
      Object.assign(new Event("did-navigate"), {
        url: "http://localhost:8899/",
      }),
    );

    // Switch to s2 (no cached preview) and back: the typed URL is a part of
    // s1's remembered panel group and must come back with it.
    pushPanes("s2");
    expect(screen.queryByTestId("preview-pane")).not.toBeInTheDocument();
    pushPanes("s1");
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
    ).toBe("http://localhost:8899/");
    expect(screen.getByTestId("panel-tab-preview-1")).toHaveTextContent(
      "localhost:8899",
    );
  });

  it("switching sessions exits preview fullscreen so the new conversation is never hidden", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    pushTree(["s1", "s2"]);
    pushPanes("s1");
    openPanel("preview");
    const previewPane = screen.getByTestId("preview-pane");
    const body = previewPane.closest(".desktop-chat-body") as HTMLElement;

    // Fullscreen the s1 preview: the conversation column unmounts.
    fireEvent.click(screen.getByTestId("panel-fullscreen"));
    expect(body).toHaveClass("preview-fullscreen");
    expect(body.querySelector(".desktop-chat-main")).toBeNull();

    // Switch to s2 (no panel group of its own). Fullscreen belongs to s1's
    // preview — it must not survive into s2, or the new conversation would be
    // hidden behind a stale fullscreen with no UI left to exit it (PM bug
    // 3465519197988352「预览全屏叉掉后对话框消失」).
    pushPanes("s2");
    expect(body).not.toHaveClass("preview-fullscreen");
    expect(body.querySelector(".desktop-chat-main")).not.toBeNull();
  });

  it("single (pane-less) layout: switching the current session exits preview fullscreen", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    // No desktopPanes push → the root ChatApp layout with its own current
    // session; switching conversations there is a new updateCurrentSession on
    // the SAME mounted instance (no group rebind to fall back on).
    const s1 = {
      id: "s1",
      sessionType: "main",
      workdir: "/work/a",
      firstMessage: "s1",
      lastActiveAt: Date.now(),
      latestTotalTokens: 0,
    };
    const s2 = { ...s1, id: "s2", firstMessage: "s2" };
    act(() => {
      sendCommand("updateCurrentSession", { session: s1 });
    });

    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-empty-item-preview"));
    fireEvent.click(screen.getByTestId("panel-fullscreen"));
    const body = screen
      .getByTestId("preview-pane")
      .closest(".desktop-chat-body") as HTMLElement;
    expect(body).toHaveClass("preview-fullscreen");
    expect(body.querySelector(".desktop-chat-main")).toBeNull();

    // Switch conversation: fullscreen must not survive into s2 — with no UI
    // left visible it could never be exited otherwise (PM bug
    // 3465519197988352「预览全屏叉掉后对话框消失」).
    act(() => {
      sendCommand("updateCurrentSession", { session: s2 });
    });
    expect(body).not.toHaveClass("preview-fullscreen");
    expect(body.querySelector(".desktop-chat-main")).not.toBeNull();
  });
});

/**
 * Remote preview + SSH port forwarding (spec scenarios 15-18): clicking a
 * localhost link in a remote session requests an ssh -N -L forward from the
 * main process, the rewritten reply loads in the preview pane, re-clicking the
 * same link is a no-op (no duplicate tunnel), failures surface an actionable
 * error with a retry that re-establishes the forward. Tunnels are
 * session-scoped: closing the panel, switching sessions/hosts or unmounting
 * never releases them — only deleting the session (or the app quitting) does.
 */
describe("remote preview port forwarding", () => {
  const session = (sessionId: string) => ({
    sessionId,
    title: sessionId,
    lastActiveAt: Date.now(),
    hasWorktree: false,
  });
  const pushRemotePane = () =>
    sendHostMessage(
      fixtures.desktopPanes({
        panes: [
          {
            paneId: "pane-1",
            sessionId: "s1",
            row: 0,
            host: "prod",
            width: 0.5,
          },
        ],
        focusedPaneId: "pane-1",
      }),
    );
  const openLink = (url = "http://localhost:5173/app") => {
    sendHostMessage(
      fixtures.updateMessages(
        [MockDataGenerator.createAssistantMessage(`服务在 [这里](${url})`)],
        { paneId: "pane-1" },
      ),
    );
    fireEvent.click(screen.getByText("这里"));
  };
  const forwardPosts = (vscode: ReturnType<typeof createMockVscode>) =>
    vscode.postMessage.mock.calls
      .filter(([msg]) => msg.command === "desktopForwardPort")
      .map(([msg]) => msg);
  const releasePosts = (vscode: ReturnType<typeof createMockVscode>) =>
    vscode.postMessage.mock.calls
      .filter(([msg]) => msg.command === "desktopReleasePort")
      .map(([msg]) => msg);

  it("clicking a localhost link in a remote session requests a forward on the pane host", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink();

    // The pane's own host is used (not the local fallback), and the preview
    // panel opens in its connecting stub while the tunnel comes up. The
    // message carries the bound session id so the host scopes the tunnel's
    // lifetime to it (scenario 18).
    expect(forwardPosts(vscode)).toEqual([
      {
        command: "desktopForwardPort",
        host: "prod",
        url: "http://localhost:5173/app",
        requestId: "fwd-1",
        paneId: "pane-1",
        sessionId: "s1",
      },
    ]);
    expect(screen.getByTestId("preview-pane-empty")).toBeInTheDocument();
    // The empty stub hosts the blank-tab PreviewPane: address bar is ready
    // for typing a URL while the tunnel comes up.
    expect(screen.getByTestId("preview-address-input")).toBeInTheDocument();
  });

  it("the forward reply loads the rewritten address in the preview pane", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink();

    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });

    const pane = screen.getByTestId("preview-pane");
    expect(pane.querySelector("webview")?.getAttribute("src")).toBe(
      "http://127.0.0.1:5173/app",
    );
    expect(screen.queryByTestId("preview-pane-empty")).not.toBeInTheDocument();
    // The forwarded URL is cached against the session: the tunnel is
    // session-scoped and survives remounts, so switching away and back
    // restores this same address (spec 场景 9).
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopPanelState",
        checked: expect.arrayContaining(["preview"]),
      }),
    );
  });

  it("clicking the same link again does not re-establish the forward", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink();
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });

    fireEvent.click(screen.getByText("这里"));

    expect(forwardPosts(vscode)).toHaveLength(1);
  });

  it("an equivalent loopback spelling of the same link reuses the forward", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink();
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });

    // 127.0.0.1 is the same remote service as localhost — the forward must
    // not be released and re-established (tunnel churn).
    openLink("http://127.0.0.1:5173/app");

    expect(forwardPosts(vscode)).toHaveLength(1);
    expect(releasePosts(vscode)).toHaveLength(0);
    expect(
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
    ).toBe("http://127.0.0.1:5173/app");
  });

  it("clicking a link on a different port does not release the tunnel", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink("http://localhost:5173/app");
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });

    // Same conversation, different service: a NEW preview tab opens and a new
    // forward is requested, but the session's tunnels are NOT released —
    // deletion is the only teardown (scenario 18).
    openLink("http://localhost:8080/other");
    expect(releasePosts(vscode)).toHaveLength(0);
    expect(forwardPosts(vscode)).toHaveLength(2);
    expect(forwardPosts(vscode)[1]).toMatchObject({
      host: "prod",
      url: "http://localhost:8080/other",
    });

    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-2",
      url: "http://127.0.0.1:8080/other",
      originalUrl: "http://localhost:8080/other",
    });
    // The second preview tab is active and shows the second URL.
    expect(screen.getAllByTestId("preview-pane")).toHaveLength(2);
    expect(
      activePane("preview-pane")?.querySelector("webview")?.getAttribute("src"),
    ).toBe("http://127.0.0.1:8080/other");
  });

  it("a same-origin link with a different path reuses the tunnel (no release)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink("http://localhost:5173/app");
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });

    // Same service, different path: the tunnel keys on host+port, so the
    // old forward is NOT released — the host reuses the established
    // tunnel for the new path.
    openLink("http://localhost:5173/other");
    expect(releasePosts(vscode)).toHaveLength(0);
    expect(forwardPosts(vscode)).toHaveLength(2);

    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-2",
      url: "http://127.0.0.1:5173/other",
      originalUrl: "http://localhost:5173/other",
    });
    expect(
      activePane("preview-pane")?.querySelector("webview")?.getAttribute("src"),
    ).toBe("http://127.0.0.1:5173/other");
  });

  it("a failed forward shows an actionable error; retry re-acquires and loads", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink();

    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      error: "转发建立超时：无法连接远端主机 prod",
    });

    const empty = screen.getByTestId("preview-pane-empty");
    expect(empty).toHaveTextContent(
      "远程预览加载失败：转发建立超时：无法连接远端主机 prod",
    );
    fireEvent.click(screen.getByTestId("preview-forward-retry"));

    // Retry is a fresh acquire (new requestId), not a silent reload.
    expect(forwardPosts(vscode)).toHaveLength(2);
    expect(forwardPosts(vscode)[1]).toMatchObject({
      host: "prod",
      requestId: "fwd-2",
    });

    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-2",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });
    const pane = screen.getByTestId("preview-pane");
    expect(pane.querySelector("webview")?.getAttribute("src")).toBe(
      "http://127.0.0.1:5173/app",
    );
    expect(screen.queryByTestId("preview-pane-empty")).not.toBeInTheDocument();
  });

  it("closing the preview panel keeps the tunnel alive (session-scoped)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink();

    fireEvent.click(screen.getByTestId("panel-tab-close-preview-1"));

    // The tunnel is scoped to the session, not the pane (scenario 18):
    // closing the preview panel must not release the forward, and must not
    // re-request it either.
    expect(releasePosts(vscode)).toHaveLength(0);
    expect(forwardPosts(vscode)).toHaveLength(1);
  });

  it("unmounting the pane (session still in the tree) keeps the tunnel alive", () => {
    window.waveHostType = "desktop";
    const { vscode, unmount } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink();
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();

    // The pane unmounts (split closed, pane moved across rows) while s1
    // stays in the session tree: the tunnel is session-scoped and must
    // survive — no release message (scenario 18).
    unmount();

    expect(releasePosts(vscode)).toHaveLength(0);
    expect(forwardPosts(vscode)).toHaveLength(1);
  });

  it("re-checking the preview panel restores the forwarded URL", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink();
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();

    // Close the panel, then re-open it from the empty state.
    fireEvent.click(screen.getByTestId("panel-tab-close-preview-1"));
    expect(screen.getByTestId("panel-empty-state")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("panel-empty-item-preview"));

    // Browser-tab semantics: closing destroyed the tab, so re-opening starts
    // a NEW blank preview tab. The tunnel stays held the whole time — no
    // release, no re-acquire (nothing was clicked to load).
    expect(screen.getByTestId("preview-pane-empty")).toBeInTheDocument();
    expect(forwardPosts(vscode)).toHaveLength(1);
  });

  it("switching host keeps the tunnel alive and the preview URL cached", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink();
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();

    // Host switch (remote → local): the tunnel is session-scoped — no
    // release. The pane's preview keeps its URL (still cached, still loads
    // through the live tunnel), so switching back shows it unchanged.
    sendHostMessage(
      fixtures.desktopPanes({
        panes: [
          {
            paneId: "pane-1",
            sessionId: "s1",
            row: 0,
            host: "local",
            width: 0.5,
          },
        ],
        focusedPaneId: "pane-1",
      }),
    );

    expect(releasePosts(vscode)).toHaveLength(0);
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
    ).toBe("http://127.0.0.1:5173/app");
  });

  it("switching to another session and back restores the remote preview URL (spec 场景 9)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1"), session("s2")],
          },
        ],
      }),
    );
    pushRemotePane();
    openLink();
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();

    // Switch to s2 (local host): no release, and the pane shows s2's own
    // (empty) preview state.
    sendHostMessage(
      fixtures.desktopPanes({
        panes: [
          {
            paneId: "pane-1",
            sessionId: "s2",
            row: 0,
            host: "local",
            width: 0.5,
          },
        ],
        focusedPaneId: "pane-1",
      }),
    );
    expect(releasePosts(vscode)).toHaveLength(0);
    // s2 has no cached panel state — the preview slot is not mounted.
    expect(screen.queryByTestId("preview-pane")).not.toBeInTheDocument();

    // Switch back to s1: the forwarded URL is restored from the session
    // cache, and the tunnel was never released — no re-acquire needed.
    sendHostMessage(
      fixtures.desktopPanes({
        panes: [
          {
            paneId: "pane-1",
            sessionId: "s1",
            row: 0,
            host: "prod",
            width: 0.5,
          },
        ],
        focusedPaneId: "pane-1",
      }),
    );
    expect(
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
    ).toBe("http://127.0.0.1:5173/app");
    expect(forwardPosts(vscode)).toHaveLength(1);
    expect(releasePosts(vscode)).toHaveLength(0);
  });

  it("a stale forward reply for a released request is dropped", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    openLink();
    // Fail, then retry: the current request is now fwd-2.
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      error: "连接失败",
    });
    fireEvent.click(screen.getByTestId("preview-forward-retry"));
    expect(forwardPosts(vscode)[1].requestId).toBe("fwd-2");

    // A late fwd-1 reply (for the superseded attempt) must not load a URL
    // A late fwd-1 reply (for the superseded attempt) must not load a URL
    // or resurrect the error behind the retry's back — it is dropped, and
    // the stub stays in its connecting state awaiting the fwd-2 result.
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });
    // Still the empty stub: the blank-tab PreviewPane is mounted (address
    // bar ready) but no URL was loaded.
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();
    expect(screen.getByTestId("preview-pane-empty")).toBeInTheDocument();
    expect(screen.getByTestId("preview-address-input")).toBeInTheDocument();
  });

  it("rebinding the pane to another session keeps both sessions' tunnels", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [session("s1"), session("s2")],
          },
        ],
      }),
    );
    pushRemotePane();
    openLink();
    expect(forwardPosts(vscode)).toHaveLength(1);

    // Rebind the pane to s2 (another remote host) and open a different
    // URL there: a SECOND tunnel is requested — s1's stays held, because
    // tunnels are owned by sessions, not by the pane (scenario 18).
    sendHostMessage(
      fixtures.desktopPanes({
        panes: [
          {
            paneId: "pane-1",
            sessionId: "s2",
            row: 0,
            host: "prod2",
            width: 0.5,
          },
        ],
        focusedPaneId: "pane-1",
      }),
    );
    openLink("http://localhost:8080/app");
    expect(forwardPosts(vscode)).toHaveLength(2);
    expect(forwardPosts(vscode)[1]).toMatchObject({
      host: "prod2",
      url: "http://localhost:8080/app",
      sessionId: "s2",
    });

    // s2's forward reply updates s2's preview only.
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-2",
      url: "http://127.0.0.1:8080/app",
      originalUrl: "http://localhost:8080/app",
    });
    expect(
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
    ).toBe("http://127.0.0.1:8080/app");

    // A late reply for s1's forward (fwd-1) lands in s1's cached session
    // state instead of being dropped — the pane rebinding must not lose
    // s1's URL for when the user switches back.
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });
    // The pane still shows s2's URL (s1's cached URL is untouched here).
    expect(
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
    ).toBe("http://127.0.0.1:8080/app");

    // Switch back to s1: its own forwarded URL shows again from the session
    // cache; neither tunnel was ever released.
    sendHostMessage(
      fixtures.desktopPanes({
        panes: [
          {
            paneId: "pane-1",
            sessionId: "s1",
            row: 0,
            host: "prod",
            width: 0.5,
          },
        ],
        focusedPaneId: "pane-1",
      }),
    );
    expect(
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
    ).toBe("http://127.0.0.1:5173/app");
    expect(forwardPosts(vscode)).toHaveLength(2);
    expect(releasePosts(vscode)).toHaveLength(0);
  });

  it("picker comments in a remote preview land in the chat input (URL rewritten to the original remote address)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: [session("s1")] },
        ],
      }),
    );
    pushRemotePane();
    // The host always pushes a pane snapshot on session switch, including
    // the (possibly empty) input draft — see desktopHost.ts pushPaneSessionState.
    sendCommand("setInitialState", {
      paneId: "pane-1",
      messages: [],
      inputContent: "",
      isAuthenticated: true,
    });
    openLink();
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });

    const wv = screen
      .getByTestId("preview-pane")
      .querySelector("webview") as unknown as Omit<
      WebviewTagElement,
      "send" | "loadURL" | "reload" | "reloadIgnoringCache" | "getURL"
    > & {
      send: ReturnType<typeof vi.fn>;
      loadURL: ReturnType<typeof vi.fn>;
      reload: ReturnType<typeof vi.fn>;
      reloadIgnoringCache: ReturnType<typeof vi.fn>;
      getURL: ReturnType<typeof vi.fn>;
    };
    wv.send = vi.fn();
    wv.loadURL = vi.fn().mockResolvedValue(undefined);
    wv.reload = vi.fn();
    wv.reloadIgnoringCache = vi.fn();
    wv.getURL = vi.fn(() => "http://127.0.0.1:5173/app");
    fireEvent(wv, new Event("dom-ready"));
    fireEvent(
      wv,
      Object.assign(new Event("ipc-message"), {
        channel: "wave-picker",
        args: [{ type: "ready" }],
      }),
    );
    fireEvent.click(screen.getByTestId("preview-picker-toggle"));

    // The picker submits the tunnel URL (the guest's location.href); the
    // pane rewrites it back to the original remote address before appending.
    fireEvent(
      wv,
      Object.assign(new Event("ipc-message"), {
        channel: "wave-picker",
        args: [
          {
            type: "submit",
            url: "http://127.0.0.1:5173/app",
            selector: "#app > button",
            summary: "button",
            text: "登录",
            comment: "远程评论要进输入框",
          },
        ],
      }),
    );

    const input = screen.getByTestId("message-input") as HTMLElement;
    expect(input.textContent).toContain("远程评论要进输入框");
    expect(input.textContent).toContain("http://localhost:5173/app");
    // Nothing is sent directly — the user reviews the batch and sends manually.
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });
});

describe("desktop plan panel", () => {
  it("ExitPlanMode showConfirmation auto-opens the plan panel with the plan and keeps the dialog compact", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });

    sendCommand("showConfirmation", {
      confirmationId: "conf_plan_1",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      confirmationType: "计划待确认",
      planContent: "## 重构方案\n- 步骤一\n- 步骤二",
    });

    // The plan panel is auto-opened (visible, not display:none).
    const pane = screen.getByTestId("plan-pane");
    expect(pane).toBeInTheDocument();
    expect(pane.parentElement).not.toHaveStyle({ display: "none" });
    // The plan full text renders in the panel, not the confirmation dialog.
    const content = screen.getByTestId("plan-pane-content");
    expect(content.querySelector("h2")).toHaveTextContent("重构方案");
    expect(content.querySelectorAll("li")).toHaveLength(2);
    expect(
      document.querySelector(".plan-content-preview"),
    ).not.toBeInTheDocument();
    // The host is told the plan panel is checked (menu checkbox state).
    expect(lastPanelState(vscode)).toContain("plan");
  });

  it("re-checks an ExitPlanMode plan update into an already-open panel", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });

    sendCommand("showConfirmation", {
      confirmationId: "conf_plan_1",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      confirmationType: "计划待确认",
      planContent: "## v1\n- 旧步骤",
    });
    sendCommand("showConfirmation", {
      confirmationId: "conf_plan_2",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      confirmationType: "计划待确认",
      planContent: "## v2\n- 新步骤",
    });

    const content = screen.getByTestId("plan-pane-content");
    expect(content.querySelector("h2")).toHaveTextContent("v2");
    expect(content.querySelectorAll("li")).toHaveLength(1);
    // Single pane reused — only one plan panel instance.
    expect(screen.getAllByTestId("plan-pane")).toHaveLength(1);
    expect(lastPanelState(vscode)).toContain("plan");
  });

  it("keeps the plan after approval until the user closes the panel", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });

    sendCommand("showConfirmation", {
      confirmationId: "conf_plan_1",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      confirmationType: "计划待确认",
      planContent: "## 重构方案\n- 步骤一",
    });
    // Approve: dialog closes, plan panel stays.
    fireEvent.click(
      document.querySelector(".confirmation-btn-apply") as HTMLElement,
    );
    expect(
      document.querySelector(".confirmation-dialog"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-pane")).toBeInTheDocument();
    expect(screen.getByTestId("plan-pane-content")).toHaveTextContent(
      "重构方案",
    );

    // User closes the panel — the last tab closes and the (still expanded)
    // panel falls back to its empty state.
    fireEvent.click(screen.getByTestId("panel-tab-close-plan-1"));
    expect(screen.getByTestId("panel-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-pane")).not.toBeInTheDocument();
  });

  it("the header toggle opens the plan panel in its empty state (no plan yet)", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });

    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-empty-item-plan"));

    const pane = screen.getByTestId("plan-pane");
    expect(pane).toBeInTheDocument();
    expect(pane).toHaveTextContent("等待计划生成…");
  });

  it("split-view pane: ExitPlanMode after AskUserQuestion/EnterPlanMode opens the plan panel with the plan", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    // Split-view layout: pane-1 is bound to session s1 (DesktopShell renders a
    // paneId-scoped ChatApp; pane-tagged host messages route by paneId).
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [
              {
                sessionId: "s1",
                title: "s1",
                lastActiveAt: Date.now(),
                hasWorktree: false,
              },
            ],
          },
        ],
      }),
    );
    sendHostMessage(
      fixtures.desktopPanes({
        panes: [
          {
            paneId: "pane-1",
            sessionId: "s1",
            row: 0,
            host: "local",
            width: 0.5,
          },
        ],
        focusedPaneId: "pane-1",
      }),
    );
    // The pane-scoped ChatApp mounts on desktopPanes; initialize it (pane-
    // tagged snapshot) so the input area — and the confirmation dialogs that
    // render inside it — appear instead of the sweep loading animation.
    sendCommand("setInitialState", { messages: [], paneId: "pane-1" });

    const ask = (
      toolName: string,
      confirmationId: string,
      extra: Record<string, unknown> = {},
    ) =>
      sendCommand("showConfirmation", {
        confirmationId,
        toolName,
        confirmationType: "计划待确认",
        paneId: "pane-1",
        ...extra,
      });
    // Full permission sequence like the real agent flow: AskUserQuestion →
    // approve → EnterPlanMode → approve → ExitPlanMode (carrying the plan).
    ask("AskUserQuestion", "conf_q_1", {
      toolInput: {
        questions: [
          {
            question: "plan?",
            options: [{ label: "先做 plan", description: "" }],
            multiSelect: false,
          },
        ],
      },
    });
    fireEvent.click(
      document.querySelector(
        '.option-item[data-option-index="0"] input[type="radio"]',
      ) as HTMLElement,
    );
    fireEvent.click(
      document.querySelector(
        ".question-navigation .confirmation-btn-apply",
      ) as HTMLElement,
    );
    ask("EnterPlanMode", "conf_epm_1");
    fireEvent.click(
      document.querySelector(".confirmation-btn-apply") as HTMLElement,
    );
    ask(EXIT_PLAN_MODE_TOOL_NAME, "conf_exit_1", {
      planContent: "## 分屏方案\n- 步骤一",
    });

    const content = screen.getByTestId("plan-pane-content");
    expect(content.querySelector("h2")).toHaveTextContent("分屏方案");
    expect(content.querySelectorAll("li")).toHaveLength(1);
  });
});
