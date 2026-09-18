import { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";

/**
 * The image tag (`@图片 1`) in a user message carries a hover Tooltip. Inside a
 * virtualized row that tooltip used to be laid out against the row instead of
 * the viewport (the row's `transform` became its containing block), so it
 * landed a row-height below the tag and its overflow grew the message list —
 * hovering the tag turned a fitting list into a scrolling one, i.e. the blank
 * area the user saw at the bottom, with the content no longer staying put.
 * Pure geometry: only a real browser can measure it, and `directDomUpdatesMode`
 * in MessageList is what keeps the tooltip viewport-anchored.
 */

const IMG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** A conversation long enough that the list overflows (it has a scrollbar). */
function buildScrollingConversation(count: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      id: `u${i}`,
      role: "user",
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
      blocks: [
        { type: "text", content: `问题 ${i}：看看这张图 [image1] 的实现。` },
        { type: "image", imageUrls: [IMG_DATA_URL] },
      ],
    });
    msgs.push({
      id: `a${i}`,
      role: "assistant",
      timestamp: new Date(
        Date.UTC(2026, 0, 1) + i * 60000 + 30000,
      ).toISOString(),
      blocks: [
        {
          type: "text",
          content: `回答 ${i}：好的。\n\n\`\`\`ts\nconst a = 1;\n\`\`\``,
        },
      ],
    });
  }
  return msgs;
}

/**
 * A conversation that fits the viewport exactly — the tallest shape that still
 * leaves the list unscrollable, which is where a misplaced (row-relative)
 * tooltip does the most damage: the tag sits low enough that the tooltip's
 * overflow flips the list into scrolling. The filler is assistant prose so the
 * image tag is the last row.
 */
function buildFittingConversation(fillerLines: number): Message[] {
  const filler = Array.from(
    { length: fillerLines },
    (_, i) => `第 ${i + 1} 行填充内容，用来把这一行撑高。`,
  ).join("\n\n");
  return [
    {
      id: "u0",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [{ type: "text", content: "先看第一张图 [image1]。" }],
    },
    {
      id: "a0",
      role: "assistant",
      timestamp: "2026-01-01T00:00:30.000Z",
      blocks: [{ type: "text", content: filler }],
    },
    {
      id: "u1",
      role: "user",
      timestamp: "2026-01-01T00:01:00.000Z",
      blocks: [
        { type: "text", content: "再看这张 [image1]。" },
        { type: "image", imageUrls: [IMG_DATA_URL] },
      ],
    },
  ];
}

type Rect = { x: number; y: number; width: number; height: number };

type Measurement = {
  tag: Rect | null;
  box: Rect | null;
  boxOffsetParent: string | null;
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  scrollTop: number;
};

async function initWithMessages(
  page: Page,
  injector: MessageInjector,
  messages: Message[],
  targetId: string,
) {
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  await injector.updateMessages(messages);
  await injector.endStreaming();
  await page.waitForSelector(`[data-message-id="${targetId}"]`);
  await page.waitForFunction(() => {
    const c = document.getElementById("messagesContainer") as HTMLElement;
    return c.scrollHeight - c.scrollTop - c.clientHeight <= 2;
  });
}

async function measure(page: Page, messageId: string): Promise<Measurement> {
  return page.evaluate((id) => {
    const container = document.getElementById(
      "messagesContainer",
    ) as HTMLElement;
    const tag = document.querySelector<HTMLElement>(
      `[data-message-id="${id}"] .context-tag`,
    );
    const box = document.querySelector<HTMLElement>(
      `[data-message-id="${id}"] .tooltip-box`,
    );
    const rect = (el: HTMLElement | null): Rect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      tag: rect(tag),
      box: rect(box),
      boxOffsetParent: box
        ? ((box.offsetParent as HTMLElement | null)?.className ?? null)
        : null,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth,
      scrollTop: container.scrollTop,
    };
  }, messageId);
}

/** Hover the image tag and wait until its tooltip is shown and positioned. */
async function hoverTag(page: Page, messageId: string) {
  const tag = page.locator(`[data-message-id="${messageId}"] .context-tag`);
  await tag.waitFor();
  await tag.hover();
  await page.waitForSelector(
    `[data-message-id="${messageId}"] .tooltip-box.visible`,
  );
  await page.waitForFunction(
    (id) => {
      const box = document.querySelector<HTMLElement>(
        `[data-message-id="${id}"] .tooltip-box`,
      );
      return !!box && box.style.left !== "";
    },
    messageId,
    { timeout: 3000 },
  );
  // The overflow grows the list on later frames (position → scrollHeight →
  // bottom-pin compensation), so measure only once the geometry has settled.
  await page.waitForTimeout(300);
}

/**
 * `position="top"` + offset 8: the tooltip's bottom edge sits just above the
 * tag, horizontally centered on it. A tooltip laid out against the row instead
 * of the viewport fails this by a row's offset (~200px) — the bug would let it
 * drift down the list.
 */
function expectAnchoredAboveTag(box: Rect | null, tag: Rect | null) {
  expect(box).not.toBeNull();
  expect(tag).not.toBeNull();
  if (!box || !tag) return;
  expect(Math.abs(box.y + box.height - (tag.y - 8))).toBeLessThanOrEqual(2);
  expect(
    Math.abs(box.x + box.width / 2 - (tag.x + tag.width / 2)),
  ).toBeLessThanOrEqual(2);
}

/** Hovering the tag must change nothing but the (absent) tooltip's position. */
function expectNoLayoutImpact(before: Measurement, after: Measurement) {
  expect(after.tag).toEqual(before.tag);
  expect(after.scrollHeight).toBe(before.scrollHeight);
  expect(after.scrollWidth).toBe(before.scrollWidth);
  expect(after.scrollTop).toBe(before.scrollTop);
}

test.describe("user message image tag tooltip", () => {
  test("a scrolling list: hovering the tag adds no blank space and does not move it", async ({
    webviewPage,
  }) => {
    const count = 30;
    const targetId = `u${count - 1}`;
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(
      webviewPage,
      injector,
      buildScrollingConversation(count),
      targetId,
    );

    const before = await measure(webviewPage, targetId);
    // Sanity: this really is the scrolling case.
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

    await hoverTag(webviewPage, targetId);
    const after = await measure(webviewPage, targetId);

    // Before the fix the misplaced tooltip grew scrollHeight by ~140px (blank
    // space under the last message) and scrollWidth by ~46px.
    expectNoLayoutImpact(before, after);
    expectAnchoredAboveTag(after.box, after.tag);
    // The tooltip belongs to the viewport, not to the virtualized row.
    expect(after.boxOffsetParent).toBeNull();
  });

  test("a list that fits: hovering the tag neither scrolls the list nor moves the tag", async ({
    webviewPage,
  }) => {
    const targetId = "u1";
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(
      webviewPage,
      injector,
      buildFittingConversation(8),
      targetId,
    );

    const before = await measure(webviewPage, targetId);

    await hoverTag(webviewPage, targetId);
    const after = await measure(webviewPage, targetId);

    // Before the fix the hover overflow turned this fitting list into a
    // scrolling one (453px → 647px): that is the blank area the user saw, and
    // the tag stops being a stable click target as soon as the list can scroll.
    expectNoLayoutImpact(before, after);
    expectAnchoredAboveTag(after.box, after.tag);
    expect(after.boxOffsetParent).toBeNull();
  });
});
