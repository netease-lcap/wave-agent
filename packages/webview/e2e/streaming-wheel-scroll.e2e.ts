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

/**
 * Clicking the sticky user bar while the model is streaming must LAND on that
 * message and stay there. Two independent failures made the bar look dead
 * mid-stream: (1) the click didn't opt out of bottom-following, so the next
 * chunk's programmatic pin yanked the viewport back; (2) the jump was smooth,
 * and while a smooth jump walks frame by frame the rows entering the viewport
 * get measured, the virtualizer's resize compensation scrolls back to its
 * recorded (still bottom) offset and cancels the jump — measured, the
 * viewport moved 71px and snapped back. Real Chromium only: both are
 * frame-level races.
 */
test("sticky-bar jump lands during streaming and survives it", async ({
  webviewPage,
}) => {
  const injector = new MessageInjector(webviewPage);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
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
  await webviewPage.waitForSelector('[data-testid="sticky-user-message"]');

  // Same convergence guard as the virtual-list suite: while measurements
  // settle the sticky candidate can briefly flip between two adjacent user
  // messages, so only trust the text once it is stable across two samples.
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
  const targetId = buildHistory(140).find(
    (m) =>
      m.role === "user" &&
      (m.blocks ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.content || "")
        .join(" ")
        .trim() === stickyText,
  )?.id;
  expect(targetId).toBeTruthy();

  await webviewPage.click('[data-testid="sticky-user-message"]');

  // Keep streaming while the user reads the message they just jumped to.
  for (let i = 1; i <= 40; i++) {
    await injector.simulateExtensionMessage("updateStreamingContent", {
      messageId: "live-msg",
      chunk: chunk(i),
      stage: "streaming",
    });
    await webviewPage.waitForTimeout(30);
  }
  await webviewPage.waitForTimeout(500);

  // The target row must sit inside the viewport (the jump really landed) …
  const row = await webviewPage.evaluate((id) => {
    const c = document.getElementById("messagesContainer") as HTMLElement;
    const el = c.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    if (!el) return null;
    return {
      top: Math.round(
        el.getBoundingClientRect().top - c.getBoundingClientRect().top,
      ),
      clientHeight: c.clientHeight,
    };
  }, targetId as string);
  console.log(`[sticky-jump] row=${JSON.stringify(row)}`);
  expect(row).not.toBeNull();
  expect(row!.top).toBeGreaterThanOrEqual(0);
  expect(row!.top).toBeLessThan(row!.clientHeight);

  // … and the viewport must not have been dragged back to the bottom since.
  const end = await geometry(webviewPage);
  console.log(
    `[sticky-jump] end scrollTop=${end.scrollTop} gap=${end.gap.toFixed(0)}`,
  );
  expect(end.gap).toBeGreaterThan(1500);
});

/**
 * The "at the bottom" band must be tight. With the old 300px band, a user who
 * nudge-scrolled up but stayed within 300px of the bottom was still classified
 * as being at the bottom, so the next non-programmatic scroll event cleared the
 * opt-out and the streaming pin dragged the viewport back down — which is what
 * the intermittent "I scrolled up and it pulled me back" report looks like.
 * Park the viewport INSIDE that old band (10px < gap < 300px), keep streaming,
 * and require it to stay parked.
 */
test("a light wheel nudge inside the old 300px band still suspends following", async ({
  webviewPage,
}) => {
  const injector = new MessageInjector(webviewPage);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
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

  const box = await webviewPage.locator("#messagesContainer").boundingBox();
  if (!box) throw new Error("no container box");
  await webviewPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // A light nudge, not a deep scroll: converge on the band the old threshold
  // wrongly called "at the bottom".
  for (let i = 0; i < 8; i++) {
    const g = await geometry(webviewPage);
    if (g.gap > 140 && g.gap < 280) break;
    await webviewPage.mouse.wheel(0, g.gap < 140 ? -120 : 120);
    await webviewPage.waitForTimeout(80);
  }
  const parked = await geometry(webviewPage);
  console.log(
    `[nudge-park] parked gap=${parked.gap.toFixed(0)} scrollTop=${parked.scrollTop}`,
  );
  expect(parked.gap).toBeGreaterThan(10);
  expect(parked.gap).toBeLessThan(300);

  // The virtualizer's own resize compensation scrolls the container directly —
  // it does not go through scrollToFn, so the event carries no programmatic
  // mark. Reproduce that shape: an unmarked downward nudge that leaves the
  // viewport far from the bottom. On the old 300px band this single event was
  // enough to clear the opt-out ("still within 300px, so the user is at the
  // bottom"), and the next chunk's pin dragged the viewport all the way down.
  const compensated = await webviewPage.evaluate(() => {
    const c = document.getElementById("messagesContainer") as HTMLElement;
    c.scrollTop = Math.min(
      c.scrollTop + 60,
      Math.max(0, c.scrollHeight - c.clientHeight - 40),
    );
    return { gap: c.scrollHeight - c.scrollTop - c.clientHeight };
  });
  await webviewPage.waitForTimeout(120);
  console.log(
    `[nudge-park] after unmarked down nudge gap=${compensated.gap.toFixed(0)}`,
  );
  expect(compensated.gap).toBeGreaterThan(10);
  expect(compensated.gap).toBeLessThan(300);

  const gaps: number[] = [];
  for (let i = 1; i <= 40; i++) {
    await injector.simulateExtensionMessage("updateStreamingContent", {
      messageId: "live-msg",
      chunk: chunk(i),
      stage: "streaming",
    });
    if (i % 5 === 0) gaps.push((await geometry(webviewPage)).gap);
    await webviewPage.waitForTimeout(30);
  }
  await webviewPage.waitForTimeout(400);

  const end = await geometry(webviewPage);
  console.log(
    `[nudge-park] sampledGaps=${JSON.stringify(gaps.map((g) => Math.round(g)))} endGap=${end.gap.toFixed(0)}`,
  );
  // Never re-classified as "at the bottom" while streaming (a single such
  // sample is the pull-back), and the viewport only drifts DOWN in gap terms
  // because the stream keeps growing the content under it.
  expect(Math.min(...gaps)).toBeGreaterThan(10);
  expect(end.gap).toBeGreaterThan(300);
});

/**
 * The host's "scroll to bottom" command (confirmation shown, pane/session
 * bound, after rewind, settings saved) is a REQUEST, not an order: a user who
 * scrolled up to read history must not be yanked down because one of those
 * events happened somewhere else. The imperative handle used to call
 * scrollToEnd unconditionally — which is how a permission dialog appearing
 * mid-stream snapped a parked viewport straight back to the bottom.
 */
test("host scrollToBottom request does not override the reading position", async ({
  webviewPage,
}) => {
  const injector = new MessageInjector(webviewPage);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
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

  const box = await webviewPage.locator("#messagesContainer").boundingBox();
  if (!box) throw new Error("no container box");
  await webviewPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) {
    const g = await geometry(webviewPage);
    if (g.gap > 2000) break;
    await webviewPage.mouse.wheel(0, -240);
    await webviewPage.waitForTimeout(60);
  }
  const parked = await geometry(webviewPage);
  console.log(`[host-request] parked gap=${parked.gap.toFixed(0)}`);
  expect(parked.gap).toBeGreaterThan(1500);

  // The host asks for the bottom, twice, while the stream keeps producing.
  const gaps: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (i === 0 || i === 3) {
      await injector.simulateExtensionMessage("scrollToBottom", {});
    }
    await injector.simulateExtensionMessage("updateStreamingContent", {
      messageId: "live-msg",
      chunk: chunk(i + 1),
      stage: "streaming",
    });
    await webviewPage.waitForTimeout(140);
    gaps.push((await geometry(webviewPage)).gap);
  }
  console.log(
    `[host-request] gaps=${JSON.stringify(gaps.map((g) => Math.round(g)))}`,
  );
  expect(Math.min(...gaps)).toBeGreaterThan(1500);
});

/**
 * Setup for the two nested-region cases below: a long reasoning block sits in
 * the list (`.reasoning-content` carries a max-height + overflow-y, so it
 * scrolls on its own) with a live stream below it.
 */
async function setupNestedScroll(page: Page) {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  const history = buildHistory(140);
  history.push({
    id: "reason-1",
    role: "assistant",
    timestamp: new Date().toISOString(),
    blocks: [
      {
        type: "reasoning",
        content: `推理过程：${"先看调用方再决定改哪一层。".repeat(120)}`,
      },
    ],
  });
  history.push({
    id: "live-msg",
    role: "assistant",
    timestamp: new Date().toISOString(),
    blocks: [{ type: "text", content: "开头", stage: "streaming" }],
  });
  await injector.updateMessages(history);
  await injector.startStreaming();
  await page.waitForSelector('[data-message-id="live-msg"]');
  await page.waitForFunction(() => {
    const c = document.getElementById("messagesContainer") as HTMLElement;
    return c.scrollHeight - c.scrollTop - c.clientHeight <= 2;
  });
  await page.waitForTimeout(300);

  const reasoning = page.locator(".reasoning-content").first();
  await reasoning.waitFor();
  // The nested region really does overflow vertically — otherwise the wheel
  // would fall through to the list and these cases would prove nothing.
  const overflow = await reasoning.evaluate(
    (el) => el.scrollHeight - el.clientHeight,
  );
  expect(overflow).toBeGreaterThan(120);
  return { injector, reasoning, overflow };
}

/**
 * A viewport point that is genuinely over the VISIBLE part of the nested region.
 * The reasoning block is taller than the container and sits partly above the
 * clip, so the region's own centre is not necessarily inside it; probing with
 * elementFromPoint keeps the gesture honest. The point is sampled until it
 * repeats because the first layout read settles the virtualizer's row
 * measurements and shifts the rows under the cursor — a point taken mid-settle
 * lands on a neighbouring row by the time the wheel is dispatched.
 */
async function nestedRegionPoint(page: Page) {
  const probe = () =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".reasoning-content");
      const container = document.getElementById("messagesContainer");
      if (!el || !container) return null;
      const r = el.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      const top = Math.max(r.top, c.top);
      const bottom = Math.min(r.bottom, c.bottom);
      const x = r.left + r.width / 2;
      const mid = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, mid);
      if (!hit || !el.contains(hit)) return null;
      return {
        x,
        y: mid,
        rect: `${r.top.toFixed(1)},${r.bottom.toFixed(1)},${container.scrollTop.toFixed(1)}`,
      };
    });
  let prev = await probe();
  let stable = 0;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const next = await probe();
    if (!next) throw new Error("no point over the nested region");
    stable =
      prev && next.x === prev.x && next.rect === prev.rect ? stable + 1 : 0;
    prev = next;
    if (stable >= 3) return next;
  }
  throw new Error("the nested region never settled under the cursor");
}

/**
 * A wheel aimed at a region that scrolls on its own INSIDE the list (tool
 * output, reasoning, diff, write preview, capped user content) belongs to that
 * region — it is not a request to leave the bottom. Before this, every upward
 * wheel latched the opt-out regardless of where it was aimed.
 *
 * Only the half where the nested region consumes the gesture can be driven from
 * the browser side: when the region is already at its own top the wheel is
 * delivered to the list (measured — the event's target is not inside the nested
 * region), so that half lives in the unit suite
 * (autoScrollFollow.test.tsx, "…but scrolls the list").
 */
test("a wheel a nested region consumes does not suspend following", async ({
  webviewPage,
}) => {
  const { injector, reasoning, overflow } =
    await setupNestedScroll(webviewPage);
  // Park the inner region away from its own top edge so that it can consume the
  // whole gesture.
  await reasoning.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const point = await nestedRegionPoint(webviewPage);
  await webviewPage.mouse.move(point.x, point.y);
  for (let i = 0; i < 3; i++) {
    await webviewPage.mouse.wheel(0, -80);
    await webviewPage.waitForTimeout(50);
  }
  const innerTop = await reasoning.evaluate((el) => el.scrollTop);

  const gaps: number[] = [];
  for (let i = 1; i <= 6; i++) {
    await injector.simulateExtensionMessage("updateStreamingContent", {
      messageId: "live-msg",
      chunk: chunk(i),
      stage: "streaming",
    });
    await webviewPage.waitForTimeout(60);
    gaps.push((await geometry(webviewPage)).gap);
  }
  console.log(
    `[nested-inner] overflow=${overflow} innerTop=${innerTop} gaps=${JSON.stringify(gaps.map((g) => Math.round(g)))}`,
  );
  // The inner region scrolled under the wheel and never hit its own top …
  expect(innerTop).toBeGreaterThan(0);
  expect(innerTop).toBeLessThan(overflow);
  // … so the list never moved and never latched an opt-out: it kept following.
  expect(Math.max(...gaps)).toBeLessThanOrEqual(30);
});
