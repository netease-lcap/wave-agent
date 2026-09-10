import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * 插件变更重建确认框（真浏览器 + 真 bundle，桌面模式）——
 * spec core/agent-config.md「配置变更的构造期副作用与重建」场景 4–6：
 * 构造期副作用（插件装卸）落盘后 host 推 `desktopRebuildPrompt {total, busy}`，
 * webview 弹两按钮确认框（立即重启 / 稍后重启，`Esc` 等同「稍后重启」，无
 * 「取消」），选择后回 `desktopRebuildDecision {restart}`。
 *
 * 单测（tests/webview/desktopRebuildPrompt.test.tsx）已覆盖组件状态机；这里在
 * 真 bundle + 真 DOM 上确认渲染与回执报文（防 CSS/构建产物层面的漂移）。
 * 分层：host 侧「只重建空闲会话 / 稍后重启不重建」由 desktop 单测与真 host 层
 * 负责（见 agent-config.md「验证分层」）。
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
    configurationData: { model: "claude-sonnet-4-20250514" },
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

test.describe("插件变更重建确认框", () => {
  test("N/M 文案 + 立即重启回执 restart:true 并关闭", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage);
    await injector.simulateExtensionMessage("desktopRebuildPrompt", {
      total: 3,
      busy: 1,
    });

    const dialog = webviewPage.locator(".confirm-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("插件变更需要重启对话才能生效。");
    await expect(dialog).toContainText(
      "将重启 3 个对话，其中 1 个正在执行任务暂不重启。",
    );
    await expect(webviewPage.getByTestId("confirm-dialog-confirm")).toHaveText(
      "立即重启",
    );
    await expect(webviewPage.getByTestId("confirm-dialog-cancel")).toHaveText(
      "稍后重启",
    );
    // 变更已落盘，弹窗只决定时机：不得有「取消」（易被误解为放弃这次变更）。
    await expect(dialog.getByText("取消", { exact: true })).toHaveCount(0);

    await injector.clearMessageLog();
    await webviewPage.getByTestId("confirm-dialog-confirm").click();

    await expect
      .poll(() => postedMessage(webviewPage, "desktopRebuildDecision"))
      .toMatchObject({ command: "desktopRebuildDecision", restart: true });
    await expect(dialog).toHaveCount(0);
  });

  test("Esc 等同「稍后重启」：restart:false 且不重启任何会话", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage);
    await injector.simulateExtensionMessage("desktopRebuildPrompt", {
      total: 2,
      busy: 2,
    });
    await expect(webviewPage.locator(".confirm-dialog")).toBeVisible();

    await injector.clearMessageLog();
    await webviewPage.keyboard.press("Escape");

    await expect
      .poll(() => postedMessage(webviewPage, "desktopRebuildDecision"))
      .toMatchObject({ command: "desktopRebuildDecision", restart: false });
    await expect(webviewPage.locator(".confirm-dialog")).toHaveCount(0);
  });
});
