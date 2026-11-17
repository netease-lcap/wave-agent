import type { Page } from "@playwright/test";
import {
  openWebviewOnHttpOrigin,
  test,
  expect,
} from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * e2e（真 Chromium + 真 chat.js bundle）— `$.prompt.fill` 填进来的草稿必须让暗色
 * 建议（`prompt.suggest`）让位，且 Tab 不能拿过期建议把它整份换掉。
 *
 * 出处（#2950 B4）：`fillDraft` 写草稿、`setMessage`、上报 `updateInputContent`，
 * 却不调 `onModSuggestionDismiss`（那条调用只在用户输入、Tab、插件改写三处）。
 * 于是三件事同时成立：
 *
 *   1. 建议还摆着，`data-placeholder=""`（让位态）继续挂着 —— 输入框看起来「空的」，
 *      用户既看不到占位文案，也看不出这里其实有个建议；
 *   2. 按 Tab 走 `fillDraft({text: 建议, mode:"replace"})` —— **把插件刚填进来的
 *      正文整份替换成那条过期建议**（数据丢失）；
 *   3. 这直接推翻 spec `ecosystem/plugin-mods.md` 的自述「同一条草稿状态，所以两边
 *      不会打架」。
 *
 * 单测（`tests/webview/modPromptSuggestEdit.test.tsx`）覆盖不到：那里六个用例都是
 * 「建议 + Tab」或「建议 + 输入」，没有 `fill` 与建议并发。
 *
 * 修法两面：`fillDraft` 收尾撤建议（草稿有内容了，建议没有存在理由），Tab 接受前
 * 还要求「草稿仍然是空的」（防 React 提交间隙里读到的旧 props）。
 */

const DIR = "/Users/dev/projects/wave-agent";
const SESSION = {
  id: "s-prompt-suggest-fill",
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
  await page.waitForSelector('[data-testid="message-input"]');
}

async function lastDraft(injector: MessageInjector): Promise<string> {
  const messages = await injector.getMessagesSentToExtension();
  return (
    (messages.filter((m) => m.command === "updateInputContent").pop()
      ?.content as string) ?? ""
  );
}

test.describe("prompt.fill 与 prompt.suggest 并发", () => {
  test("fill 填进草稿后建议让位，Tab 不会把草稿换成过期建议", async ({
    page,
  }) => {
    await openWebviewOnHttpOrigin(page);
    const injector = new MessageInjector(page);
    await setup(injector, page);

    const input = page.getByTestId("message-input");
    await input.click();

    await injector.simulateExtensionMessage("desktopModPromptSuggest", {
      payload: { requestId: "sug-1", text: "建议里的草稿" },
    });
    const suggestion = page.getByTestId("mod-suggestion");
    await expect(suggestion).toBeVisible();
    // 设计如此：建议摆着时让出 placeholder 那一行（暗字不进 DOM）。
    await expect(input).toHaveAttribute("data-placeholder", "");

    await injector.simulateExtensionMessage("desktopModPromptFill", {
      payload: { requestId: "fill-1", text: "用户刚写的草稿", mode: "append" },
    });
    await expect(input).toContainText("用户刚写的草稿");

    // 1) 建议撤掉 —— 它只在空草稿上有意义；挂着就是永久让位态。
    await expect(suggestion).toHaveCount(0);
    // 2) 让位态随之结束：占位属性回到那句灰字（不必逐字比，只要不是空串）。
    await expect
      .poll(() => input.getAttribute("data-placeholder"))
      .not.toBe("");

    // 3) 再按 Tab：草稿是内容，不是「接着会打的字」，不能被那条建议整份替换。
    await page.keyboard.press("Tab");
    await page.waitForTimeout(300);
    await expect(input).toContainText("用户刚写的草稿");
    expect(await lastDraft(injector)).not.toBe("建议里的草稿");
  });
});
