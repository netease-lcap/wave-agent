import type { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * 思考块全程收起（真 Chromium，量真几何）。
 *
 * 规格：docs/specs/core/stream-content-updates.md「思考块全程收起 + 流式尾部」。
 * 生成中是一行「思考中 Ns + 尾部 30 字」，不提供展开入口；结束后尾部消失、
 * 出现折叠箭头，仍是折叠态，且**行高与生成中完全一致**——这条是用户报的
 * 缺陷（生成时展开、结束时收起，行高两次突变，上方工具块里的文件路径跟着
 * 移位，点下去点到别的东西）。所以高度用真实 `getBoundingClientRect` 量，
 * 不接受「看起来差不多」。
 */

const LONG_REASONING =
  "用户问的是悲观锁在高并发下的性能问题，需要从锁竞争、事务持有时间、死锁三个角度展开，然后逐条对照乐观锁的代价与实际收益。";

function streamingReasoningMessage(): Message {
  return {
    id: "reason-msg",
    role: "assistant",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [
      {
        type: "reasoning",
        content: LONG_REASONING,
        stage: "streaming",
        startTime: Date.now(),
      },
    ],
  } as Message;
}

async function initWithStreamingReasoning(
  injector: MessageInjector,
  page: Page,
) {
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  await injector.updateMessages([streamingReasoningMessage()]);
  await injector.startStreaming();
  await page.waitForSelector(".reasoning-header");
}

function headerHeight(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".reasoning-header") as HTMLElement;
    return el.getBoundingClientRect().height;
  });
}

test.describe("reasoning block keeps a single collapsed line", () => {
  test("streaming: title + tail, no expand affordance, click does nothing", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithStreamingReasoning(injector, webviewPage);

    await expect(webviewPage.locator(".reasoning-title")).toHaveText(
      /思考中 \d+s/,
    );
    // 尾部：末 30 字符 + `…` 前缀（与工具块 compactParams 同口径）。
    const tail = webviewPage.locator(".reasoning-tail");
    await expect(tail).toBeVisible();
    await expect(tail).toContainText(LONG_REASONING.slice(-10));
    expect((await tail.textContent())?.startsWith("…")).toBe(true);

    // 生成中不提供展开入口：不是按钮、没有箭头、没有 aria-expanded。
    const header = webviewPage.locator(".reasoning-header");
    expect(
      await header.evaluate((el) => ({
        tag: el.tagName,
        aria: el.getAttribute("aria-expanded"),
      })),
    ).toEqual({ tag: "DIV", aria: null });
    await expect(webviewPage.locator(".reasoning-chevron")).toHaveCount(0);
    await expect(webviewPage.locator(".reasoning-content")).toHaveCount(0);

    // 点它也不展开。
    await header.click();
    await expect(webviewPage.locator(".reasoning-content")).toHaveCount(0);
  });

  test("finishing: tail disappears, chevron appears, height unchanged", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithStreamingReasoning(injector, webviewPage);
    const streamingHeight = await headerHeight(webviewPage);

    await injector.simulateExtensionMessage("updateStreamingReasoning", {
      messageId: "reason-msg",
      chunk: "",
      stage: "end",
    });

    await expect(webviewPage.locator(".reasoning-tail")).toHaveCount(0);
    await expect(webviewPage.locator(".reasoning-chevron")).toHaveCount(1);
    await expect(webviewPage.locator(".reasoning-header")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // 折叠态：正文仍未挂载，行高必须与生成中一模一样。
    await expect(webviewPage.locator(".reasoning-content")).toHaveCount(0);
    expect(
      Math.abs((await headerHeight(webviewPage)) - streamingHeight),
    ).toBeLessThan(0.5);

    // 结束后才可展开/收起。
    const header = webviewPage.locator(".reasoning-header");
    await header.click();
    await expect(webviewPage.locator(".reasoning-content")).toContainText(
      "悲观锁",
    );
    await header.click();
    await expect(webviewPage.locator(".reasoning-content")).toHaveCount(0);
  });
});
