import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * Compaction loading hint visibility in real Chromium.
 *
 * Regression: the hint (and its streaming tail) rendered with ZERO height —
 * the `.compaction-hint` was the only shrinkable flex item after the
 * virtualizer's in-flow spacer (flex-shrink: 0) filled the column, so it
 * absorbed all the negative free space and collapsed (overflow: hidden then
 * clipped the tail). The hint must keep its own height (flex-shrink: 0) and
 * be re-pinned into the viewport when compaction starts (scrollToEnd only
 * accounts for row heights, leaving the hint below the fold).
 */

function buildMessages(): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < 12; i++) {
    msgs.push({
      id: `u${i}`,
      role: "user",
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 120000).toISOString(),
      blocks: [
        {
          type: "text",
          content: `第 ${i + 1} 个问题：如何优化这个系统的性能？`,
        },
      ],
    });
    msgs.push({
      id: `a${i}`,
      role: "assistant",
      timestamp: new Date(
        Date.UTC(2026, 0, 1) + i * 120000 + 60000,
      ).toISOString(),
      blocks: [
        {
          type: "text",
          content: `这是第 ${i + 1} 个回答。需要从缓存、数据库索引、请求合并三个方向入手，同时考虑水平扩展与降级策略。`,
        },
      ],
    });
  }
  return msgs;
}

async function initWithMessages(injector: MessageInjector) {
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    configurationData: {
      apiKey: "sk-ant-api03-test",
      baseURL: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4-20250514",
    },
    permissionMode: "default",
  });
  await injector.updateMessages(buildMessages());
  await injector.endStreaming();
}

test.describe("compaction loading hint visibility", () => {
  test("hint has height, sits inside the viewport, and shows the streaming tail", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector);

    await webviewPage.waitForSelector('[data-message-id="a11"]');
    // Let the initial pin-to-bottom settle (estimate→measure waves).
    await webviewPage.waitForFunction(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      return c.scrollHeight - c.scrollTop - c.clientHeight <= 2;
    });

    // ── Compaction starts: hint only (no streamed text yet) ──
    await injector.simulateExtensionMessage("compactionStateChange", {
      isCompacting: true,
    });
    await webviewPage.waitForFunction(() => {
      const h = document.querySelector(
        '[data-testid="compaction-hint"]',
      ) as HTMLElement;
      return Boolean(h && h.getBoundingClientRect().height > 0);
    });

    const hintGeometry = await webviewPage.evaluate(() => {
      const h = document.querySelector(
        '[data-testid="compaction-hint"]',
      ) as HTMLElement;
      const c = document.getElementById("messagesContainer") as HTMLElement;
      if (!h) return { hintExists: false };
      const hr = h.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      return {
        hintExists: true,
        height: hr.height,
        // The hint must be inside the container's scroll viewport — the
        // original bug left it zero-height, and even with a height it was
        // 3px below the fold (no re-pin on compaction start).
        fullyInsideViewport: hr.top >= cr.top && hr.bottom <= cr.bottom + 0.5,
      };
    });
    expect(hintGeometry.hintExists).toBe(true);
    expect(hintGeometry.height).toBeGreaterThan(0);
    expect(hintGeometry.fullyInsideViewport).toBe(true);
    expect(webviewPage.locator('[data-testid="compaction-hint"]')).toHaveText(
      /正在压缩对话/,
    );

    // ── Streamed summary arrives: tail shows, also inside the viewport ──
    const longContent =
      "这是一个非常长的压缩总结，包含了对整个会话所有关键决策与结论的浓缩……" +
      "接下来是更多的尾部文本，用于验证最后三十个字符的流式尾部预览效果是否正常显示。";
    await injector.simulateExtensionMessage("compactionContentUpdate", {
      content: longContent,
    });

    const tailGeometry = await webviewPage.evaluate(() => {
      const t = document.querySelector(
        '[data-testid="compaction-hint-tail"]',
      ) as HTMLElement;
      const c = document.getElementById("messagesContainer") as HTMLElement;
      if (!t) return { tailExists: false };
      const tr = t.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      return {
        tailExists: true,
        height: tr.height,
        fullyInsideViewport: tr.top >= cr.top && tr.bottom <= cr.bottom + 0.5,
      };
    });
    expect(tailGeometry.tailExists).toBe(true);
    expect(tailGeometry.height).toBeGreaterThan(0);
    expect(tailGeometry.fullyInsideViewport).toBe(true);
    // Last-30-chars truncation behind an ellipsis (mirrors streamingTail).
    await expect(
      webviewPage.locator('[data-testid="compaction-hint-tail"]'),
    ).toHaveText(/^…/);

    // ── Compaction ends: hint and tail disappear ──
    await injector.simulateExtensionMessage("compactionStateChange", {
      isCompacting: false,
    });
    await expect(
      webviewPage.locator('[data-testid="compaction-hint"]'),
    ).toHaveCount(0);
    await expect(
      webviewPage.locator('[data-testid="compaction-hint-tail"]'),
    ).toHaveCount(0);
  });
});
