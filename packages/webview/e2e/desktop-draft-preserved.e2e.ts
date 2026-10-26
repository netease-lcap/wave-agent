import type { Page } from "@playwright/test";
import {
  openWebviewOnHttpOrigin,
  test,
  expect,
} from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * Desktop 输入草稿跨视图切换保留（spec desktop-sessions.md「会话管理」场景 23 +
 * desktop-preview.md「预览面板全屏」场景 7）：进设置页 / 看会话看板 / 进预览全屏
 * 再回来，未发送的输入内容必须还在。
 *
 * 在真 Chromium 里跑（e2e，不是 demo）：全屏那一条的关键是「对话列缩成浮动卡片、
 * 输入框仍挂在同一处」，jsdom 不跑样式也拿不到可见性，只有真浏览器能验证。
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
/** 上传文件的绝对路径（宿主回 uploadedFiles 时给的就是它）。 */
const UPLOADED = `${DIR}/src/order.ts`;

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

/** 1x1 透明 PNG：草稿图片就是一段 data URL，图里画了什么不参与断言。 */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** 往输入框塞一张粘贴图：结构与真实粘贴产物一致（只是不经过剪贴板）。 */
async function pasteImage(page: Page) {
  await page.evaluate((dataUrl) => {
    const input = document.querySelector<HTMLElement>(
      '[data-testid="message-input"]',
    );
    if (!input) throw new Error("message-input missing");
    input.appendChild(document.createTextNode("这张图里是什么 "));
    const chip = document.createElement("span");
    chip.className = "context-tag-container";
    chip.contentEditable = "false";
    chip.setAttribute("data-path", "pasted-image-e2e.png");
    chip.setAttribute("data-name", "图片 1");
    chip.setAttribute("data-is-image", "true");
    chip.setAttribute("data-image-url", dataUrl);
    chip.textContent = "图片 1";
    input.appendChild(chip);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, PNG);
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

  test("设置页往返后 @ 文件引用仍是引用标签、不退化成文本", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await setup(injector, webviewPage);

    const input = webviewPage.getByTestId("message-input");
    await input.click();
    await webviewPage.keyboard.insertText("这个文件里写的是什么");

    // 上传完成：宿主回 uploadedFiles，输入框插入引用标签（+ 菜单上传那条路径）
    await injector.simulateExtensionMessage("uploadSuccess", {
      uploadedFiles: [UPLOADED],
    });
    const chip = input.locator(
      `.context-tag-container[data-path="${UPLOADED}"]`,
    );
    await expect(chip).toHaveCount(1);

    // ── 设置页往返：输入框随对话区卸载，草稿只剩宿主那一份 ──────────────
    await webviewPage.getByTestId("account-card-hotzone").click();
    await webviewPage.getByTestId("more-menu-settings").click();
    await expect(webviewPage.getByTestId("message-input")).toHaveCount(0);
    // 草稿里必须是引用标记，而不是标签的可见文字（"@order.ts"）
    const draft = await lastDraft(injector);
    expect(draft).toContain(`[@file:${UPLOADED}]`);
    expect(draft).toContain("这个文件里写的是什么");

    await webviewPage.locator(".settings-back").click();
    await replaySnapshot(injector, draft);
    const restored = webviewPage.getByTestId("message-input");
    await expect(
      restored.locator(`.context-tag-container[data-path="${UPLOADED}"]`),
    ).toHaveCount(1);
    await expect(restored).toContainText("这个文件里写的是什么");
    // 标记语法不得残留在正文里
    await expect(restored).not.toContainText("[@file:");
  });

  /**
   * 草稿图片走的是 webview 侧的 IndexedDB（spec ui/image-pasting.md「草稿里的
   * 图片」）：草稿文本里只留 `[@image:<id>]`，字节按会话存在本地存储里。这类
   * 用例必须落在真实 origin 上——`webviewPage` fixture 用 `setContent` 起页面，
   * origin 是 opaque 的 "null"，浏览器直接拒掉 IndexedDB。
   */
  test("设置页往返后草稿里的粘贴图片仍是图片标签、仍能随消息发出", async ({
    page,
  }) => {
    await openWebviewOnHttpOrigin(page);
    const injector = new MessageInjector(page);
    await setup(injector, page);

    const input = page.getByTestId("message-input");
    await input.click();
    await pasteImage(page);
    await expect(
      input.locator('.context-tag-container[data-is-image="true"]'),
    ).toHaveCount(1);

    // 防抖 150ms 后才上报：图片字节落进本会话的本地存储，草稿文本里只剩标记。
    await expect.poll(() => lastDraft(injector)).toContain("[@image:");
    const draft = await lastDraft(injector);
    expect(draft).toContain("这张图里是什么");

    // ── 设置页往返：输入框随对话区卸载，宿主只留得住那份草稿文本 ──────────
    await page.getByTestId("account-card-hotzone").click();
    await page.getByTestId("more-menu-settings").click();
    await expect(page.getByTestId("message-input")).toHaveCount(0);

    await page.locator(".settings-back").click();
    await replaySnapshot(injector, draft);

    const restored = page.getByTestId("message-input");
    const chip = restored.locator(
      '.context-tag-container[data-is-image="true"]',
    );
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute("data-image-url", PNG);
    await expect(restored).toContainText("这张图里是什么");
    // 标记语法不得残留在正文里
    await expect(restored).not.toContainText("[@image:");

    // 图片随消息发出：发送载荷里仍是图片数据，不是「文件引用 + 让模型读文件」。
    await injector.clearMessageLog();
    await page.keyboard.press("Enter");
    const sent = await injector.getMessagesSentToExtension();
    const outgoing = sent.find((message) => message.command === "sendMessage");
    expect(JSON.stringify(outgoing)).toContain("image/png");
  });
});
