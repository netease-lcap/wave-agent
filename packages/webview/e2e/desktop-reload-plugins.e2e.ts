import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * `/reload-plugins` 入口（真浏览器 + 真 bundle，桌面模式）——
 * spec ecosystem/plugin.md「插件变更的就地重载」场景 12–13：插件变更不重建任何
 * 会话（「立即重启 / 稍后重启」整体废止），真正换装由用户敲 `/reload-plugins`
 * 触发：该命令不进对话、不产生用户消息，只回一条 `reloadPlugins` 给宿主去就地换装。
 *
 * 「待应用」信号的呈现见「插件变更提示」（2026-09-23 需求九）：桌面端不再发顶部轻
 * 提示，而是弹一个**强引导**确认框——点「立即重新加载」回发同一条 `reloadPlugins`
 * 命令，点「稍后」则不重载。
 *
 * 单测（tests/webview/reloadPlugins.test.tsx）已覆盖这两条路径；这里在真 bundle +
 * 真 DOM 上确认输入框被清空、回执报文正确、确认框确实出现并可用。
 */

const WORKDIR = "/Users/dev/projects/wave-agent";

async function bootDesktop(page: Page) {
  const injector = new MessageInjector(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: WORKDIR,
    recentWorkdirs: [WORKDIR],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated: true,
    permissionMode: "default",
    workdir: WORKDIR,
  });
  return injector;
}

function postedMessage(page: Page, command: string): Promise<unknown> {
  return page.evaluate(
    (expected) =>
      (
        (
          window as unknown as { getTestMessages?: () => unknown[] }
        ).getTestMessages?.() ?? []
      ).find((m) => (m as { command?: string }).command === expected),
    command,
  );
}

test.describe("/reload-plugins", () => {
  test("敲命令只回 reloadPlugins：不进对话、输入框清空、无确认框", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage);
    const input = webviewPage.getByTestId("message-input");
    await input.click();
    await injector.clearMessageLog();
    await webviewPage.keyboard.type("/reload-plugins");
    await webviewPage.keyboard.press("Enter");

    // 桌面端会给报文附带 paneId，因此只比对 command（与单测同口径）。
    await expect
      .poll(async () => {
        const posted = (await postedMessage(webviewPage, "reloadPlugins")) as
          | Record<string, unknown>
          | undefined;
        return posted?.command;
      })
      .toBe("reloadPlugins");
    // 不进对话：不得把它当普通消息发给模型。
    expect(await postedMessage(webviewPage, "sendMessage")).toBeUndefined();
    await expect(input).toHaveText("");
    await expect(webviewPage.locator(".confirm-dialog")).toHaveCount(0);
  });

  test("插件变更落盘后弹强引导确认框，点「立即重新加载」回发 reloadPlugins", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage);
    await injector.clearMessageLog();
    await injector.simulateExtensionMessage("pluginChangePending");

    const dialog = webviewPage.locator(".confirm-dialog");
    await expect(dialog).toHaveCount(1);
    await expect(
      webviewPage.getByText("插件已变更，重新加载后生效"),
    ).toBeVisible();
    // 只弹框、不自动重载：用户不点就什么都不发生。
    expect(await postedMessage(webviewPage, "reloadPlugins")).toBeUndefined();
    // 顶部轻提示不再出现（它正是会被忽略的那个形态）。
    await expect(
      webviewPage.getByText("插件已变更。运行 /reload-plugins 使其生效。"),
    ).toHaveCount(0);

    await webviewPage.getByTestId("confirm-dialog-confirm").click();
    await expect
      .poll(async () => {
        const posted = (await postedMessage(webviewPage, "reloadPlugins")) as
          | Record<string, unknown>
          | undefined;
        return posted?.command;
      })
      .toBe("reloadPlugins");
    await expect(dialog).toHaveCount(0);
  });

  test("点「稍后」只关掉弹窗、不重载；之后仍可手动敲命令补上", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage);
    await injector.clearMessageLog();
    await injector.simulateExtensionMessage("pluginChangePending");
    const dialog = webviewPage.locator(".confirm-dialog");
    await expect(dialog).toHaveCount(1);

    await webviewPage.getByTestId("confirm-dialog-cancel").click();
    await expect(dialog).toHaveCount(0);
    // 「稍后」不产生任何重载请求。
    expect(await postedMessage(webviewPage, "reloadPlugins")).toBe(undefined);

    // 手动敲 /reload-plugins 仍照常可用（与改动前同一入口）。
    const input = webviewPage.getByTestId("message-input");
    await input.click();
    await webviewPage.keyboard.type("/reload-plugins");
    await webviewPage.keyboard.press("Enter");
    await expect
      .poll(async () => {
        const posted = (await postedMessage(webviewPage, "reloadPlugins")) as
          | Record<string, unknown>
          | undefined;
        return posted?.command;
      })
      .toBe("reloadPlugins");
  });
});
