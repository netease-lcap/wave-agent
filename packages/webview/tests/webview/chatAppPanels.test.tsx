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

  it("checking 差异 mounts the diff pane and requests the workspace diff", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));

    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopGetWorkspaceDiff",
    });
    // The menu stays open for consecutive multi-select.
    expect(screen.getByTestId("panel-toggle-menu")).toBeInTheDocument();
    expect(screen.getByTestId("panel-toggle-item-diff")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("multiple panels stack side-by-side in the fixed Preview→Diff→Terminal order", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-terminal"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-preview"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));

    const slots = document.querySelectorAll(".desktop-panel-slot");
    expect(slots).toHaveLength(3);
    expect(
      slots[0].querySelector('[data-testid="preview-pane-empty"]'),
    ).not.toBeNull();
    expect(slots[1].querySelector('[data-testid="diff-pane"]')).not.toBeNull();
    expect(
      slots[2].querySelector('[data-testid="terminal-pane"]'),
    ).not.toBeNull();
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
      fireEvent.click(screen.getByTestId("panel-toggle-item-preview"));

      const empty = screen.getByTestId("preview-pane-empty");
      expect(empty.style.width).toBe("420px"); // default width, no URL loaded yet
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

  it("unchecking hides the panel (display:none) but keeps it mounted", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument(); // still mounted
    expect(screen.getByTestId("diff-pane").parentElement).toHaveStyle({
      display: "none",
    });
    expect(screen.getByTestId("panel-toggle-item-diff")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    // Re-check shows the same mounted instance.
    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
    expect(screen.getByTestId("diff-pane").parentElement).not.toHaveStyle({
      display: "none",
    });
  });

  it("the panel close button unchecks it", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
    fireEvent.mouseDown(document.body); // dismiss the menu

    fireEvent.click(screen.getByTestId("diff-close"));
    expect(screen.getByTestId("diff-pane").parentElement).toHaveStyle({
      display: "none",
    });
  });

  it("reports toggle state to the host via desktopPanelState", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    // Initial report on mount.
    expect(lastPanelState(vscode)).toEqual([]);

    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
    expect(lastPanelState(vscode)).toEqual(["diff"]);

    fireEvent.click(screen.getByTestId("panel-toggle-item-terminal"));
    expect(lastPanelState(vscode)).toEqual(["diff", "terminal"]);

    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
    expect(lastPanelState(vscode)).toEqual(["terminal"]);
  });

  it("desktopTogglePanel from the host takes the same path as the menu", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(fixtures.desktopTogglePanel("diff"));
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(lastPanelState(vscode)).toEqual(["diff"]);

    sendHostMessage(fixtures.desktopTogglePanel("diff"));
    expect(screen.getByTestId("diff-pane").parentElement).toHaveStyle({
      display: "none",
    });
    expect(lastPanelState(vscode)).toEqual([]);
  });

  it("disables diff/terminal without a workdir; preview stays available", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop();
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));

    expect(screen.getByTestId("panel-toggle-item-diff")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByTestId("panel-toggle-item-terminal")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByTestId("panel-toggle-item-preview")).toHaveAttribute(
      "aria-disabled",
      "false",
    );

    fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
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
      fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
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
      fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
      expect(screen.queryByTestId("diff-pane")).not.toBeInTheDocument();
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "空间不足，无法开启面板",
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("auto-replaces the oldest checked panel when space runs out (spec 场景 1)", () => {
    window.waveHostType = "desktop";
    // 800px fits one 420px panel beside the 360px conversation minimum
    // (800 - 420 = 380), but not two — opening 终端 replaces the older 文件.
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 800, right: 800 } as DOMRect);
    try {
      const { vscode } = renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-file"));
      expect(screen.getByTestId("file-pane")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("panel-toggle-item-terminal"));
      expect(screen.getByTestId("terminal-pane")).toBeInTheDocument();
      // 文件 was the oldest checked panel — replaced (hidden, still mounted
      // so its content survives and re-checking restores it).
      expect(screen.getByTestId("file-pane").parentElement).toHaveStyle({
        display: "none",
      });
      expect(screen.getByTestId("terminal-pane").parentElement).not.toHaveStyle(
        { display: "none" },
      );
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "空间不足，已自动关闭「文件」面板",
      });
      expect(lastPanelState(vscode)).toEqual(["terminal"]);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("keeps evicting older panels until the new one fits and lists them all (spec 场景 2)", () => {
    window.waveHostType = "desktop";
    // 1620px holds three 420px panels + the 360px conversation minimum.
    let width = 1620;
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ width, right: width }) as DOMRect);
    try {
      const { vscode } = renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-file"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-terminal"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-preview"));
      expect(screen.getByTestId("preview-pane-empty")).toBeInTheDocument();

      // Window shrinks; a fourth panel needs more room than one eviction
      // frees — 文件 → 终端 → 预览 all get replaced before 差异 opens.
      width = 1000;
      fireEvent.click(screen.getByTestId("panel-toggle-item-diff"));
      expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
      expect(screen.getByTestId("diff-pane").parentElement).not.toHaveStyle({
        display: "none",
      });
      for (const testid of [
        "file-pane",
        "terminal-pane",
        "preview-pane-empty",
      ]) {
        // Replaced panels stay mounted (content preserved), just hidden.
        expect(screen.getByTestId(testid).parentElement).toHaveStyle({
          display: "none",
        });
      }
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "空间不足，已自动关闭「文件」「终端」「预览」面板",
      });
      expect(lastPanelState(vscode)).toEqual(["diff"]);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("refuses and closes nothing when even full eviction cannot fit (spec 场景 4)", () => {
    window.waveHostType = "desktop";
    // 1200px holds two 420px panels + the 360px conversation minimum.
    let width = 1200;
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ width, right: width }) as DOMRect);
    try {
      const { vscode } = renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-file"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-terminal"));
      expect(screen.getByTestId("file-pane")).toBeInTheDocument();
      expect(screen.getByTestId("terminal-pane")).toBeInTheDocument();

      // Narrower than the conversation minimum + one panel: even after every
      // old panel is evicted the new one cannot open — refuse and keep the
      // existing panels untouched (a failed replace must not take them down).
      width = 700;
      fireEvent.click(screen.getByTestId("panel-toggle-item-preview"));
      expect(
        screen.queryByTestId("preview-pane-empty"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("file-pane").parentElement).not.toHaveStyle({
        display: "none",
      });
      expect(screen.getByTestId("terminal-pane").parentElement).not.toHaveStyle(
        { display: "none" },
      );
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "空间不足，无法开启面板",
      });
      expect(lastPanelState(vscode)).toEqual(["file", "terminal"]);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("never replaces the panel being re-targeted (spec 场景 5)", () => {
    window.waveHostType = "desktop";
    // 1200px holds two 420px panels + the 360px conversation minimum.
    let width = 1200;
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ width, right: width }) as DOMRect);
    try {
      const { vscode } = renderDesktop({ workdir: "/work/a" });
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-toggle-item-file"));
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

      // Window shrinks below two-panel capacity; clicking a file path keeps
      // the 文件 panel (it is the one being re-targeted) and replaces 终端.
      width = 1100;
      fireEvent.click(path);
      expect(screen.getByTestId("file-pane").parentElement).not.toHaveStyle({
        display: "none",
      });
      expect(screen.getByTestId("terminal-pane").parentElement).toHaveStyle({
        display: "none",
      });
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopShowHint",
        text: "空间不足，已自动关闭「终端」面板",
      });
      expect(lastPanelState(vscode)).toEqual(["file"]);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("re-clicking another file path replaces the panel in place (spec 场景 6)", () => {
    window.waveHostType = "desktop";
    // 1000px fits the 420px file panel beside the 360px conversation
    // minimum. tryOpenPanel used to double-count an already-open panel's
    // own width in the fit check, overflowing the space and silently
    // spilling the panel out of view on the second click.
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

      const pane = screen.getByTestId("file-pane");
      expect(pane).toBeInTheDocument();
      expect(pane.closest(".desktop-panel-slot")).toHaveClass(
        "desktop-panel-slot",
      );

      // A different file link re-targets the same panel — the content
      // swaps but the panel stays mounted in place.
      sendCommand("updateMessages", {
        messages: [readMessage("/work/a/src/second.ts")],
      });
      fireEvent.click(
        document.querySelector(".write-tool-path") as HTMLElement,
      );

      expect(
        screen.getByTestId("file-pane").closest(".desktop-panel-slot"),
      ).toHaveClass("desktop-panel-slot");
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
  const pushPanes = (sessionId?: string) =>
    sendHostMessage(
      fixtures.desktopPanes({
        panes: [
          { paneId: "pane-1", sessionId, row: 0, host: "local", width: 0.5 },
        ],
        focusedPaneId: "pane-1",
      }),
    );
  const pushTree = (ids: string[]) =>
    sendHostMessage(
      fixtures.desktopSessionTree({
        groups: [
          { host: "local", workdir: "/work/a", sessions: ids.map(session) },
        ],
      }),
    );
  const openPanel = (kind: string) => {
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId(`panel-toggle-item-${kind}`));
    fireEvent.mouseDown(document.body); // dismiss the menu
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
    expect(screen.getByTestId("preview-pane-empty")).toHaveTextContent(
      "点击消息或终端中的 localhost 链接加载预览",
    );
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

    // Same conversation, different service: the panel re-targets and a new
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
    expect(
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
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
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
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

    fireEvent.click(screen.getByTestId("preview-close"));

    // The tunnel is scoped to the session, not the pane (scenario 18):
    // closing the preview panel must not release the forward, and must not
    // re-request it either. Re-checking the panel restores the same URL.
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

    // Close the panel, then re-open it from the 面板 menu.
    fireEvent.click(screen.getByTestId("preview-close"));
    expect(screen.getByTestId("preview-pane").parentElement).toHaveStyle({
      display: "none",
    });
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-preview"));

    // The URL survived the close — re-checking shows it directly, no new
    // forward request (the tunnel was never released).
    expect(
      screen
        .getByTestId("preview-pane")
        .querySelector("webview")
        ?.getAttribute("src"),
    ).toBe("http://127.0.0.1:5173/app");
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
    // or resurrect the error behind the retry's back — it is dropped, and
    // the stub stays in its connecting state awaiting the fwd-2 result.
    sendCommand("desktopForwardPortResult", {
      paneId: "pane-1",
      requestId: "fwd-1",
      url: "http://127.0.0.1:5173/app",
      originalUrl: "http://localhost:5173/app",
    });
    expect(screen.queryByTestId("preview-pane")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-pane-empty")).toHaveTextContent(
      "点击消息或终端中的 localhost 链接加载预览",
    );
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

    // User closes the panel — hidden but still mounted (content survives).
    fireEvent.click(screen.getByTestId("plan-close"));
    expect(screen.getByTestId("plan-pane").parentElement).toHaveStyle({
      display: "none",
    });
  });

  it("the header toggle opens the plan panel in its empty state (no plan yet)", () => {
    window.waveHostType = "desktop";
    renderDesktop({ workdir: "/work/a" });

    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-plan"));

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
