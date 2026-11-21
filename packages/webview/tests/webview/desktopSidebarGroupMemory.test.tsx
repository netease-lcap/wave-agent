/**
 * 侧栏分组折叠状态记忆（spec `docs/specs/desktop/desktop-sessions.md`「侧栏分组
 * 折叠状态记忆」）。
 *
 * 迁移自 `e2e/desktop-sidebar-group-memory.e2e.ts`。原文要证明的是 jsdom 单测给不了
 * 的那一半：状态真的落在**浏览器存储**里、并跨过一次页面重载（= 桌面端重启后
 * webview 重新加载）还在。原文为此专门换到 http origin，因为 `page.setContent` 的
 * 文档 origin 是 opaque 的 "null"，真实 Chromium 会拒掉 localStorage。
 *
 * browser mode 的测试页本来就跑在真 origin 上，所以 `localStorage` 与原文同一条
 * 路径；只有「页面重载」这一动作要换成等价手段：卸载整棵 `DesktopApp` 再重新挂载
 * ——`DesktopChromeContext` 的折叠态是组件 state（模块级缓存里没有副本，见
 * `src/components/DesktopChromeContext.tsx`），新挂载只从 `localStorage` 读回，
 * 所以「重载后仍折叠」与「重新挂载后仍折叠」是同一件事。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/shop-server";

/** 分组折叠态的存储键（`DesktopChromeContext` 的 SIDEBAR_GROUP_COLLAPSED_KEY）。 */
const GROUPS_KEY = "wave.desktopSidebarGroupCollapsed";

const treeSession = (sessionId: string, title: string) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
  running: false,
  waitingConfirmation: false,
});

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 注入一份两分组的会话树（「重启」前后各调用一次）。 */
function injectShell() {
  sendCommand("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A, DIR_B],
  });
  sendCommand("desktopSessionTree", {
    groups: [
      {
        host: "local",
        workdir: DIR_A,
        sessions: [treeSession("s1", "会话一")],
      },
      {
        host: "local",
        workdir: DIR_B,
        sessions: [treeSession("s2", "会话二")],
      },
    ],
  });
  sendCommand("setInitialState", initialState);
}

// 折叠态是 localStorage 持久化的（不是 `SessionUiStore`），上一个用例收起的分组
// 会让下一个用例一开局就少一行——与真实桌面端「重启后仍折叠」同一条路，所以必须
// 在挂载前清掉。
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

describe("Desktop sidebar group collapse memory", () => {
  it("keeps a collapsed group collapsed after the webview reloads", async () => {
    await page.viewport(960, 720);

    const first = renderDesktopApp();
    injectShell();

    // 两个分组默认都展开。
    await expect
      .poll(() => isVisible('[data-testid="desktop-session-main-s1"]'))
      .toBe(true);
    expect(isVisible('[data-testid="desktop-session-main-s2"]')).toBe(true);

    await userEvent.click(
      screen.getByRole("button", { name: "收起分组 wave-agent" }),
    );
    await expect
      .poll(
        () =>
          document.querySelectorAll('[data-testid="desktop-session-main-s1"]')
            .length,
      )
      .toBe(0);
    expect(isVisible('[data-testid="desktop-session-main-s2"]')).toBe(true);

    // 状态真的落在浏览器存储里 —— 桌面端重启后 webview 重新加载靠的就是它。
    // （落盘在 effect 里，所以等它写完再读。）
    await expect
      .poll(() => localStorage.getItem(GROUPS_KEY))
      .toBe(JSON.stringify({ [`local:${DIR_A}`]: true }));

    // 重启 = 整棵 DesktopApp 重新挂载：只有持久化下来的状态能跨过这一次。
    first.unmount();
    renderDesktopApp();
    injectShell();

    await expect
      .poll(
        () =>
          document.querySelectorAll('[data-testid="desktop-session-main-s1"]')
            .length,
      )
      .toBe(0);
    expect(isVisible(`[aria-label="展开分组 wave-agent"]`)).toBe(true);
    expect(isVisible('[data-testid="desktop-session-main-s2"]')).toBe(true);
  });
});
