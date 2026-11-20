/**
 * 桌面端全新会话打开右侧面板时的欢迎页布局。
 *
 * 迁移自 `e2e/desktop-welcome-panel.e2e.ts`（回归用例）：在全新会话上打开右侧
 * 面板（例：计划）曾经把整块欢迎页（品牌标 + 输入卡片）向左推半个面板宽 ——
 * 欢迎页 chat body 的 `justify-content: center` 会把 [chat-main(100%) + 面板]
 * 这一组居中，面板又不收缩（`flex-shrink: 0`），溢出就压到侧栏上。欢迎页那一组
 * 必须留在消息列里（面板左边那块空间）。
 *
 * 几何断言只能在真浏览器里量（`getBoundingClientRect`），所以这套跟着 browser
 * project 跑。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import {
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";
import { sendCommand } from "./test-utils";

const WORKDIR = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 某个选择器的盒（不存在时直接报出选择器，而不是 `TypeError`）。 */
function box(selector: string) {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  return el.getBoundingClientRect();
}

describe("Desktop welcome page with a side panel", () => {
  it("welcome group stays inside the message column when a panel is open", async () => {
    await page.viewport(1400, 900);

    // 桌面端布局只在 desktopWorkdirState 之后才挂 ChatApp，所以初值要等挂载后的
    // 消息监听器就位再推 —— 早推的 setInitialState 会落进空档被丢掉。
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: WORKDIR,
      recentWorkdirs: [WORKDIR],
    });
    sendCommand("setInitialState", initialState);

    await expect
      .poll(() => isVisible('[data-testid="welcome-wordmark"]'))
      .toBe(true);

    // Open the 计划 panel from the header toggle (empty slot → empty-state
    // entry; tabs render once a panel is open).
    await userEvent.click(screen.getByTestId("panel-toggle-btn"));
    await userEvent.click(screen.getByTestId("panel-empty-item-plan"));
    await expect.poll(() => isVisible('[data-testid="plan-pane"]')).toBe(true);

    const body = box(".desktop-chat-body");
    const main = box(".desktop-chat-main");
    const input = box(".input-wrapper");
    const welcome = box('[data-testid="welcome-wordmark"]');

    // The message column must not spill left of the chat body (no overflow
    // onto the sidebar), and the input card must sit fully inside it.
    expect(main.left).toBeGreaterThanOrEqual(body.left - 1);
    expect(input.left).toBeGreaterThanOrEqual(body.left - 1);
    expect(welcome.left).toBeGreaterThanOrEqual(body.left - 1);

    // Welcome group centered horizontally within the message column.
    const mainCenter = (main.left + main.right) / 2;
    const inputCenter = (input.left + input.right) / 2;
    expect(Math.abs(inputCenter - mainCenter)).toBeLessThan(2);

    // The message column ends where the panel begins (shares the row).
    expect(main.right).toBeLessThanOrEqual(body.right + 1);
  });
});
