import { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";

/**
 * Streaming + wheel scroll-up in real Chromium.
 *
 * jsdom cannot validate layout, and the pull-back regression is a frame-level
 * race: a streaming chunk's programmatic pin can win against the user's wheel
 * scroll because browsers dispatch the synthesized 'scroll' event on a later
 * rendering frame (~70% land after the next rAF — past a one-frame
 * programmatic-scroll flag). The wheel intent must be latched at the input
 * event itself. We interleave dense streaming chunks with genuine wheel
 * scroll-up gestures and assert the viewport is never yanked back to the
 * bottom (fails on the pre-fix code, passes on the fix).
 */

function buildHistory(count: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
    if (i % 2 === 0) {
      msgs.push({
        id: `hu${i}`,
        role: "user",
        timestamp,
        blocks: [{ type: "text", content: `历史问题 ${i}` }],
      });
    } else {
      msgs.push({
        id: `ha${i}`,
        role: "assistant",
        timestamp,
        blocks: [
          {
            type: "text",
            content: `历史回答 ${i}：这是一段较长的历史内容方便阅读回滚。${"填充".repeat(40)}`,
          },
        ],
      });
    }
  }
  return msgs;
}

const chunk = (n: number) =>
  `第${n}段流式：${"流式生成的思考与正文内容持续追加，让增长行不断触发测量与程序钉底。".repeat(10)}`;

async function geometry(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById("messagesContainer") as HTMLElement;
    return {
      scrollTop: c.scrollTop,
      scrollHeight: c.scrollHeight,
      clientHeight: c.clientHeight,
      gap: c.scrollHeight - c.scrollTop - c.clientHeight,
    };
  });
}

test("dense streaming + wheel up never yanks back to bottom", async ({
  webviewPage,
}) => {
  const injector = new MessageInjector(webviewPage);
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
  const history = buildHistory(140);
  history.push({
    id: "live-msg",
    role: "assistant",
    timestamp: new Date().toISOString(),
    blocks: [{ type: "text", content: "开头", stage: "streaming" }],
  });
  await injector.updateMessages(history);
  await injector.startStreaming();
  await webviewPage.waitForSelector('[data-message-id="live-msg"]');
  await webviewPage.waitForFunction(() => {
    const c = document.getElementById("messagesContainer") as HTMLElement;
    return c.scrollHeight - c.scrollTop - c.clientHeight <= 2;
  });
  await webviewPage.waitForTimeout(300);

  // Park the mouse over the message list, then interleave upward wheel
  // gestures with streaming chunks (the racy window that used to pull back).
  const box = await webviewPage.locator("#messagesContainer").boundingBox();
  if (!box) throw new Error("no container box");
  await webviewPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const lows: number[] = [];
  let scrolled = false;
  for (let i = 1; i <= 40; i++) {
    if (i % 3 === 0) {
      await webviewPage.mouse.wheel(0, -240);
      scrolled = true;
    }
    await injector.simulateExtensionMessage("updateStreamingContent", {
      messageId: "live-msg",
      chunk: chunk(i),
      stage: "streaming",
    });
    if (i % 5 === 0) {
      const g = await geometry(webviewPage);
      lows.push(g.scrollTop);
    }
  }
  await webviewPage.waitForTimeout(500);
  const end = await geometry(webviewPage);
  console.log(
    `[wheel-scroll] scrolled=${scrolled} sampledTops=${JSON.stringify(lows)}`,
  );
  console.log(
    `[wheel-scroll] end scrollTop=${end.scrollTop} gap=${end.gap.toFixed(0)} maxScroll=${(end.scrollHeight - end.clientHeight).toFixed(0)}`,
  );
  // The user wheeled up during streaming: the final viewport must NOT sit at
  // the bottom (gap ≫ 0).
  expect(end.gap).toBeGreaterThan(1500);
});
