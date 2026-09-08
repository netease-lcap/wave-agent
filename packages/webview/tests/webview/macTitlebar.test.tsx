import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { ChatApp } from "../../src/components/ChatApp";
import { DesktopChromeProvider } from "../../src/components/DesktopChromeContext";
import { isMacHiddenTitlebar } from "../../src/utils/platform";
import { createMockVscode, sendHostMessage, sendCommand } from "./test-utils";
import { fixtures } from "wave-webview-fixtures";
import { MockDataGenerator } from "../fixtures/mockData";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

/**
 * macOS 隐藏标题栏（spec「macOS 隐藏标题栏」）：仅在真实 Electron desktop +
 * darwin 时侧边栏顶部渲染 44px 窗口行（系统红绿灯落位 + 不画假圆点）——该行即
 * 侧边栏首行，红绿灯右侧同排「收起侧边栏」按钮（no-drag）；侧边栏收起时对话顶栏
 * 左端让位红绿灯拖拽区。Windows/Linux 与原型预览分别验证按钮回退位置/假圆点形态。
 */
function renderDesktopApp() {
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(
    fixtures.desktopWorkdirState({
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    }),
  );
  return { vscode, unmount: view.unmount };
}

const queryDragRow = () =>
  document.querySelector(".sidebar-window-row--mac-drag");
const queryAnyWindowRow = () => document.querySelector(".sidebar-window-row");
const queryFakeDots = () => document.querySelectorAll(".window-dot");
const queryTrafficSpacer = () =>
  document.querySelector(".chat-header-mac-traffic");
const querySidebar = () => document.querySelector(".desktop-sidebar");
const queryRowCollapse = () =>
  document.querySelector(
    '.sidebar-window-row [data-testid="desktop-sidebar-collapse"]',
  );
const queryHeaderCollapse = () =>
  document.querySelector(
    '.desktop-sidebar-actions [data-testid="desktop-sidebar-collapse"]',
  );

afterEach(() => {
  delete window.waveHostType;
  delete window.wavePlatform;
  localStorage.clear();
});

describe("isMacHiddenTitlebar", () => {
  it("is true only for the real Electron desktop host on darwin", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    expect(isMacHiddenTitlebar()).toBe(true);

    window.wavePlatform = "win32";
    expect(isMacHiddenTitlebar()).toBe(false);

    window.wavePlatform = "linux";
    expect(isMacHiddenTitlebar()).toBe(false);

    delete window.wavePlatform;
    expect(isMacHiddenTitlebar()).toBe(false);
  });

  it("is false for non-desktop hosts even on darwin", () => {
    window.waveHostType = "vscode";
    window.wavePlatform = "darwin";
    expect(isMacHiddenTitlebar()).toBe(false);
  });
});

describe("desktop titlebar row (sidebar expanded)", () => {
  it("renders a drag row hosting the collapse button (no fake dots) on macOS", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    renderDesktopApp();

    expect(querySidebar()).not.toBeNull();
    expect(queryDragRow()).not.toBeNull();
    // The real OS traffic lights occupy the row's left — never draw fake dots.
    expect(queryFakeDots().length).toBe(0);
    // The collapse button sits in the window row next to the traffic lights
    // (same row), not in the header's action group below.
    expect(queryRowCollapse()).not.toBeNull();
    expect(queryHeaderCollapse()).toBeNull();
    // The row now hosts an interactive control — must not be aria-hidden.
    expect(queryDragRow()!.getAttribute("aria-hidden")).toBeNull();
  });

  it("renders no window row on real Windows/Linux (native title bar kept)", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "win32";
    renderDesktopApp();

    expect(querySidebar()).not.toBeNull();
    expect(queryAnyWindowRow()).toBeNull();
    // Without a window row the collapse button stays in the header actions.
    expect(queryHeaderCollapse()).not.toBeNull();
  });

  it("keeps the fake traffic-dot row with a same-row collapse button in browser previews", () => {
    renderDesktopApp();

    expect(querySidebar()).not.toBeNull();
    const row = queryAnyWindowRow();
    expect(row).not.toBeNull();
    expect(row!.classList.contains("sidebar-window-row--mac-drag")).toBe(false);
    expect(queryFakeDots().length).toBe(3);
    // Mirror of the macOS layout: dots + collapse button share the window row.
    expect(queryRowCollapse()).not.toBeNull();
    expect(queryHeaderCollapse()).toBeNull();
  });

  it("collapsing from the window-row button still collapses the sidebar (macOS)", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    renderDesktopApp();

    expect(querySidebar()).not.toBeNull();
    fireEvent.click(screen.getByTestId("desktop-sidebar-collapse"));
    expect(querySidebar()).toBeNull();
    // The collapsed header reserves the traffic-light gutter as before.
    expect(queryTrafficSpacer()).not.toBeNull();
  });
});

describe("fullscreen collapses the traffic-light clearance (desktopFullScreen)", () => {
  it("slides the window-row collapse button to the row start while fullscreen", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    renderDesktopApp();

    const row = queryDragRow()!;
    expect(row.classList.contains("is-fullscreen")).toBe(false);

    // Enter fullscreen → the system traffic lights hide, the 68px gutter is
    // dropped (button returns to the row start).
    sendHostMessage(fixtures.desktopFullScreen({ fullScreen: true }));
    expect(row.classList.contains("is-fullscreen")).toBe(true);

    // Leave fullscreen → gutter restored.
    sendHostMessage(fixtures.desktopFullScreen({ fullScreen: false }));
    expect(row.classList.contains("is-fullscreen")).toBe(false);
  });

  it("drops the collapsed-header gutter while fullscreen and restores it after", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    localStorage.setItem("wave.desktopSidebarCollapsed", "1");
    renderDesktopApp();

    expect(queryTrafficSpacer()).not.toBeNull();
    sendHostMessage(fixtures.desktopFullScreen({ fullScreen: true }));
    expect(queryTrafficSpacer()).toBeNull();
    sendHostMessage(fixtures.desktopFullScreen({ fullScreen: false }));
    expect(queryTrafficSpacer()).not.toBeNull();
  });
});

describe("collapsed sidebar traffic-light clearance (real macOS)", () => {
  it("reserves a drag gutter at the chat header's left edge on macOS", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    localStorage.setItem("wave.desktopSidebarCollapsed", "1");
    renderDesktopApp();

    // Sidebar fully collapsed → nothing reserved on its side.
    expect(querySidebar()).toBeNull();
    // The header gutter clears the system traffic lights for the expand button.
    expect(queryTrafficSpacer()).not.toBeNull();
    expect(
      document.querySelector('[data-testid="desktop-sidebar-expand"]'),
    ).not.toBeNull();
  });

  it("renders no gutter on Windows/Linux (native title bar kept)", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "win32";
    localStorage.setItem("wave.desktopSidebarCollapsed", "1");
    renderDesktopApp();

    expect(querySidebar()).toBeNull();
    expect(queryTrafficSpacer()).toBeNull();
    // The collapsed leading controls still render — just without the clearance.
    expect(
      document.querySelector('[data-testid="desktop-sidebar-expand"]'),
    ).not.toBeNull();
  });
});

describe("split-view: collapsed gutter follows the shell's expand-button signal", () => {
  it("reserves the traffic-light gutter on the first pane after a runtime collapse", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    // localStorage starts expanded (the default) — the collapse happens at
    // runtime, after the pane-scoped ChatApp already mounted.
    renderDesktopApp();
    sendCommand("desktopSessionTree", {
      groups: [
        {
          workdir: "/work/a",
          sessions: [
            {
              sessionId: "s1",
              title: "chat one",
              lastActiveAt: Date.now(),
              hasWorktree: false,
            },
          ],
        },
      ],
    });
    sendCommand("desktopPanes", {
      panes: [{ paneId: "p1", sessionId: "s1", width: 1 }],
      focusedPaneId: "p1",
    });
    sendCommand("setInitialState", {
      messages: [MockDataGenerator.createUserMessage("hi")],
      paneId: "p1",
    });

    // Sidebar expanded → no gutter yet.
    expect(querySidebar()).not.toBeNull();
    expect(queryTrafficSpacer()).toBeNull();

    fireEvent.click(screen.getByTestId("desktop-sidebar-collapse"));

    // The first pane is flush with the window's left edge now: its header must
    // reserve the traffic-light gutter next to the expand button it received.
    expect(querySidebar()).toBeNull();
    expect(queryTrafficSpacer()).not.toBeNull();
    expect(
      document.querySelector('[data-testid="desktop-sidebar-expand"]'),
    ).not.toBeNull();
  });

  it("drops the gutter for a non-first pane (no expand button received)", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    localStorage.setItem("wave.desktopSidebarCollapsed", "1");
    renderDesktopApp();
    sendCommand("desktopSessionTree", {
      groups: [
        {
          workdir: "/work/a",
          sessions: [
            {
              sessionId: "s1",
              title: "chat one",
              lastActiveAt: Date.now(),
              hasWorktree: false,
            },
            {
              sessionId: "s2",
              title: "chat two",
              lastActiveAt: Date.now(),
              hasWorktree: false,
            },
          ],
        },
      ],
    });
    // Two panes: the second is not flush with the window's left edge, so the
    // shell hands the expand button to the first pane only.
    sendCommand("desktopPanes", {
      panes: [
        { paneId: "p1", sessionId: "s1", width: 0.5 },
        { paneId: "p2", sessionId: "s2", width: 0.5 },
      ],
      focusedPaneId: "p1",
    });
    sendCommand("setInitialState", {
      messages: [],
      paneId: "p1",
    });
    sendCommand("setInitialState", {
      messages: [MockDataGenerator.createUserMessage("hi")],
      paneId: "p2",
    });

    expect(querySidebar()).toBeNull();
    // Only one gutter for the first pane; the second pane's header stays clear.
    expect(document.querySelectorAll(".chat-header-mac-traffic")).toHaveLength(
      1,
    );
  });

  it("slides the window-row collapse button to the row start on fullscreen", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    // Any session activation runs through the pane model, so the shell owns the
    // sidebar window row — fullscreen must reach it through the shell too.
    renderDesktopApp();
    sendCommand("desktopSessionTree", {
      groups: [
        {
          workdir: "/work/a",
          sessions: [
            {
              sessionId: "s1",
              title: "chat one",
              lastActiveAt: Date.now(),
              hasWorktree: false,
            },
          ],
        },
      ],
    });
    sendCommand("desktopPanes", {
      panes: [{ paneId: "p1", sessionId: "s1", width: 1 }],
      focusedPaneId: "p1",
    });
    sendCommand("setInitialState", {
      messages: [MockDataGenerator.createUserMessage("hi")],
      paneId: "p1",
    });

    const row = queryDragRow();
    expect(row).not.toBeNull();
    expect(row!.classList.contains("is-fullscreen")).toBe(false);

    sendHostMessage(fixtures.desktopFullScreen({ fullScreen: true }));
    expect(row!.classList.contains("is-fullscreen")).toBe(true);
  });
});

// 设置页占满整个 view（spec desktop-account-and-settings「设置页面」场景 1/12 +
// desktop-shell「macOS 隐藏标题栏」设置页场景 8）：打开设置时会话侧边栏（分屏下
// 含全部 pane）一并被覆盖，红绿灯改由设置页左导航顶部的窗口行承接（窗口行不放
// 任何控件，整行即让位拖拽区、无假圆点；「返回」按钮位于窗口行下方单独一行），
// 全屏时该行整行收起（高度归零）；返回后布局原样恢复。
function renderDesktopChat(panes: Array<{ paneId: string }>) {
  const vscode = createMockVscode();
  const view = render(
    <DesktopChromeProvider>
      <ChatApp vscode={vscode} host={desktopHost(panes)} />
    </DesktopChromeProvider>,
  );
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

function desktopHost(panes: Array<{ paneId: string }>) {
  return {
    type: "desktop",
    host: "local",
    hosts: ["local"],
    recentWorkdirs: [],
    workdir: "/work/a",
    sessionTree: [],
    panes,
    focusedPaneId: panes[0]?.paneId,
    onSelectWorkdir: () => {},
    onSelectRecentWorkdir: () => {},
    onRemoveRecentWorkdir: () => {},
    onSelectHost: () => {},
    onAddHost: () => {},
    onSelectRemotePath: () => {},
    onListRemoteDir: () => {},
    onSelectSession: () => {},
    onDeleteSession: () => {},
    onOpenPane: () => {},
  } as unknown as React.ComponentProps<typeof ChatApp>["host"];
}

async function openSettingsByCommand() {
  const input = screen.getByTestId("message-input");
  input.focus();
  await act(async () => {
    input.textContent = "/config";
    const range = document.createRange();
    range.selectNodeContents(input);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.input(input, { data: "/config", inputType: "insertText" });
  });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText("管理 CodeWave IDE 的界面、模型和基础行为。");
}

const querySettingsWindowRow = () =>
  document.querySelector(".settings-window-row");
const querySettingsBack = () => document.querySelector(".settings-back");
const querySettingsBackInRow = () =>
  document.querySelector(".settings-window-row .settings-back");

describe("settings full-page: traffic lights hand to the settings nav (real macOS)", () => {
  it("covers the session sidebar; window row is an empty drag gutter, 返回 sits below it", async () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    // The host always pushes a pane layout at desktopReady (desktop-layout.md
    // 「启动即单个分屏」), so the shell — sidebar included — only renders with
    // panes > 0; an empty panes array is the handshake placeholder instead.
    renderDesktopChat([{ paneId: "pane-1" }]);

    // Single-pane desktop layout: sidebar visible before opening settings.
    expect(querySidebar()).not.toBeNull();
    await openSettingsByCommand();

    // Full-page settings — the conversation sidebar is covered (spec 场景 1).
    expect(querySidebar()).toBeNull();
    expect(document.querySelector(".settings-page")).not.toBeNull();
    // The settings nav's own window row takes over the traffic lights: it is an
    // empty drag gutter (no fake dots, no controls inside). 返回 is rendered on
    // its own row BELOW the gutter, not sharing the traffic-light row.
    const row = querySettingsWindowRow();
    expect(row).not.toBeNull();
    expect(row!.children.length).toBe(0);
    expect(querySettingsBackInRow()).toBeNull();
    expect(querySettingsBack()).not.toBeNull();
    expect(queryFakeDots().length).toBe(0);

    // 返回 closes settings and restores the sidebar.
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(querySettingsWindowRow()).toBeNull();
    expect(querySidebar()).not.toBeNull();
  });

  it("covers the split-view panes too and hands back on close (spec 场景 12)", async () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    renderDesktopChat([{ paneId: "pane-1" }]);

    expect(querySidebar()).not.toBeNull();
    await openSettingsByCommand();

    // DesktopShell bails out to the bare settings page — no sidebar, no panes.
    expect(querySidebar()).toBeNull();
    expect(document.querySelector(".desktop-pane-rows")).toBeNull();
    expect(document.querySelector(".settings-page")).not.toBeNull();
    expect(querySettingsWindowRow()).not.toBeNull();
    expect(querySettingsBack()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(querySidebar()).not.toBeNull();
    expect(document.querySelector(".desktop-pane-rows")).not.toBeNull();
  });

  it("collapses the settings window-row gutter on fullscreen and restores it", async () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    renderDesktopChat([{ paneId: "pane-1" }]);
    await openSettingsByCommand();

    const row = querySettingsWindowRow()!;
    expect(row.classList.contains("is-fullscreen")).toBe(false);
    sendHostMessage(fixtures.desktopFullScreen({ fullScreen: true }));
    expect(row.classList.contains("is-fullscreen")).toBe(true);
    sendHostMessage(fixtures.desktopFullScreen({ fullScreen: false }));
    expect(row.classList.contains("is-fullscreen")).toBe(false);
  });

  it("renders no settings window row on real Windows/Linux (native title bar kept)", async () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "win32";
    renderDesktopChat([{ paneId: "pane-1" }]);

    expect(querySidebar()).not.toBeNull();
    await openSettingsByCommand();

    // Settings still covers the whole view, but no traffic-light row exists —
    // the native title bar handles window dragging there. 返回 keeps its
    // original first-row spot with no gutter above it.
    expect(querySidebar()).toBeNull();
    expect(querySettingsWindowRow()).toBeNull();
    expect(querySettingsBack()).not.toBeNull();
  });
});
