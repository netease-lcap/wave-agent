import type { Page } from "@playwright/test";
import {
  openWebviewOnHttpOrigin,
  test,
  expect,
} from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * e2e（真 Chromium + 真 chat.js bundle）— 晚到的 `prompt.edit` 改写回执不能落到
 * 一条**已经不存在的草稿**上。
 *
 * 出处（#2950 B5 / B6）：`applyPromptEdit` 唯一的时间序守卫是
 * `requestId !== lastEditRequestIdRef.current`，而 `lastEditRequestIdRef` 只在
 * `handleInput` 里更新。于是「草稿被别的东西换掉」完全不设防：
 *
 *   - **B5**：打字 → 宿主把编辑转给插件（异步）→ 用户切到另一个会话 → 回执到达。
 *     会话切换 effect 只重填草稿与光标，不重置 `lastEditRequestIdRef` ⇒ 旧会话
 *     那次编辑的回执「仍然是最新的一次」，`replaceChildren` 把**新会话**的草稿整份
 *     换成旧会话的改写（内容串会话；新会话草稿为空时等于凭空冒出一段别人的草稿）。
 *   - **B6**：打字 → 插件还没回 → 插件（或另一个 mod）先用 `$.prompt.fill` 换掉
 *     整份草稿 → 回执到达。`fillDraft` 不改 requestId ⇒ 回执按旧草稿的偏移落地，
 *     把刚填进来的正文覆盖掉。
 *
 * 修法用的是**草稿版本号**（不是再加一条特判）：`handleInput` / `fillDraft` /
 * `loadDraft` / 宿主回填 / 插件改写落地 / 发送后清空 每次改写草稿都 `++`，上报时
 * 记下当时的版本，回执落地前比一次。比「只比 requestId」稳：任意新的写改路径只要
 * 记得 `++` 就自动受保护，不依赖它是不是也叫「编辑」。
 */

const DIR = "/Users/dev/projects/wave-agent";
const SESSION = {
  id: "s-prompt-edit-late",
  sessionType: "main" as const,
  workdir: DIR,
  firstMessage: "",
  lastActiveAt: 1782000000000,
  latestTotalTokens: 0,
};

interface PromptEditReport {
  requestId: string;
  text: string;
  inputText: string;
}

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

async function lastPromptEdit(
  injector: MessageInjector,
): Promise<PromptEditReport> {
  const messages = await injector.getMessagesSentToExtension();
  return messages
    .filter((m) => m.command === "modPromptEdit")
    .pop() as unknown as PromptEditReport;
}

/** 真宿主那一跳的应答：把这次编辑的改写（这里固定成 `abc!`）送回 webview。 */
async function replyRewrite(
  injector: MessageInjector,
  requestId: string,
  text: string,
) {
  await injector.simulateExtensionMessage("modPromptEditResult", {
    requestId,
    text,
    cursor: text.length,
  });
}

test.describe("prompt.edit 回执：草稿换过就不落地", () => {
  test("切会话后才到的回执，不能改写新会话的草稿", async ({ page }) => {
    await openWebviewOnHttpOrigin(page);
    const injector = new MessageInjector(page);
    await setup(injector, page);

    const input = page.getByTestId("message-input");
    await input.click();
    await page.keyboard.type("abc");
    await page.waitForTimeout(200);
    const pending = await lastPromptEdit(injector);
    expect(pending.requestId).toBeTruthy();

    // 宿主那一跳还没回来，用户切到另一个会话（该会话已有草稿 hello）
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      isAuthenticated: true,
      permissionMode: "default",
      inputContent: "hello",
      session: { ...SESSION, id: "s-other-session" },
    });
    await expect(input).toHaveText("hello");

    await replyRewrite(injector, pending.requestId, "abc!");
    await page.waitForTimeout(300);

    // 旧会话那次编辑的改写必须被丢弃：新会话的草稿不能被它覆盖。
    await expect(input).toHaveText("hello");
    // 也不能被「上报成新会话的草稿」——那是同一件事的另一半。
    const drafts = (await injector.getMessagesSentToExtension())
      .filter((m) => m.command === "updateInputContent")
      .map((m) => ({ sessionId: m.sessionId, content: m.content }));
    expect(drafts.filter((d) => d.sessionId === "s-other-session")).toEqual([]);
  });

  test("mod 用 prompt.fill 换掉草稿后，旧回执不能覆盖它", async ({ page }) => {
    await openWebviewOnHttpOrigin(page);
    const injector = new MessageInjector(page);
    await setup(injector, page);

    const input = page.getByTestId("message-input");
    await input.click();
    await page.keyboard.type("abc");
    await page.waitForTimeout(200);
    const pending = await lastPromptEdit(injector);

    // 插件还没回，另一个 mod 先用 `$.prompt.fill` 把整份草稿换掉
    await injector.simulateExtensionMessage("desktopModPromptFill", {
      payload: { requestId: "fill-2", text: "mod 填的草稿", mode: "replace" },
    });
    await expect(input).toContainText("mod 填的草稿");

    await replyRewrite(injector, pending.requestId, "abc!");
    await page.waitForTimeout(300);

    // 回执针对的是一份已经不存在（被替换掉）的草稿：不能被套用。
    await expect(input).toHaveText("mod 填的草稿");
  });

  test("发送清空后到达的回执，不能在空输入框里复活上一句话", async ({
    page,
  }) => {
    await openWebviewOnHttpOrigin(page);
    const injector = new MessageInjector(page);
    await setup(injector, page);

    const input = page.getByTestId("message-input");
    await input.click();
    await page.keyboard.type("abc");
    await page.waitForTimeout(200);
    const pending = await lastPromptEdit(injector);

    // 用户回车发送：草稿连同 DOM 一起清空，这条消息已经离开发送框
    await page.keyboard.press("Enter");
    await expect(input).toHaveText("");

    await replyRewrite(injector, pending.requestId, "abc!");
    await page.waitForTimeout(300);

    // 已经发出去的那句话不该被改写回执重新写进空输入框。
    await expect(input).toHaveText("");
  });
});
