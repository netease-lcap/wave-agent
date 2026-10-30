import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * e2e（真 Chromium + 真 chat.js bundle）— 点开已发送的粘贴图。
 *
 * 出处：spec docs/specs/ui/image-pasting.md「用户故事：已发送图片的标签点开就能看」。
 * 2026-10-30 报的现象是「点开是一张损坏的图片」：桌面端 SSH 会话里，消息块带的是
 * **远端**那台机器上的临时文件路径，页面自己拼 `<img src=路径>` 等于拿本机路径去
 * 加载远端文件。
 *
 * 现在字节留在消息块里（`imageUrls` 是 data URL），标签点开就地弹层。这里用**真实
 * Chromium 的解码器**验证弹出来的是能解码的图（`naturalWidth > 0`）—— jsdom 那条
 * 单测（tests/webview/tagClickability.test.tsx）只能断言 `<img src>` 被设成什么，
 * 断言不了字节真的能解出来，而那正是这次报障的形态。
 */

/** 1x1 不透明 PNG（真解码器认的那种）。 */
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** 宿主那台机器上的临时文件，只喂 `[Image source: <path>]`，页面不该用它。 */
const HOST_TEMP_PATH = "/tmp/wave-image-1700000000-abc123.png";

function messageWithPastedImage(): Message {
  return {
    id: "u-pasted",
    role: "user",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [
      { type: "text", content: "看这张图 [image1]" },
      {
        type: "image",
        imageUrls: [TINY_PNG_DATA_URL],
        imagePaths: [HOST_TEMP_PATH],
      },
    ],
  };
}

async function loadMessage(
  webviewPage: import("@playwright/test").Page,
  message: Message,
) {
  const injector = new MessageInjector(webviewPage);
  await injector.simulateExtensionMessage("updateMessages", {
    messages: [message],
  });
  const tag = webviewPage.locator(".message.user .context-tag.is-image");
  await expect(tag).toBeVisible();
  return tag;
}

test.describe("已发送粘贴图的标签", () => {
  test("点开后弹层里是能解码的图，且不向宿主索要文件", async ({
    webviewPage,
  }) => {
    const tag = await loadMessage(webviewPage, messageWithPastedImage());

    await tag.click();

    const img = webviewPage.locator(".image-preview-modal img");
    await expect(img).toBeVisible();
    // 字节真的能解出来 —— 「损坏的图片」正是解不出来
    expect(
      await img.evaluate((el) => (el as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);

    // 页面不为这张图向宿主要文件（宿主只能给它那台机器上的路径）
    const sent = await webviewPage.evaluate(() =>
      (
        window.getTestMessages() as Array<{ command?: string; path?: string }>
      ).filter((m) => m.command === "openFile" || m.command === "previewImage"),
    );
    expect(sent).toEqual([]);
  });

  test("只有路径、没有字节的图片引用仍然交给宿主打开", async ({
    webviewPage,
  }) => {
    const tag = await loadMessage(webviewPage, {
      id: "u-referenced",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [
        { type: "text", content: "看这张图 [image1]" },
        { type: "image", imageUrls: [HOST_TEMP_PATH] },
      ],
    });

    await tag.click();

    await expect
      .poll(async () =>
        webviewPage.evaluate(
          () =>
            (
              window.getTestMessages() as Array<{
                command?: string;
                path?: string;
              }>
            ).filter((m) => m.command === "previewImage").length,
        ),
      )
      .toBe(1);
    const sent = await webviewPage.evaluate(() =>
      (
        window.getTestMessages() as Array<{ command?: string; path?: string }>
      ).filter((m) => m.command === "previewImage"),
    );
    expect(sent[0].path).toBe(HOST_TEMP_PATH);
    await expect(webviewPage.locator(".image-preview-modal")).toHaveCount(0);
  });
});
