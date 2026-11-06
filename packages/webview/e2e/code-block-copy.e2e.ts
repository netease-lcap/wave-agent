import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * 助手消息围栏代码块右上角的复制按钮（spec: ui/message-rendering-system.md
 * 「助手消息代码块的复制按钮」场景 1-5）。
 *
 * jsdom 那侧（tests/webview/codeBlockCopy.test.tsx）能证明「按钮在 DOM 里、
 * 点击写出的是代码原文」，但证明不了三件只有真实排版才成立的事：
 *   1. 按钮平时是**看不见**的（`opacity: 0`），悬停代码块才淡入；
 *   2. 按钮浮在代码块右上角、**不压住首行**（pre 右内边距为它让位）；
 *   3. 横向滚动 `pre` 时按钮**不跟着走**（它定位在外层容器上，不在滚动区里）。
 *
 * ⚠️ 加载的是 dist 产物：`pnpm -F wave-webview build` 之后再跑。
 */

const CODE = [
  'const answer: string = "你好";',
  `const veryLongLine = "${"x".repeat(160)}";`,
  "console.log(answer);",
].join("\n");

const messages = [
  {
    id: "a_code_copy",
    role: "assistant",
    blocks: [
      {
        type: "text",
        content: `看这段：\n\n\`\`\`ts\n${CODE}\n\`\`\``,
      },
    ],
  },
] as unknown as Message[];

async function seed(page: import("@playwright/test").Page) {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  await injector.updateMessages(messages);
  await page.waitForSelector(".md-code-copy");
}

test.describe("code block copy button", () => {
  test("stays hidden until the block is hovered", async ({ webviewPage }) => {
    await seed(webviewPage);
    const button = webviewPage.locator(".md-code-copy").first();
    const block = webviewPage.locator(".md-code-block").first();

    // 场景 3：鼠标不在代码块上时看不见（不占位：绝对定位，不影响代码块几何）
    await expect(button).toHaveCSS("opacity", "0");

    await block.hover();
    await expect(button).toHaveCSS("opacity", "1");
  });

  test("floats in the top-right corner without covering the first line", async ({
    webviewPage,
  }) => {
    await seed(webviewPage);
    await webviewPage.locator(".md-code-block").first().hover();

    const geometry = await webviewPage.evaluate(() => {
      const preEl = document.querySelector(
        ".markdown-content pre",
      ) as HTMLElement;
      const btnEl = document.querySelector(".md-code-copy") as HTMLElement;
      const pre = preEl.getBoundingClientRect();
      const btn = btnEl.getBoundingClientRect();
      return {
        gapTop: btn.top - pre.top,
        gapRight: pre.right - btn.right,
        paddingRight: Number.parseFloat(getComputedStyle(preEl).paddingRight),
        buttonWidth: btn.width,
      };
    });

    // 场景 1：贴在代码块右上角（几像素的内缩），在 pre 的盒子之内
    expect(geometry.gapTop).toBeGreaterThanOrEqual(0);
    expect(geometry.gapTop).toBeLessThan(12);
    expect(geometry.gapRight).toBeGreaterThanOrEqual(0);
    expect(geometry.gapRight).toBeLessThan(12);
    // 场景 2：首行为按钮让出了内边距，宽代码不会跑到按钮底下
    expect(geometry.paddingRight).toBeGreaterThanOrEqual(
      geometry.buttonWidth + 8,
    );
  });

  test("does not move when the code scrolls horizontally", async ({
    webviewPage,
  }) => {
    await seed(webviewPage);
    const block = webviewPage.locator(".md-code-block").first();
    const button = webviewPage.locator(".md-code-copy").first();
    await block.hover();
    const before = await button.boundingBox();

    await webviewPage.evaluate(() => {
      const pre = document.querySelector(
        ".markdown-content pre",
      ) as HTMLElement;
      pre.scrollLeft = pre.scrollWidth;
    });

    const after = await button.boundingBox();
    expect(after?.x).toBeCloseTo(before?.x ?? 0, 0);
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
  });

  test("copies this block's source and shows a check", async ({
    webviewPage,
  }) => {
    await seed(webviewPage);

    // 真实 Chromium 里不碰系统剪贴板：装一个记录用的桩，读回被复制的原文。
    await webviewPage.evaluate(() => {
      (window as unknown as { __copied: string | null }).__copied = null;
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            (window as unknown as { __copied: string | null }).__copied = text;
          },
        },
        configurable: true,
      });
    });

    const block = webviewPage.locator(".md-code-block").first();
    const button = webviewPage.locator(".md-code-copy").first();
    await block.hover();
    await button.click();

    // 场景 4：代码原文（去掉围栏与末尾换行），缩进/长行原样保留
    await webviewPage.waitForFunction(
      () =>
        (window as unknown as { __copied: string | null }).__copied !== null,
    );
    const copied = await webviewPage.evaluate(
      () => (window as unknown as { __copied: string | null }).__copied,
    );
    expect(copied).toBe(CODE);

    // 场景 5：图标转对勾、可访问名换成「已复制」
    await expect(button).toHaveAttribute("aria-label", "已复制");
    await expect(button.locator(".codicon")).toHaveClass(/codicon-check/);
  });
});
