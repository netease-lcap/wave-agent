import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * 远控页点消息里的路径就地看内容（spec remote/remote-web.md「点消息里的图片路
 * 径看原图」与「点消息里的文件路径看内容」），在真 Chromium 里各跑一遍完整一跳：
 *
 * 渲染层把路径都变成入口 → 点它不走 `openFile`，而是按扩展名分流：图片发
 * `getImagePreview`、其余发 `getTextPreview`，各带一个 `requestId` → 宿主的回包
 * 让全屏覆盖层（图）或全屏文本弹层（文件）出现 → 关掉。
 *
 * 这一跳是单测拼不出来的：链接是 marked renderer 生成的 innerHTML，点击路由挂在
 * `.message-content-container` 上，请求器只认 `window` 上的 `message` 事件——三段
 * 各自都有单测，只有把它们串起来才证明「手机上点一下真的能看到内容」。
 */

const SHOT = "/tmp/shots/before.png";
const NOTE = "/tmp/shots/report.md";

/** 1×1 透明 PNG：内容不重要，重要的是这正是宿主回包里的那种值。 */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

test.use({
  remotePage: true,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

function messages(): Message[] {
  return [
    {
      id: "u1",
      role: "user",
      timestamp: "2026-10-30T10:00:00.000Z",
      blocks: [{ type: "text", content: "跑一下真机验证并截图" }],
    },
    {
      id: "a1",
      role: "assistant",
      timestamp: "2026-10-30T10:00:30.000Z",
      blocks: [
        {
          type: "text",
          content: `截图已保存到 ${SHOT} ，完整报告见 ${NOTE} 。`,
        },
      ],
    },
  ];
}

async function openPage(injector: MessageInjector) {
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  await injector.updateMessages(messages());
  await injector.endStreaming();
}

test.describe("远控页：点路径看内容", () => {
  test("图片路径：点了发出取图请求并弹出覆盖层", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await openPage(injector);

    // 渲染层：同一段文本里的两条路径都是入口。
    const links = webviewPage.locator("a.file-path-link");
    await expect(links).toHaveCount(2);

    await links.filter({ hasText: SHOT }).click();

    const request = await webviewPage.evaluate(() => {
      const sent = (
        window as unknown as { testMessages?: Array<Record<string, unknown>> }
      ).testMessages;
      return sent?.find((message) => message.command === "getImagePreview");
    });
    expect(request?.path).toBe(SHOT);
    // 归属键：页面按它对回包，宿主原样带回。
    expect(typeof request?.requestId).toBe("string");

    await injector.simulateExtensionMessage("imagePreviewResponse", {
      requestId: request!.requestId,
      dataUrl: PIXEL,
      scaled: true,
    });

    const modal = webviewPage.locator(".image-preview-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("img")).toHaveAttribute("src", PIXEL);

    // 点遮罩关闭（图本身 stopPropagation，所以点边角）。
    await modal.click({ position: { x: 4, y: 4 } });
    await expect(webviewPage.locator(".image-preview-modal")).toHaveCount(0);
  });

  test("文本路径：点了发出取文本请求，回包进全屏弹层并能关掉", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await openPage(injector);

    await webviewPage.locator("a.file-path-link", { hasText: NOTE }).click();

    const request = await webviewPage.evaluate(() => {
      const sent = (
        window as unknown as { testMessages?: Array<Record<string, unknown>> }
      ).testMessages;
      return sent?.find((message) => message.command === "getTextPreview");
    });
    expect(request?.path).toBe(NOTE);
    expect(typeof request?.requestId).toBe("string");

    await injector.simulateExtensionMessage("textPreviewResponse", {
      requestId: request!.requestId,
      content: "# 真机验证报告\n\n全部用例通过\n",
      bytes: 5 * 1024 * 1024,
      returnedBytes: 256 * 1024,
      truncated: true,
      encodingIssue: false,
    });

    const dialog = webviewPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // 正文走 markdown 渲染（标题成了 h1），不是一坨灰字。
    await expect(dialog.locator("h1")).toHaveText("真机验证报告");
    await expect(dialog).toContainText("全部用例通过");
    // 截断如实写在标题栏上，不假装整份都在。
    await expect(dialog).toContainText("前 256 KB / 共 5.0 MB");

    await webviewPage.keyboard.press("Escape");
    await expect(webviewPage.getByRole("dialog")).toHaveCount(0);
  });
});
