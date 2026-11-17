import type { Page } from "@playwright/test";
import {
  openWebviewOnHttpOrigin,
  test,
  expect,
} from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * e2e（真 Chromium + 真 chat.js bundle）— 粘贴截图后标签不能被 `prompt.edit`
 * 的宿主回执拍成纯文本 `[image]`。
 *
 * 线上缺陷（桌面端 1.7.0，2026-11-18）：粘贴截图后输入框里只剩灰字 `[image]`，
 * 点不开预览、发出去也不是图片块。机理：粘贴那一下的 `input` 事件里，
 * `handleInput` 读 `innerText` 当镜像文本，此刻 `ContextTag` 的 React 渲染还没
 * 提交，读到的是占位符 `[image]`；这段文本随 `modPromptEdit` 上报，宿主（真机上
 * 一定有这一跳）原样回执，`applyPromptEdit` 发现回执文本与当前 DOM 文本不一致
 * （此时已经是 `@ 图片 1`），就把整份输入框按**纯文本**重建 —— 图片标签连同
 * `<img>` 字节一起没了。
 *
 * 之前没被覆盖的原因：mock 宿主从不回 `modPromptEditResult`，这条回执链在 e2e 里
 * 从来没跑过。本用例按真宿主的做法回执（用上报里的 prevText/start/end/inputText
 * 还原出插件「没改写」时那份全文），因此能在旧实现上稳定复现。
 */

const DIR = "/Users/dev/projects/wave-agent";
const SESSION = {
  id: "s-paste-edit-1",
  sessionType: "main" as const,
  workdir: DIR,
  firstMessage: "这个好看吗",
  lastActiveAt: 1782000000000,
  latestTotalTokens: 1200,
};

/** 1x1 透明 PNG（头 + IEND 齐全，真解码器放行）。 */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

async function setup(injector: MessageInjector, page: Page) {
  await page.setViewportSize({ width: 1080, height: 720 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR,
    recentWorkdirs: [DIR],
  });
  await injector.waitForChatAppReady();
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

/** 真 paste 事件：真 `DataTransfer` + 真 `File`，走真 Chromium 解码器。 */
async function pasteImage(page: Page) {
  await page.focus('[data-testid="message-input"]');
  await page.evaluate((base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], "screenshot.png", { type: "image/png" });
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
  }, TINY_PNG_BASE64);
}

interface PromptEditReport {
  requestId: string;
  text: string;
  cursor: number;
  start: number;
  end: number;
  inputText: string;
}

/**
 * 宿主那一跳：把 `modPromptEdit` 运进 CLI，插件**没改写**时回执的全文就是
 * 「prevText 里 [start,end) 换成 inputText」。真宿主（desktopHost/vscode）拿到
 * 的就是它，无插件时原样回。
 */
async function replyLikeRealHost(
  injector: MessageInjector,
  report: PromptEditReport,
) {
  const text =
    report.text.slice(0, report.start) +
    report.inputText +
    report.text.slice(report.end);
  await injector.simulateExtensionMessage("modPromptEditResult", {
    requestId: report.requestId,
    text,
    cursor: report.cursor,
  });
}

async function promptEdits(
  injector: MessageInjector,
): Promise<PromptEditReport[]> {
  const messages = await injector.getMessagesSentToExtension();
  return messages.filter(
    (m) => m.command === "modPromptEdit",
  ) as unknown as PromptEditReport[];
}

async function lastDraft(injector: MessageInjector): Promise<string> {
  const messages = await injector.getMessagesSentToExtension();
  return (
    messages
      .filter((m) => m.command === "updateInputContent")
      .map((m) => m.content as string)
      .pop() ?? ""
  );
}

const imageChips = (page: Page) =>
  page.locator('.context-tag-container[data-is-image="true"]');

/** 输入框里有没有那行纯文本 `[image]`（退化的标志）。 */
async function hasLiteralPlaceholder(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const input = document.querySelector('[data-testid="message-input"]');
    if (!input) return false;
    return Array.from(input.childNodes).some((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent ?? "").includes("[image]");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      const el = node as HTMLElement;
      // 标签节点本身不算退化；非标签元素里出现这行字才算
      if (el.classList.contains("context-tag-container")) return false;
      return (el.textContent ?? "").includes("[image]");
    });
  });
}

test.describe("粘贴截图后 prompt.edit 回执不得把图片标签拍成文本", () => {
  test("插件没改写时，图片标签与草稿标记都还在", async ({ page }) => {
    await openWebviewOnHttpOrigin(page);
    const injector = new MessageInjector(page);
    await setup(injector, page);

    const input = page.getByTestId("message-input");
    await input.click();
    await page.keyboard.insertText("这个好看吗 我感觉不太好看 ");
    await pasteImage(page);

    // 打字一次 + 粘贴一次 = 两次上报；粘贴那一次的 inputText 就是标签的可见文本
    // （旧实现里是占位符 `[image]`）。
    await expect
      .poll(() => promptEdits(injector).then((r) => r.length))
      .toBe(2);
    const report = (await promptEdits(injector)).pop()!;
    expect(report.text).toBeDefined();
    await replyLikeRealHost(injector, report);

    // 标签还在、还带字节，输入框里没有那行灰字
    await expect(imageChips(page)).toHaveCount(1);
    await expect(imageChips(page)).toHaveAttribute(
      "data-image-url",
      /^data:image\/png;base64,/,
    );
    expect(await hasLiteralPlaceholder(page)).toBe(false);
    await expect(input).toContainText("这个好看吗 我感觉不太好看");

    // 草稿里仍是图片标记（字节按会话存本地存储），不是纯文本
    await expect.poll(() => lastDraft(injector)).toContain("[@image:");
    expect(await lastDraft(injector)).not.toContain("[image]");
  });
});
