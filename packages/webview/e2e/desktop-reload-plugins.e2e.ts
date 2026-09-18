import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * `/reload-plugins` 入口（真浏览器 + 真 bundle，桌面模式）——
 * spec ecosystem/plugin.md「插件变更的就地重载」场景 12–13：插件变更只产生一次
 * 中性提示、**不弹任何确认框**（「立即重启 / 稍后重启」整体废止），真正换装由用户
 * 敲 `/reload-plugins` 触发：该命令不进对话、不产生用户消息，只回一条
 * `reloadPlugins` 给宿主去就地换装。
 *
 * 单测（tests/webview/reloadPlugins.test.tsx）已覆盖拦截逻辑；这里在真 bundle +
 * 真 DOM 上确认输入框被清空、回执报文正确，以及界面里不再有确认框。
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

  test("插件变更的待应用提示只呈现 toast，绝不弹确认框", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage);
    await injector.simulateExtensionMessage("showToast", {
      toast: {
        id: "toast-plugin-change",
        message: "插件已变更。运行 /reload-plugins 使其生效。",
      },
    });

    await expect(
      webviewPage.getByText("插件已变更。运行 /reload-plugins 使其生效。"),
    ).toBeVisible();
    await expect(webviewPage.locator(".confirm-dialog")).toHaveCount(0);
  });
});
