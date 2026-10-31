import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Locator, Page } from "@playwright/test";
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

  test("长文件名：标题栏在自己那一行里收住，不挤出弹窗右边", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await openPage(injector);
    // 手机档（390px）上标题栏只有 351px 可用，而文件名可以任意长——它是最不
    // 该撑破弹窗的东西，也是最容易撑破的东西：flex 子项的 `min-width` 默认是
    // `min-content`，一个不含断点的长文件名（下划线、纯字母）撑着不收缩，右侧
    // 那句「前 256 KB / 共 5.0 MB」与关闭按钮被一起顶出面板。
    const longName =
      "/tmp/shots/remote_web_text_preview_implementation_notes_20261101.md";

    const dialog = await openTextPreview(webviewPage, injector, longName);

    // 标题与那句截断说明都还在（修的是排版，不是把它们藏掉）。
    await expect(dialog).toContainText("remote_web_text_preview");
    await expect(dialog).toContainText("前 256 KB / 共 5.0 MB");

    // 标题栏自身没有横向溢出：内容宽度落在盒子里。
    expect(await headerOverflow(dialog)).toBeLessThanOrEqual(0);

    // 关闭按钮整个落在弹窗右边界之内（溢出时它会被推出面板）。
    const panel = await dialog.boundingBox();
    const close = await dialog
      .locator(".ide-context-preview-close")
      .boundingBox();
    expect(panel).not.toBeNull();
    expect(close).not.toBeNull();
    expect(close!.x + close!.width).toBeLessThanOrEqual(
      panel!.x + panel!.width + 0.5,
    );
    // 反过来也不能被压没：它至少还有可点的尺寸。
    expect(close!.width).toBeGreaterThanOrEqual(24);
    // 标题收成一行（省略号收尾），不靠换行把标题栏撑高。
    expect(await titleHeight(dialog)).toBeLessThanOrEqual(20);
  });

  test("可断行的长中文名：标题也只占一行", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await openPage(injector);
    // 中文与带连字符的名字能在任意字符/连字符处断行，于是「不溢出」这条对它们
    // 本来就成立——真正的毛病是标题换行成三四行、把标题栏撑高。
    const dialog = await openTextPreview(
      webviewPage,
      injector,
      "/tmp/shots/很长的中文文件名用来看看会不会把标题栏挤破掉真的会吗再看一遍.md",
    );

    expect(await headerOverflow(dialog)).toBeLessThanOrEqual(0);
    expect(await titleHeight(dialog)).toBeLessThanOrEqual(20);
    await expect(dialog).toContainText("很长的中文文件名");
  });
});

/**
 * 点消息里那条长路径、把宿主回包喂回去，返回已经弹出的弹层。
 * 弹层只认「最近一次请求」的 requestId，所以按发出的顺序取最后一条。
 */
async function openTextPreview(
  page: Page,
  injector: MessageInjector,
  filePath: string,
) {
  await injector.updateMessages([
    {
      id: "a2",
      role: "assistant",
      timestamp: "2026-10-30T10:01:00.000Z",
      blocks: [{ type: "text", content: `完整报告见 ${filePath} 。` }],
    },
  ]);
  await injector.endStreaming();

  await page.locator("a.file-path-link", { hasText: filePath }).click();
  const request = await page.evaluate(() => {
    const sent = (
      window as unknown as { testMessages?: Array<Record<string, unknown>> }
    ).testMessages;
    return sent
      ?.filter((message) => message.command === "getTextPreview")
      .pop();
  });
  expect(request).toBeDefined();
  await injector.simulateExtensionMessage("textPreviewResponse", {
    requestId: (request as Record<string, unknown>).requestId,
    content: "# 真机验证报告\n\n全部用例通过\n",
    bytes: 5 * 1024 * 1024,
    returnedBytes: 256 * 1024,
    truncated: true,
    encodingIssue: false,
  });

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** 标题栏内容比盒子宽多少（> 0 就是从右边冒出去了）。 */
function headerOverflow(dialog: Locator): Promise<number> {
  return dialog
    .locator(".ide-context-preview-header")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
}

function titleHeight(dialog: Locator): Promise<number> {
  return dialog
    .locator(".ide-context-preview-title")
    .evaluate((el) => el.getBoundingClientRect().height);
}
