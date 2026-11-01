import type { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * 工具错误信息与 short result 同档 —— 「没被点名的那两档」这一半。
 *
 * 报障（用户 2026-11-01，先报远控页、随后追加插件端）：错误信息看着比同一工具名下
 * 的正常 short result 大一号。根因是 base `Message.css` 的 `.tool-error` 只声明颜色/
 * 斜体/`max-height`、**没有 `font-size`**，于是从 `body` 继承正文（插件端 13px），
 * 而 short result（`.result-raw` / `.tool-result-block`）是辅助档 11px。
 *
 * 桌面端那一档已经由 `host-desktop.css` 的 `[data-host="desktop"] .tool-error{12/20}`
 * 收过（PR #2664）；远控手机档同理（`remote-page.css`，13/18.2，见
 * remote-tool-error-font.e2e.ts）。这两条覆写的特异性都比 base 的 `.tool-error` 高，
 * 所以 base 补了字号之后它们**必须仍然各走各的** —— 本文件第二个用例就是钉这件事。
 *
 * ⚠️ 加载的是 dist 产物 CSS：改过样式先跑 `pnpm -F wave-webview build`。
 */

/** 同一条助手消息：上面一条工具失败（只渲染错误），下面一条正常（只渲染 short result）。 */
async function injectFailedAndOkTools(page: Page) {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });

  const message = {
    id: "msg_tool_error_font_tier",
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

  await injector.updateMessages([message as unknown as Message]);
  await page.waitForSelector(".tool-error");
  await page.waitForSelector(".result-raw");
}

const readSizes = (page: Page) =>
  page.evaluate(() => {
    const read = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, lineHeight: cs.lineHeight };
    };
    return {
      host: document.documentElement.dataset.host,
      toolError: read(".tool-error"),
      toolErrorPre: read(".tool-error pre"),
      shortResult: read(".result-raw"),
      // 参照：阅读主体档的工具块标题（插件端 13/18、桌面端 13/18）
      toolBlock: read(".tool-block"),
    };
  });

test("插件端：工具错误的字号与 short result 同档", async ({ webviewPage }) => {
  await injectFailedAndOkTools(webviewPage);

  const sizes = await readSizes(webviewPage);
  console.log("插件端字号实测：", JSON.stringify(sizes, null, 2));

  expect(sizes.host, "默认 harness 就是插件端（editor 档）").toBe("editor");
  expect(sizes.shortResult, "short result 没渲染出来").not.toBeNull();

  // 用户要的那句话：同一处工具说明，错误与 short result 是同一档。
  expect(
    sizes.toolError!.fontSize,
    `工具错误 ${sizes.toolError!.fontSize} 与 short result ${sizes.shortResult!.fontSize} 不同档`,
  ).toBe(sizes.shortResult!.fontSize);
  expect(sizes.toolError!.lineHeight).toBe(sizes.shortResult!.lineHeight);

  // `.tool-error pre` 只继承容器，不该自己另立一档。
  expect(sizes.toolErrorPre!.fontSize).toBe(sizes.toolError!.fontSize);

  // 反面证据：它必须仍比阅读主体的工具块标题小 —— 防「把 short result 抬上去」的改法。
  expect(parseFloat(sizes.toolError!.fontSize)).toBeLessThan(
    parseFloat(sizes.toolBlock!.fontSize),
  );
});

test("桌面端：那条 12/20 的覆写不受 base 影响", async ({ webviewPage }) => {
  await injectFailedAndOkTools(webviewPage);

  // 这里验的是 CSS 层叠（`[data-host="desktop"]` 那条专门值），用不到桌面壳的
  // DesktopApp 布局：同一份消息注入完把宿主标记切过去即可，桌面端渲染本身由
  // desktop-*.e2e.ts 那批覆盖。
  await webviewPage.evaluate(() => {
    document.documentElement.dataset.host = "desktop";
    document.documentElement.setAttribute("data-theme", "dark");
  });

  const sizes = await readSizes(webviewPage);
  expect(sizes.host).toBe("desktop");
  expect(sizes.toolError).toEqual({ fontSize: "12px", lineHeight: "20px" });
  expect(sizes.shortResult).toEqual({ fontSize: "12px", lineHeight: "20px" });
});
