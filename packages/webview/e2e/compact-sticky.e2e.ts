import { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";

/**
 * Compaction + sticky bar in real Chromium.
 *
 * After compaction the host sends the FULL display list (pre-compaction
 * history + compact block + post-compaction messages) via updateMessages.
 * The sticky candidate scan runs over the whole data list, so pre-compaction
 * user messages must be able to pin the sticky bar and be jumped back to —
 * the UI never clears pre-compaction history.
 */

// 15 pre-compaction user/assistant pairs + 1 compact block + 5 post pairs.
const PRE_PAIRS = 15;
const POST_PAIRS = 5;

function buildCompactedMessages(): Message[] {
  const msgs: Message[] = [];
  const ts = (i: number) =>
    new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
  for (let i = 0; i < PRE_PAIRS; i++) {
    msgs.push({
      id: `pre-u${i}`,
      role: "user",
      timestamp: ts(i * 2),
      blocks: [{ type: "text", content: `压缩前问题 ${i}` }],
    });
    msgs.push({
      id: `pre-a${i}`,
      role: "assistant",
      timestamp: ts(i * 2 + 1),
      blocks: [{ type: "text", content: `压缩前回答 ${i}` }],
    });
  }
  msgs.push({
    id: "compact-1",
    role: "assistant",
    timestamp: ts(PRE_PAIRS * 2),
    blocks: [{ type: "compact", content: "以下是早前对话的压缩摘要……" }],
  });
  for (let i = 0; i < POST_PAIRS; i++) {
    msgs.push({
      id: `post-u${i}`,
      role: "user",
      timestamp: ts(PRE_PAIRS * 2 + i * 2 + 1),
      blocks: [{ type: "text", content: `压缩后问题 ${i}` }],
    });
    msgs.push({
      id: `post-a${i}`,
      role: "assistant",
      timestamp: ts(PRE_PAIRS * 2 + i * 2 + 2),
      blocks: [{ type: "text", content: `压缩后回答 ${i}` }],
    });
  }
  return msgs;
}

async function initWithCompactedMessages(
  injector: MessageInjector,
  messages: Message[],
) {
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
  await injector.updateMessages(messages);
  await injector.endStreaming();
}

// The sticky text can flip between two adjacent user messages while row
// measurements converge (estimate 200px → real ~30px); wait until the text is
// stable across two samples before trusting it (mirrors virtual-message-list).
async function readStableStickyText(webviewPage: Page): Promise<string> {
  return webviewPage.evaluate(async () => {
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
}

test.describe("compaction keeps pre-compact user messages reachable via the sticky bar", () => {
  test("scrolling up through pre-compaction history pins a pre-compact user message", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithCompactedMessages(injector, buildCompactedMessages());

    // Initial load pins to the bottom; wait for the geometry to settle before
    // scrolling (the estimated total shrinks as rows measure).
    await webviewPage.waitForSelector('[data-message-id="post-a4"]');
    await webviewPage.waitForFunction(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      return c.scrollHeight - c.scrollTop - c.clientHeight <= 2;
    });
    await webviewPage.waitForTimeout(400);

    // Jump back into the pre-compaction region (roughly the middle of the
    // list, well above the compact block).
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      c.scrollTop = c.scrollHeight * 0.35;
    });
    await webviewPage.waitForSelector('[data-testid="sticky-user-message"]');

    const stickyText = await readStableStickyText(webviewPage);
    // The sticky candidate is a PRE-compaction user message — the UI must not
    // clear/hide pre-compaction history from the sticky computation.
    expect(stickyText).toMatch(/^压缩前问题 \d+$/);
  });

  test("clicking the sticky bar jumps back to the pre-compact user message", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithCompactedMessages(injector, buildCompactedMessages());

    await webviewPage.waitForSelector('[data-message-id="post-a4"]');
    await webviewPage.waitForFunction(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      return c.scrollHeight - c.scrollTop - c.clientHeight <= 2;
    });
    await webviewPage.waitForTimeout(400);

    // Same pre-compaction scroll position as the first test.
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      c.scrollTop = c.scrollHeight * 0.35;
    });
    await webviewPage.waitForSelector('[data-testid="sticky-user-message"]');

    const stickyText = await readStableStickyText(webviewPage);
    const targetId = buildCompactedMessages().find(
      (m) =>
        m.role === "user" &&
        m.blocks
          .filter((b) => b.type === "text")
          .map((b) => b.content || "")
          .join(" ")
          .trim() === stickyText,
    )?.id;
    expect(targetId).toMatch(/^pre-u\d+$/);

    // Click the sticky bar → the virtualizer scrolls the pre-compaction user
    // message into view and centers it.
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

    // The compact block still exists below the jump target (the transcript
    // keeps every summary block in order).
    const compactVisible = await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      const row = c.querySelector<HTMLElement>('[data-message-id="compact-1"]');
      return row
        ? row.getBoundingClientRect().top > c.getBoundingClientRect().top
        : false;
    });
    expect(compactVisible).toBe(true);
  });
});
