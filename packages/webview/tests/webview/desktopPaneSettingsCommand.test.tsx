/**
 * 桌面端 pane 布局下的斜杠命令：/config、/mcp 必须打开**全页设置页**并选中对应
 * 选项卡（spec agent-config.md 场景 5 回归）。
 *
 * 迁移自 `e2e/desktop-pane-settings-command.e2e.ts`。旧 bug：pane-scoped ChatApp 的
 * `settingsOpen` 是孤儿 state —— pane 自身不渲染设置视图，命令必须委托根实例，
 * 否则输入命令「没反应」（新对话时 `desktopPanes` 未推送、走单页分支所以正常，
 * 发过消息后失效；单 pane 与多 pane 均可复现）。
 *
 * 每条 pane 都要收到自己的 `setInitialState`（`initialized` / `isAuthenticated`）
 * 与历史消息：pane-scoped ChatApp 用 `forThisPane` 门控忽略无 paneId 的消息，真机
 * 由 `desktopHost` 在 pane 绑定时按 paneId 重推快照。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen, within } from "@testing-library/react";
import { MockDataGenerator } from "../fixtures/mockData";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

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

/** 推出一套 pane 布局，并给每个 pane 灌自己的快照与历史消息。 */
async function setupPanes(panes: Array<{ paneId: string; sessionId: string }>) {
  const result = renderDesktopApp();
  sendCommand("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  sendCommand("setInitialState", initialState);
  sendCommand("desktopPanes", {
    panes,
    focusedPaneId: panes[0].paneId,
  });
  for (const pane of panes) {
    sendCommand("setInitialState", {
      ...initialState,
      paneId: pane.paneId,
    });
    sendCommand("updateMessages", {
      paneId: pane.paneId,
      messages: [
        MockDataGenerator.createUserMessage(
          "修复登录页样式",
          `u-${pane.paneId}`,
        ),
        MockDataGenerator.createAssistantMessage(
          "我先看一下样式文件。",
          `a-${pane.paneId}`,
        ),
      ],
    });
  }
  await expect
    .poll(() => isVisible(`[data-testid="desktop-pane-${panes[0].paneId}"]`))
    .toBe(true);
  return result;
}

/** 在指定分屏的输入框里敲一条命令并回车。 */
async function typeAndEnter(paneId: string, text: string) {
  const pane = screen.getByTestId(`desktop-pane-${paneId}`);
  const input = within(pane).getByTestId("message-input");
  await userEvent.click(input);
  await userEvent.keyboard(text);
  await userEvent.keyboard("{Enter}");
}

/** 左导航里含 `label` 的那一项（图标 + 文字，按含文字找）。 */
const navItem = (label: string) =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      ".settings-navigation .settings-nav-item",
    ),
  ).find((el) => (el.textContent ?? "").includes(label));

/** 元素「可见」（对齐 Playwright 的 `toBeVisible`：有非空盒、不是 display/visibility 隐藏）。 */
const visibleBox = (el: Element | null): boolean => {
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

/** 屏上某段文字真的显示出来了（文字恰好是这段、且有非空盒）。 */
const visibleText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("p, span, div")).some(
    (el) => (el.textContent ?? "").trim() === text && visibleBox(el),
  );

/** 屏上某个标题真的显示出来了。 */
const visibleHeading = (name: string) =>
  screen.queryAllByRole("heading", { name }).some((el) => visibleBox(el));

describe("Desktop pane 布局斜杠命令打开设置页", () => {
  it("单 pane：/config 打开全页设置页并选中「全局设置」", async () => {
    await page.viewport(1280, 720);
    const { vscode } = await setupPanes([
      { paneId: "pane-1", sessionId: "sess-a1" },
    ]);
    await typeAndEnter("pane-1", "/config");

    // 全页设置页由根实例渲染（取代 pane 视图），全局设置选项卡激活
    await expect.poll(() => isVisible(".settings-page")).toBe(true);
    await expect
      .poll(() => visibleText("管理 CodeWave IDE 的界面、模型和基础行为。"))
      .toBe(true);
    await expect
      .poll(() => (navItem("全局设置")?.className ?? "").includes("is-active"))
      .toBe(true);

    // 命令被拦截消费，未作为消息发给 agent
    const sent = sentCommands(vscode);
    expect(
      sent.some(
        (message) =>
          message.command === "sendMessage" &&
          JSON.stringify(message).includes("/config"),
      ),
    ).toBe(false);
  });

  it("多 pane：pane-2 内 /mcp 打开设置页并选中「MCP 服务」", async () => {
    await page.viewport(1280, 720);
    await setupPanes([
      { paneId: "pane-1", sessionId: "sess-a1" },
      { paneId: "pane-2", sessionId: "sess-a2" },
    ]);
    await typeAndEnter("pane-2", "/mcp");

    await expect.poll(() => isVisible(".settings-page")).toBe(true);
    await expect
      .poll(() => (navItem("MCP 服务")?.className ?? "").includes("is-active"))
      .toBe(true);
    // MCP 视图标题可见（对应选项卡内容区渲染）
    await expect.poll(() => visibleHeading("MCP 服务")).toBe(true);
  });
});
