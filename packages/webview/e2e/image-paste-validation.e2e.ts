import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * e2e（真 Chromium + 真 chat.js bundle）— 粘贴图片的发送前校验。
 *
 * 出处：spec docs/specs/ui/image-pasting.md「发送前校验图片有效性」。
 *
 * 单测（packages/webview/tests/webview/imagePasteValidation.test.tsx）跑在
 * jsdom 里，没有 `createImageBitmap`，只能覆盖头尾字节那一层；这里用**真实的
 * Chromium 解码器**验证：
 *  - 头尾字节都合法、只有像素数据坏掉的 PNG 会被宿主的真解码拒绝（这条路径
 *    jsdom 测不到，正是线上 400 的那一类图）；
 *  - 合法的 PNG 在真解码下仍然通过（防过度拦截）；
 *  - 单边超过 8192 的长截图经真 canvas 降采样后以 ≤8192 的副本进入消息
 *    （spec 同名用户故事「超长截图自动降采样」）。
 */

/** 1x1 透明 PNG（70 字节，头 + IEND 齐全）。 */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/**
 * 在页面里构造一次真实的 paste 事件（真 DataTransfer + 真 File），把二进制
 * 交给 webview 自己的粘贴处理器 —— 校验里的 createImageBitmap 也就是真解码器。
 */
async function pasteFile(
  page: import("@playwright/test").Page,
  payload: {
    base64: string;
    name: string;
    type: string;
    corruptRange?: [number, number];
  },
) {
  await page.evaluate((p) => {
    const binary = atob(p.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (p.corruptRange) {
      // 保留头签名与尾部 IEND，只把中间的像素数据（zlib 流）打坏
      const [from, to] = p.corruptRange;
      for (let i = from; i < to; i++) bytes[i] = 0x00;
    }

    const file = new File([bytes], p.name, { type: p.type });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const target = document.querySelector('[data-testid="message-input"]');
    if (!target) throw new Error("message-input not found");
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      }),
    );
  }, payload);
}

function postedErrors(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (
      (window.testMessages ?? []) as Array<{
        command?: string;
        message?: string;
      }>
    )
      .filter((m) => m.command === "showError")
      .map((m) => m.message ?? ""),
  );
}

const imageTags = (page: import("@playwright/test").Page) =>
  page.locator('.context-tag-container[data-is-image="true"]');

/**
 * 直接用真 Chromium 的解码器解一份字节，证明「拒绝」确实发生在解码这一层，
 * 而不是被头/尾字节检查顺带拦下的。
 */
function decodeVerdict(
  page: import("@playwright/test").Page,
  payload: { base64: string; type: string; corruptRange?: [number, number] },
) {
  return page.evaluate(async (p) => {
    const binary = atob(p.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (p.corruptRange) {
      const [from, to] = p.corruptRange;
      for (let i = from; i < to; i++) bytes[i] = 0x00;
    }
    try {
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: p.type }),
      );
      bitmap.close();
      return "decoded";
    } catch {
      return "rejected";
    }
  }, payload);
}

test.describe("粘贴图片的发送前校验（真 Chromium 解码器）", () => {
  let injector: MessageInjector;

  test.beforeEach(async ({ webviewPage }) => {
    injector = new MessageInjector(webviewPage);
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.evaluate(() => window.clearTestMessages?.());
  });

  test("像素数据损坏的 PNG 被真解码拒绝，且给出中文提示", async ({
    webviewPage,
  }) => {
    const payload = {
      base64: TINY_PNG_BASE64,
      name: "corrupt.png",
      type: "image/png",
      // 41..54 = IDAT 的 zlib 数据段，头签名 8 字节与尾部 IEND 都不动
      corruptRange: [41, 54] as [number, number],
    };

    // 前置证据：这份字节头/尾都合法（字节层检查放行），只有真解码器说不行
    expect(await decodeVerdict(webviewPage, payload)).toBe("rejected");

    await pasteFile(webviewPage, payload);

    await expect
      .poll(async () => (await postedErrors(webviewPage)).length)
      .toBe(1);
    const [message] = await postedErrors(webviewPage);
    expect(message).toContain("数据不完整或不是有效图片");
    await expect(imageTags(webviewPage)).toHaveCount(0);
  });

  test("0 字节图片被拒绝，不发出空图", async ({ webviewPage }) => {
    await pasteFile(webviewPage, {
      base64: "",
      name: "empty.png",
      type: "image/png",
    });

    await expect
      .poll(async () => (await postedErrors(webviewPage)).length)
      .toBe(1);
    const [message] = await postedErrors(webviewPage);
    expect(message).toContain("数据为空");
    await expect(imageTags(webviewPage)).toHaveCount(0);
  });

  test("文本改名成 .png 被拒绝", async ({ webviewPage }) => {
    // "this is not an image at all, just text" 的 base64
    const textBase64 = Buffer.from(
      "this is not an image at all, just text",
    ).toString("base64");

    await pasteFile(webviewPage, {
      base64: textBase64,
      name: "fake.png",
      type: "image/png",
    });

    await expect
      .poll(async () => (await postedErrors(webviewPage)).length)
      .toBe(1);
    const [message] = await postedErrors(webviewPage);
    expect(message).toContain("数据不完整或不是有效图片");
    await expect(imageTags(webviewPage)).toHaveCount(0);
  });

  test("白名单外的格式（bmp）被拒绝并提示支持的格式", async ({
    webviewPage,
  }) => {
    const bmpBase64 = Buffer.from([
      0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]).toString("base64");

    await pasteFile(webviewPage, {
      base64: bmpBase64,
      name: "a.bmp",
      type: "image/bmp",
    });

    await expect
      .poll(async () => (await postedErrors(webviewPage)).length)
      .toBe(1);
    const [message] = await postedErrors(webviewPage);
    expect(message).toContain("只支持 PNG / JPEG / GIF / WebP 格式的图片");
    await expect(imageTags(webviewPage)).toHaveCount(0);
  });

  test("合法 PNG 在真解码下照常插入（不过度拦截）", async ({ webviewPage }) => {
    const payload = {
      base64: TINY_PNG_BASE64,
      name: "ok.png",
      type: "image/png",
    };

    expect(await decodeVerdict(webviewPage, payload)).toBe("decoded");

    await pasteFile(webviewPage, payload);

    await expect(imageTags(webviewPage)).toHaveCount(1);
    expect(await postedErrors(webviewPage)).toEqual([]);
  });

  test("单边超过 8192 的长截图被真 canvas 降采样到边界内后再插入", async ({
    webviewPage,
  }) => {
    // 真 Chromium 造一张 8193x1500 的 PNG 并直接粘贴：这是唯一能跑通真实
    // createImageBitmap + canvas 重编码的层（jsdom 侧只能覆盖数值与失败分支）。
    await webviewPage.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 8193;
      canvas.height = 1500;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.fillStyle = "#123456";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("toBlob failed");

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File([blob], "long.png", { type: "image/png" }),
      );
      const target = document.querySelector('[data-testid="message-input"]');
      if (!target) throw new Error("message-input not found");
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        }),
      );
    });

    await expect(imageTags(webviewPage)).toHaveCount(1);

    // 送进消息的是缩到边界内的副本，而不是原图（原图会被上游 400 拒掉）。
    const pasted = await webviewPage.evaluate(async () => {
      const tag = document.querySelector(
        '.context-tag-container[data-is-image="true"]',
      );
      const url = tag?.getAttribute("data-image-url") ?? "";
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const dimensions = {
        width: bitmap.width,
        height: bitmap.height,
        mimeType: url.slice(5, url.indexOf(";")),
      };
      bitmap.close();
      return dimensions;
    });

    expect(pasted.mimeType).toBe("image/png");
    expect(pasted.width).toBeLessThanOrEqual(8192);
    expect(pasted.height).toBeLessThanOrEqual(8192);
    expect(Math.max(pasted.width, pasted.height)).toBe(8192);
    expect(await postedErrors(webviewPage)).toEqual([]);
  });
});
