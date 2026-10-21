import type { Page } from "@playwright/test";
import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";

/**
 * Desktop 输入草稿跨视图切换保留（spec desktop-sessions.md「会话管理」场景 23 +
 * desktop-preview.md「预览面板全屏」场景 7）：进设置页 / 看会话看板 / 进预览全屏
 * 再回来，未发送的输入内容必须还在。
 *
 * 一定要在真 Chromium 里跑：全屏那一条的关键是「对话列隐藏但没被卸载」，jsdom
 * 不跑样式也拿不到可见性，只有真浏览器能验证。
 *
 * 宿主那一半（webviewReady → setInitialState 按下发的 inputContent 回填草稿）由本
 * 用例手动模拟：从页面发出的 updateInputContent 里取草稿，再按快照回灌。
 */
const DIR = "/Users/dev/projects/wave-agent";
const SESSION = {
  id: "s-draft-1",
  sessionType: "main" as const,
  workdir: DIR,
  firstMessage: "修复下单接口的超时问题",
  lastActiveAt: 1782000000000,
  latestTotalTokens: 1200,
};
// 单行草稿：contenteditable 里不涉及 <br> 换行，断言只看文本。
const DRAFT = "把下单接口的重试次数改成 3 次，并补一条超时用例";

/** 宿主 inputDrafts 里这一版草稿（页面最后一次 updateInputContent 的内容）。 */
async function lastDraft(injector: MessageInjector): Promise<string> {
  const messages = await injector.getMessagesSentToExtension();
  return (
    messages
      .filter((m) => m.command === "updateInputContent")
      .map((m) => m.content as string)
      .pop() ?? ""
  );
}

/**
 * 模拟宿主在 `webviewReady` 之后重发权威快照：inputContent 取 inputDrafts 的值。
 * 桌面端就是这样把草稿送回重挂载的输入框的。
 */
async function replaySnapshot(injector: MessageInjector, draft: string) {
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    isAuthenticated: true,
    permissionMode: "default",
    inputContent: draft,
    session: SESSION,
  });
}

async function setup(injector: MessageInjector, page: Page) {
  await page.setViewportSize({ width: 1080, height: 720 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR,
    recentWorkdirs: [DIR],
  });
  await injector.waitForChatAppReady();
  await seedSidebarSessions(injector, DIR, [
    { sessionId: SESSION.id, title: SESSION.firstMessage },
  ]);
  // 空会话（欢迎页）+ 一条未发送的草稿：草稿最常见的落点就是这种还没开聊的会话。
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    isAuthenticated: true,
    permissionMode: "default",
    inputContent: "",
    session: SESSION,
  });
  await injector.simulateExtensionMessage("authStatusResponse", {
    isAuthenticated: true,
    user: { id: "user-1", email: "alice@example.com" },
  });
}

test.describe("Desktop 输入草稿跨视图切换保留", () => {
  test("设置页 / 会话看板 / 预览全屏往返后草稿仍在", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await setup(injector, webviewPage);

    const input = webviewPage.getByTestId("message-input");
    await input.click();
    await webviewPage.keyboard.insertText(DRAFT);
    await expect(input).toHaveText(DRAFT);

    // ── 1. 设置页往返 ────────────────────────────────────────────────
    await webviewPage.getByTestId("account-card-hotzone").click();
    await webviewPage.getByTestId("more-menu-settings").click();
    await expect(
      webviewPage.getByRole("heading", { name: "全局设置" }),
    ).toBeVisible();
    // 设置页顶替会话区：输入框随对话区一起卸载，草稿只剩宿主那一份。
    await expect(webviewPage.getByTestId("message-input")).toHaveCount(0);
    const afterSettings = await lastDraft(injector);
    expect(afterSettings).toBe(DRAFT);
    await webviewPage.locator(".settings-back").click();
    await replaySnapshot(injector, afterSettings);
    await expect(webviewPage.getByTestId("message-input")).toHaveText(DRAFT);

    // ── 2. 会话看板往返 ──────────────────────────────────────────────
    await webviewPage.getByTestId("desktop-sidebar-activity").click();
    await expect(webviewPage.getByTestId("session-board")).toBeVisible();
    await expect(webviewPage.getByTestId("message-input")).toHaveCount(0);
    const afterBoard = await lastDraft(injector);
    expect(afterBoard).toBe(DRAFT);
    await webviewPage.getByRole("button", { name: "返回当前会话" }).click();
    await replaySnapshot(injector, afterBoard);
    const restored = webviewPage.getByTestId("message-input");
    await expect(restored).toHaveText(DRAFT);

    // ── 3. 预览全屏往返 ─────────────────────────────────────────────
    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-empty-item-preview").click();
    await webviewPage.getByTestId("panel-fullscreen").click();
    // 全屏下对话框缩成浮动卡片、仍是同一个输入框实例——所以草稿一定还在。
    await expect(webviewPage.getByTestId("message-input")).toBeVisible();
    await expect(webviewPage.getByTestId("message-input")).toHaveText(DRAFT);
    await webviewPage.getByTestId("panel-fullscreen").click();
    const afterFullscreen = webviewPage.getByTestId("message-input");
    await expect(afterFullscreen).toBeVisible();
    await expect(afterFullscreen).toHaveText(DRAFT);
    // 退出全屏把焦点还给输入框，用户可以接着打字。
    await expect(afterFullscreen).toBeFocused();
  });
});
