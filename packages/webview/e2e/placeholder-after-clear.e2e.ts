import type { Page } from "@playwright/test";
import {
  openWebviewOnHttpOrigin,
  test,
  expect,
} from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * 输入框空态占位文案（`data-placeholder`）——「打过字再清空」必须把灰字找回来。
 *
 * 报障：最新 beta 里输入文字后手动清空，输入框看着是空的，占位提示却不出现。
 * 判据是 `data-empty`（MessageInput.tsx 的 `isComposerVisuallyEmpty`：无可见文本、
 * 且没有引用标签/图片），不是 CSS 的 `:empty` —— contenteditable 清空后常剩下空壳
 * 节点（`<br>`/空 `<div>`）或看不见的字符（`\u200b` 零宽空格等），`:empty` 为假。
 * 用例同时钉住两条边界：有标签/图片时**不该**出现占位、mod 建议摆着时让位。
 *
 * 在真 Chromium 里跑（e2e，不是 demo）：占位是 `::before` 伪元素，jsdom 不排版，
 * 只能读真浏览器的 computed style。
 */
const DIR = "/Users/dev/projects/wave-agent";
const SESSION_ID = "s-placeholder-1";
const PLACEHOLDER = "快捷指令";
const SESSION = {
  id: SESSION_ID,
  sessionType: "main" as const,
  workdir: DIR,
  firstMessage: "",
  lastActiveAt: 1782000000000,
  latestTotalTokens: 0,
};

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

/** 占位伪元素此刻到底画的是什么（`none` = 没画，`""` = 属性被清空）。 */
async function placeholderContent(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-testid="message-input"]',
    );
    if (!el) throw new Error("message-input missing");
    return getComputedStyle(el, "::before").content;
  });
}

/** 输入框此刻的 DOM（失败信息里要能看出「占位为什么没了」）。 */
async function inputDom(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-testid="message-input"]',
    );
    if (!el) throw new Error("message-input missing");
    return {
      html: el.innerHTML,
      dataEmpty: el.getAttribute("data-empty"),
      text: el.textContent,
    };
  });
}

const expectPlaceholder = (page: Page) =>
  expect
    .poll(() => placeholderContent(page), {
      message: "占位文案应该出现",
    })
    .toContain(PLACEHOLDER);

const expectNoPlaceholder = (page: Page) =>
  expect
    .poll(() => placeholderContent(page), {
      message: "占位文案不该出现",
    })
    .not.toContain(PLACEHOLDER);

test.describe("输入框占位文案 · 清空后恢复", () => {
  test("打字后占位消失，真实键盘清空后占位回来", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await setup(injector, webviewPage);
    const input = webviewPage.getByTestId("message-input");
    await input.click();

    // ── 打字：占位让位 ────────────────────────────────────────────
    await webviewPage.keyboard.insertText("你好");
    await expectNoPlaceholder(webviewPage);

    // ── 1. 全选 + Backspace ──────────────────────────────────────
    await webviewPage.keyboard.press("Control+a");
    await webviewPage.keyboard.press("Backspace");
    await expectPlaceholder(webviewPage);

    // ── 2. 全选 + Delete ────────────────────────────────────────
    await webviewPage.keyboard.type("hello");
    await webviewPage.keyboard.press("Control+a");
    await webviewPage.keyboard.press("Delete");
    await expectPlaceholder(webviewPage);

    // ── 3. 逐字删光 ─────────────────────────────────────────────
    await webviewPage.keyboard.type("abc");
    for (let i = 0; i < 3; i++) await webviewPage.keyboard.press("Backspace");
    await expectPlaceholder(webviewPage);

    // ── 4. 多行（Shift+Enter 才是换行，Enter 是发送）──────────────
    await webviewPage.keyboard.type("第一行");
    await webviewPage.keyboard.press("Shift+Enter");
    await webviewPage.keyboard.type("第二行");
    await webviewPage.keyboard.press("Control+a");
    await webviewPage.keyboard.press("Backspace");
    await expectPlaceholder(webviewPage);
  });

  test("宿主回填的草稿只剩不可见字符时，占位仍要在", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await setup(injector, webviewPage);

    // 三条都是「看起来是空输入框、`:empty` 却是假」的真实状态：零宽空格（从别的
    // 应用复制文本时常见）、纯空格、纯换行。宿主回填草稿走 renderDraftContent，
    // 不派发 input 事件 —— 只靠 handleInput 里那步清空是兜不住的。
    for (const draft of ["\u200b", " ", "\n"]) {
      await injector.simulateExtensionMessage("setInitialState", {
        messages: [],
        isStreaming: false,
        isAuthenticated: true,
        permissionMode: "default",
        inputContent: draft,
        session: SESSION,
      });
      // 判据落在「可见文本为空」上：DOM 里剩没剩空壳都不该影响占位。
      await expectPlaceholder(webviewPage);
      expect((await inputDom(webviewPage)).dataEmpty).toBe("true");
    }
  });

  test("输入框里只有引用标签时不显示占位", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await setup(injector, webviewPage);
    const input = webviewPage.getByTestId("message-input");
    await input.click();
    await injector.simulateExtensionMessage("uploadSuccess", {
      uploadedFiles: [`${DIR}/src/order.ts`],
    });
    await expect(
      input.locator(`.context-tag-container[data-path="${DIR}/src/order.ts"]`),
    ).toHaveCount(1);
    await expectNoPlaceholder(webviewPage);
  });

  /**
   * 草稿图片要走 webview 侧的 IndexedDB（spec ui/image-pasting.md），
   * `webviewPage` fixture 用 `setContent` 起页面、origin 是 opaque 的 "null"，
   * 浏览器直接拒掉 → 换真实 http origin。
   */
  test("输入框里只有图片标签时不显示占位", async ({ page }) => {
    await openWebviewOnHttpOrigin(page);
    const injector = new MessageInjector(page);
    await setup(injector, page);
    await page.getByTestId("message-input").click();
    await page.evaluate(() => {
      const input = document.querySelector<HTMLElement>(
        '[data-testid="message-input"]',
      );
      if (!input) throw new Error("message-input missing");
      const chip = document.createElement("span");
      chip.className = "context-tag-container";
      chip.contentEditable = "false";
      chip.setAttribute("data-path", "pasted-image-e2e.png");
      chip.setAttribute("data-name", "图片 1");
      chip.setAttribute("data-is-image", "true");
      chip.textContent = "图片 1";
      input.appendChild(chip);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(
      page.locator('.context-tag-container[data-is-image="true"]'),
    ).toHaveCount(1);
    await expectNoPlaceholder(page);
  });

  test("mod 建议摆着时让出那一行（不画占位）", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await setup(injector, webviewPage);
    await injector.simulateExtensionMessage("desktopModPromptSuggest", {
      payload: {
        sessionId: SESSION_ID,
        requestId: "suggest-1",
        text: "请先跑一遍测试",
        plugin: "wave",
      },
    });
    await expect(webviewPage.getByTestId("mod-suggestion")).toBeVisible();
    await expectNoPlaceholder(webviewPage);
  });
});
