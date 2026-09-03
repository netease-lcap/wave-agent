import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { isMacHiddenTitlebar } from "../../src/utils/platform";
import { createMockVscode, sendHostMessage } from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

/**
 * macOS 隐藏标题栏（spec「macOS 隐藏标题栏」）：仅在真实 Electron desktop +
 * darwin 时侧边栏顶部渲染 44px 空拖拽行（系统红绿灯落位、不画假圆点）或收起态
 * 顶栏左端让位；Windows/Linux 与原型预览（无 wavePlatform/waveHostType）不受影响。
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
  it("renders an empty drag row (no fake dots) on real macOS", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "darwin";
    renderDesktopApp();

    expect(querySidebar()).not.toBeNull();
    expect(queryDragRow()).not.toBeNull();
    // The real OS traffic lights occupy the row's left — never draw fake dots.
    expect(queryFakeDots().length).toBe(0);
    expect(queryDragRow()!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders no window row on real Windows/Linux (native title bar kept)", () => {
    window.waveHostType = "desktop";
    window.wavePlatform = "win32";
    renderDesktopApp();

    expect(querySidebar()).not.toBeNull();
    expect(queryAnyWindowRow()).toBeNull();
  });

  it("keeps the fake traffic-dot row in browser previews (no waveHostType)", () => {
    renderDesktopApp();

    expect(querySidebar()).not.toBeNull();
    const row = queryAnyWindowRow();
    expect(row).not.toBeNull();
    expect(row!.classList.contains("sidebar-window-row--mac-drag")).toBe(false);
    expect(queryFakeDots().length).toBe(3);
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
