/**
 * `/reload-plugins` 入口（桌面模式，与真 bundle 同一份 DOM）——
 * spec `ecosystem/plugin.md`「插件变更的就地重载」场景 12–13：插件变更不重建任何
 * 会话（「立即重启 / 稍后重启」整体废止），真正换装由用户敲 `/reload-plugins`
 * 触发：该命令不进对话、不产生用户消息，只回一条 `reloadPlugins` 给宿主去就地换装。
 *
 * 「待应用」信号的呈现见「插件变更提示」（2026-09-23 需求九）：桌面端不再发顶部轻
 * 提示，而是弹一个**强引导**确认框——点「立即重新加载」回发同一条 `reloadPlugins`
 * 命令，点「稍后」则不重载。
 *
 * 迁移自 `e2e/desktop-reload-plugins.e2e.ts`：输入框清空、回执报文、确认框是否出现
 * 与可用都在真 Chromium 里按真键盘验一遍（`userEvent` 走 CDP 真输入）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
} from "./desktopHarness";

const WORKDIR = "/Users/dev/projects/wave-agent";

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 起一个桌面分屏（空对话）。`mark` = 此刻已发过几条，之后只看它之后的切片。 */
function boot() {
  const { vscode } = renderDesktopApp();
  bootDesktop({ workdir: WORKDIR });
  return { vscode, mark: sentCommands(vscode).length };
}

/**
 * 从 `mark` 之后发出的指令里找第一条 `command`。
 *
 * 等价于原文的 `injector.clearMessageLog()` + `getMessagesSentToExtension()`：
 * 桌面端会给报文附带 paneId，所以这里只比对 `command`（与单测同口径）。
 */
const postedSince = (
  vscode: { postMessage: unknown },
  mark: number,
  command: string,
) =>
  sentCommands(vscode)
    .slice(mark)
    .find((message) => message.command === command);

/** 屏上能找到「含这段文字」的元素（对齐 Playwright `getByText` 的可见判据）。 */
const hasVisibleText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("div, span, p")).some(
    (el) => {
      if (!(el.textContent ?? "").includes(text)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
  );

const dialogCount = () => document.querySelectorAll(".confirm-dialog").length;

/** 在消息输入框里敲一条斜杠命令并回车（真键盘）。 */
async function typeCommand(command: string) {
  const input = screen.getByTestId("message-input");
  await userEvent.click(input);
  await userEvent.keyboard(command);
  await userEvent.keyboard("{Enter}");
  return input;
}

describe("/reload-plugins", () => {
  it("敲命令只回 reloadPlugins：不进对话、输入框清空、无确认框", async () => {
    await page.viewport(1280, 800);
    const { vscode, mark } = boot();

    const input = await typeCommand("/reload-plugins");

    await expect
      .poll(() => postedSince(vscode, mark, "reloadPlugins")?.command)
      .toBe("reloadPlugins");
    // 不进对话：不得把它当普通消息发给模型。
    expect(postedSince(vscode, mark, "sendMessage")).toBeUndefined();
    await expect.poll(() => (input.textContent ?? "").trim()).toBe("");
    expect(dialogCount()).toBe(0);
  });

  it("插件变更落盘后弹强引导确认框，点「立即重新加载」回发 reloadPlugins", async () => {
    await page.viewport(1280, 800);
    const { vscode, mark } = boot();

    sendCommand("pluginChangePending");

    await expect.poll(dialogCount, { timeout: 4000 }).toBe(1);
    await expect
      .poll(() => hasVisibleText("插件已变更，重新加载后生效"))
      .toBe(true);
    // 只弹框、不自动重载：用户不点就什么都不发生。
    expect(postedSince(vscode, mark, "reloadPlugins")).toBeUndefined();
    // 顶部轻提示不再出现（它正是会被忽略的那个形态）。
    expect(hasVisibleText("插件已变更。运行 /reload-plugins 使其生效。")).toBe(
      false,
    );

    await userEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await expect
      .poll(() => postedSince(vscode, mark, "reloadPlugins")?.command)
      .toBe("reloadPlugins");
    await expect.poll(dialogCount).toBe(0);
  });

  it("点「稍后」只关掉弹窗、不重载；之后仍可手动敲命令补上", async () => {
    await page.viewport(1280, 800);
    const { vscode, mark } = boot();

    sendCommand("pluginChangePending");
    await expect.poll(dialogCount, { timeout: 4000 }).toBe(1);

    await userEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    await expect.poll(dialogCount).toBe(0);
    // 「稍后」不产生任何重载请求。
    expect(postedSince(vscode, mark, "reloadPlugins")).toBeUndefined();

    // 手动敲 /reload-plugins 仍照常可用（与改动前同一入口）。
    await typeCommand("/reload-plugins");
    await expect
      .poll(() => postedSince(vscode, mark, "reloadPlugins")?.command)
      .toBe("reloadPlugins");
  });
});
