import { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";

/**
 * Virtualized MessageList (every message renders through the virtualizer) in
 * real Chromium.
 *
 * jsdom cannot validate layout — every geometry assertion here (bounded DOM
 * row count, spacer height, scroll round trip, sticky jump, streaming
 * bottom-pinning) only makes sense against a real browser.
 */

const VIRTUAL_MESSAGE_COUNT = 300;

// The virtualizer's initial estimate is avgMeasuredHeight = 200px. These rows
// alternate ~30px (short text) and ~1200px (60-line code fence), so the
// measured average keeps rising as the mounted window measures and the
// unmeasured rows re-estimate at it — the total keeps GROWING for a couple
// hundred ms after mount. That is the "growth direction": the opposite of
// buildMessages (whose ~30px rows SHRINK the spacer, where the browser's
// scrollTop clamp self-corrects a short pin). A pin chase with a fixed short
// frame cap gives up mid-growth and leaves the viewport parked above the true
// bottom.
function buildMixedHeights(count: number): Message[] {
  const code = Array.from(
    { length: 60 },
    (_, n) => `const value_${n} = compute(${n});`,
  ).join("\n");
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
    if (i % 2 === 0) {
      msgs.push({
        id: `mu${i}`,
        role: "user",
        timestamp,
        blocks: [{ type: "text", content: `短消息 ${i}` }],
      });
    } else {
      msgs.push({
        id: `ma${i}`,
        role: "assistant",
        timestamp,
        blocks: [
          {
            type: "text",
            content: `高回答 ${i}：\n\n\`\`\`ts\n${code}\n\`\`\``,
          },
        ],
      });
    }
  }
  return msgs;
}

function buildMessages(count: number, prefix = ""): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
    if (i % 4 === 0 || i % 4 === 3) {
      msgs.push({
        id: `${prefix}u${i}`,
        role: "user",
        timestamp,
        blocks: [
          { type: "text", content: `问题 ${i}：请检查这个文件的实现细节。` },
        ],
      });
    } else {
      msgs.push({
        id: `${prefix}a${i}`,
        role: "assistant",
        timestamp,
        blocks: [{ type: "text", content: `回答 ${i}：好的，我来看一下。` }],
      });
    }
  }
  return msgs;
}

async function initWithMessages(
  injector: MessageInjector,
  messages: Message[],
) {
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    configurationData: {
      apiKey: "sk-ant-api03-CXB9pH2k...mH8wQz",
      baseURL: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4-20250514",
      fastModel: "claude-haiku-4-20250514",
    },
    permissionMode: "default",
  });
  await injector.updateMessages(messages);
  await injector.endStreaming();
}

async function containerState(webviewPage: Page) {
  return webviewPage.evaluate(() => {
    const c = document.getElementById("messagesContainer") as HTMLElement;
    const spacer = c.querySelector<HTMLElement>(".virtual-spacer");
    return {
      virtualClass: c.classList.contains("messages-container--virtual"),
      rowCount: c.querySelectorAll(".virtual-row").length,
      spacerHeight: spacer ? spacer.getBoundingClientRect().height : 0,
      scrollHeight: c.scrollHeight,
      clientHeight: c.clientHeight,
      scrollTop: c.scrollTop,
      bottomGap: c.scrollHeight - c.scrollTop - c.clientHeight,
    };
  });
}

// The sticky bar must span the message list edge-to-edge: the container's 10px
// padding would otherwise leave left/right gutters (stretch only reaches the
// content box; the wrapper's negative margins cancel the padding).
async function expectStickyBarEdgeToEdge(webviewPage: Page) {
  const rects = await webviewPage.evaluate(() => {
    const c = document.getElementById("messagesContainer") as HTMLElement;
    const w = document.querySelector(
      ".sticky-user-wrapper",
    ) as HTMLElement | null;
    if (!w) return null;
    const cr = c.getBoundingClientRect();
    const wr = w.getBoundingClientRect();
    return { cr, wr };
  });
  expect(rects).not.toBeNull();
  if (!rects) return;
  expect(Math.abs(rects.wr.left - rects.cr.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(rects.wr.right - rects.cr.right)).toBeLessThanOrEqual(1);
}

test.describe("Virtualized message list demo", () => {
  test("narrow pane: rows keep the container's 10px side padding (match the input)", async ({
    webviewPage,
  }) => {
    // Regression guard: rows are absolutely positioned against the container's
    // padding box, so left: 0 + width: 100% covered the container's 10px
    // padding and butted against the pane edges whenever the pane is narrower
    // than the 800px column (the input area keeps 10px gutters there).
    await webviewPage.setViewportSize({ width: 480, height: 720 });
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector, buildMessages(40));

    await webviewPage.waitForSelector('[data-message-id="u39"]');
    const rects = await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      const row = c.querySelector<HTMLElement>(".virtual-row");
      if (!row) return null;
      const cr = c.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      return { cr, rr };
    });
    expect(rects).not.toBeNull();
    if (!rects) return;
    expect(Math.abs(rects.rr.left - (rects.cr.left + 10))).toBeLessThanOrEqual(
      1,
    );
    expect(
      Math.abs(rects.rr.right - (rects.cr.right - 10)),
    ).toBeLessThanOrEqual(1);
  });

  test("bounded DOM rows, real spacer height, scrollable, pinned to bottom", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector, buildMessages(VIRTUAL_MESSAGE_COUNT));

    // The last row must be rendered (initial load pinned to the bottom) before
    // geometry settles.
    await webviewPage.waitForSelector('[data-message-id="u299"]');
    await webviewPage.waitForFunction(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      return c.scrollHeight - c.scrollTop - c.clientHeight <= 2;
    });

    const state = await containerState(webviewPage);
    expect(state.virtualClass).toBe(true);
    // 300 messages must NOT render 300 rows: the virtualized window is
    // viewport/estimate + 2 × overscan (~50 rows here).
    expect(state.rowCount).toBeGreaterThan(0);
    expect(state.rowCount).toBeLessThan(120);
    // The spacer carries the real total height, not the container's height.
    expect(state.spacerHeight).toBeGreaterThan(1000);
    expect(state.scrollHeight).toBeGreaterThan(state.clientHeight);
    // Pinned to the true bottom (paddingStart/paddingEnd accounted).
    expect(state.bottomGap).toBeLessThanOrEqual(2);
  });

  test("scroll round trip renders both ends; sticky jump centers the target", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector, buildMessages(VIRTUAL_MESSAGE_COUNT));
    await webviewPage.waitForSelector('[data-message-id="u299"]');

    // Top of the list.
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      c.scrollTop = 0;
    });
    await webviewPage.waitForSelector('[data-message-id="u0"]');
    // Only the top rows are in the DOM now — the bottom row must be unmounted.
    expect(await webviewPage.$('[data-message-id="u299"]')).toBeNull();

    // Back to the bottom.
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      c.scrollTop = c.scrollHeight;
    });
    await webviewPage.waitForSelector('[data-message-id="u299"]');
    expect(await webviewPage.$('[data-message-id="u0"]')).toBeNull();

    // Scroll up a couple of thousand px so several user messages pass above
    // the viewport → the sticky bar pins the most recent one.
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      c.scrollTop = Math.max(0, c.scrollTop - 3000);
    });
    await webviewPage.waitForSelector('[data-testid="sticky-user-message"]');
    // The bar must cover the list edge-to-edge (no 10px padding gutters).
    await expectStickyBarEdgeToEdge(webviewPage);
    // While row measurements are still converging (estimate 200px → real
    // heights), the sticky candidate can briefly flip between two adjacent
    // user messages. Reading the text in that window would pick a target that
    // no longer matches the onClick closure by click time. Wait until the
    // sticky text is stable across two samples before trusting it.
    const stickyText = await webviewPage.evaluate(async () => {
      const sel = '[data-testid="sticky-user-message"] .sticky-user-content';
      let prev = "";
      for (let i = 0; i < 20; i++) {
        const cur = document.querySelector(sel)?.textContent?.trim() ?? "";
        if (cur && cur === prev) return cur;
        prev = cur;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return prev;
    });
    expect(stickyText.length).toBeGreaterThan(0);

    const targetId = buildMessages(VIRTUAL_MESSAGE_COUNT).find(
      (m) =>
        m.role === "user" &&
        m.blocks
          .filter((b) => b.type === "text")
          .map((b) => b.content || "")
          .join(" ")
          .trim() === stickyText,
    )?.id;
    expect(targetId).toBeTruthy();

    // Clicking the sticky bar jumps (virtualizer.scrollToIndex) to the target
    // message and centers it in the viewport.
    await webviewPage.click('[data-testid="sticky-user-message"]');
    await webviewPage.waitForSelector(`[data-message-id="${targetId}"]`);
    await webviewPage.waitForFunction(
      (id) => {
        const c = document.getElementById("messagesContainer") as HTMLElement;
        const row = c.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
        if (!row) return false;
        const cb = c.getBoundingClientRect();
        const rb = row.getBoundingClientRect();
        return Math.abs(rb.top - cb.top - (cb.height - rb.height) / 2) < 40;
      },
      targetId,
      { timeout: 3000 },
    );
  });

  test("streaming bottom-pinning: settled dist ≤ 2, no upward jumps", async ({
    webviewPage,
  }) => {
    // Regression guard: resizeItem's scroll compensation (streaming row
    // growth) fires notify(sync) from measureElement, which runs as a ref
    // callback inside React's commit phase. The virtualizer's default
    // useFlushSync would call flushSync(rerender) there and React rejects it
    // with "flushSync was called from inside a lifecycle method". Catch the
    // warning so it can't silently come back.
    const reactWarnings: string[] = [];
    webviewPage.on("console", (msg) => {
      // React emits dev-mode warnings via console.error (printWarning), not
      // console.warn — match on the message text.
      if (msg.text().includes("flushSync")) {
        reactWarnings.push(msg.text());
      }
    });
    const injector = new MessageInjector(webviewPage);
    const msgs = buildMessages(VIRTUAL_MESSAGE_COUNT);
    msgs.push({
      id: "stream-msg",
      role: "assistant",
      timestamp: new Date().toISOString(),
      blocks: [{ type: "text", content: "开始流式输出：", stage: "streaming" }],
    });
    await initWithMessages(injector, msgs);
    await injector.startStreaming();
    await webviewPage.waitForSelector('[data-message-id="stream-msg"]');
    await webviewPage.waitForFunction(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      return c.scrollHeight - c.scrollTop - c.clientHeight <= 2;
    });

    // Grow the streaming last row chunk by chunk (the incremental
    // updateStreamingContent path). The viewport must stay pinned to the
    // bottom: settled dist ≤ 2 and scrollTop never goes backward.
    const chunks = [
      "第一段内容",
      "第二段内容，继续增长",
      "第三段：添加更多说明文字",
      "第四段：继续输出详细的分析",
      "第五段：保持视口钉在底部",
      "第六段：测量与滚动补偿",
      "第七段：不得向上回跳",
      "第八段：流式内容持续增长",
      "第九段：再补一行验证",
      "第十段：收尾结束流式输出",
    ];
    let prevScrollTop = (await containerState(webviewPage)).scrollTop;
    for (const chunk of chunks) {
      await injector.simulateExtensionMessage("updateStreamingContent", {
        messageId: "stream-msg",
        chunk,
        stage: "streaming",
      });
      // The streaming row grows in stages (text render → resizeItem → spacer
      // write → scroll compensation), so a single instant may read dist ≤ 2
      // mid-flight and then grow again. Require the pinned state to hold for
      // 200ms before trusting it.
      await webviewPage.waitForFunction(
        async ({ id, suffix }) => {
          const c = document.getElementById("messagesContainer") as HTMLElement;
          const row = c.querySelector(`[data-message-id="${id}"]`);
          if (!row || !row.textContent?.includes(suffix)) return false;
          const dist = () => c.scrollHeight - c.scrollTop - c.clientHeight;
          if (dist() > 2) return false;
          await new Promise((resolve) => setTimeout(resolve, 200));
          return dist() <= 2;
        },
        { id: "stream-msg", suffix: chunk },
        { timeout: 5000 },
      );
      const state = await containerState(webviewPage);
      expect(state.bottomGap).toBeLessThanOrEqual(2);
      expect(state.scrollTop).toBeGreaterThanOrEqual(prevScrollTop - 2);
      prevScrollTop = state.scrollTop;
    }
    expect(reactWarnings).toEqual([]);
  });

  test("initial load pins to the true bottom while rows measure taller than the estimate (growth direction)", async ({
    webviewPage,
  }) => {
    // The initial estimate starts at avgMeasuredHeight = 200px; the mixed
    // heights keep the measured average rising as the window measures, so the
    // total grows for a couple hundred ms after mount (a chase with a fixed
    // short frame cap gives up mid-growth and leaves the viewport 5.7k px
    // above the true bottom on the old implementation). The pin must follow
    // the growth to the end and stay there.
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector, buildMixedHeights(VIRTUAL_MESSAGE_COUNT));

    await webviewPage.waitForSelector('[data-message-id="ma299"]');
    await webviewPage.waitForFunction(
      () => {
        const c = document.getElementById("messagesContainer") as HTMLElement;
        return c.scrollHeight - c.scrollTop - c.clientHeight <= 2;
      },
      undefined,
      { timeout: 10000 },
    );

    // The growth really happened: the final total must be far above the
    // estimate-based baseline (300 rows × 200px = 60,000).
    const s = await containerState(webviewPage);
    expect(s.scrollHeight).toBeGreaterThan(60000 * 2);
    expect(s.bottomGap).toBeLessThanOrEqual(2);
    // The pin holds — a later sample is still at the bottom (no slow-drift
    // recovery was needed).
    await webviewPage.waitForTimeout(500);
    const s2 = await containerState(webviewPage);
    expect(s2.bottomGap).toBeLessThanOrEqual(2);
    expect(s2.scrollTop).toBeGreaterThanOrEqual(s.scrollTop);
    console.log(
      `[growth-direction] scrollHeight=${s.scrollHeight} scrollTop=${s.scrollTop} gap=${s.bottomGap.toFixed(2)} rows=${s.rowCount}`,
    );
  });
});
