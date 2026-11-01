import type { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * 远控页手机档：工具错误信息与 short result 同档（spec remote/remote-mobile.md
 * 场景 3 的档位表）。
 *
 * 报障（用户 2026-11-01）：「遥控页面上这个错误的字号有点大，我希望它的字号跟那个
 * 普通 short result 的字号差不多」。根因与桌面端那次（PR #2664）同一个：base
 * `Message.css` 的 `.tool-error` 只声明颜色/斜体/`max-height`，**没有 `font-size`**，
 * 于是从 `body` 继承手机档的阅读主体 15px；而 short result（`.result-raw` /
 * `.write-tool-stats` / `.tool-result-block`）已被本页收进辅助档 13px —— 同一条工具
 * 名下的一行说明，比它下面那行 short result 还大一号。
 *
 * 为什么用真浏览器量 computed 值：jsdom 不解析样式表，单测只能读到文本；而这个 bug
 * 恰好是「样式表里根本没有这条声明」，盯着 CSS 文本看反而看不出。
 *
 * ⚠️ 加载的是 dist 产物 CSS：改过样式先跑 `pnpm -F wave-webview build`。
 */

test.use({
  // 远控页标记在应用启动前就位，与 remote/shim.js 在真实页面上做的一致。
  remotePage: true,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

/**
 * 同一条助手消息里两个工具块：上面一条失败（只渲染错误）、下面一条正常（只渲染
 * short result）—— 错误块**不会**同时带 short result（`Message.tsx` 里
 * `!errorContent && result`），所以他看到的是上下两个块之间的对比。
 */
async function injectFailedAndOkTools(page: Page) {
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-remote-page", "1");
  });
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });

  const failedTool = {
    id: "msg_tool_error_font",
    role: "assistant",
    blocks: [
      {
        type: "tool",
        name: "mcp__nebula__search_docs",
        stage: "end",
        compactParams: "query=transactionId",
        parameters: JSON.stringify({ query: "transactionId" }),
        error: "Error: connect ECONNREFUSED 10.0.0.7:7700\n  at TCPConnectWrap",
        success: false,
      },
      {
        type: "tool",
        name: "mcp__nebula__read_doc",
        stage: "end",
        compactParams: "path=payments.md",
        parameters: JSON.stringify({ path: "payments.md" }),
        shortResult: "3 段 · payments.md",
        success: true,
      },
    ],
  };

  await injector.updateMessages([failedTool as unknown as Message]);
}

/** 量与「字号」有关的三个值：字号、行高、以及本页的角色参照。 */
const readSizes = (page: Page) =>
  page.evaluate(() => {
    const read = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, lineHeight: cs.lineHeight };
    };
    return {
      toolError: read(".tool-error"),
      toolErrorPre: read(".tool-error pre"),
      shortResult: read(".result-raw"),
      toolResultBlock: read(".tool-result-block"),
      // 参照：工具块标题（阅读主体档 15/22）与页面正文（15px）
      toolBlock: read(".tool-block"),
      body: read("body"),
    };
  });

test("远控页手机档：工具错误的字号与 short result 同档", async ({
  webviewPage,
}) => {
  await injectFailedAndOkTools(webviewPage);

  const error = webviewPage.locator(".tool-error");
  await expect(error).toBeVisible();
  await expect(webviewPage.locator(".result-raw")).toBeVisible();

  const sizes = await readSizes(webviewPage);
  console.log("远控页字号实测：", JSON.stringify(sizes, null, 2));

  expect(sizes.shortResult, "short result 没渲染出来").not.toBeNull();
  expect(sizes.toolError, "工具错误没渲染出来").not.toBeNull();

  // 用户要的那句话：同一处工具说明，错误与 short result 是同一档。
  expect(
    sizes.toolError!.fontSize,
    `工具错误 ${sizes.toolError!.fontSize} 与 short result ${sizes.shortResult!.fontSize} 不同档`,
  ).toBe(sizes.shortResult!.fontSize);

  // `.tool-error pre` 只继承容器，不该自己另立一档（否则改了容器也白改）。
  expect(sizes.toolErrorPre!.fontSize).toBe(sizes.toolError!.fontSize);

  // 反面证据：错误信息必须比阅读主体（工具块标题 15/22）小 —— 这条防的是「把
  // short result 也抬上去」这种改反方向的修法。
  expect(parseFloat(sizes.toolError!.fontSize)).toBeLessThan(
    parseFloat(sizes.toolBlock!.fontSize),
  );

  // 行高也随档走：`.result-raw` 的 1.4 倍行高就是这个角色的节奏，两行不该一个
  // 18.2px、一个 22px（同字号下松紧不同一样看着不是一套）。
  expect(sizes.toolError!.lineHeight).toBe(sizes.shortResult!.lineHeight);
});
