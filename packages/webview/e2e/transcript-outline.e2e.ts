import { test, expect } from "./utils/webviewTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";

/**
 * 会话消息大纲（spec ui/transcript-outline.md）在真实 Chromium 里的几何。
 *
 * jsdom 只能断言「有没有、点了会不会滚」（见 tests/webview/transcriptOutline.test.tsx），
 * 这里钉三件只能靠排版回答的事：刻度住在列左内边距里、不压正文；预览卡不
 * 溢出内容区；列窄到阈值以下整体消失。
 *
 * 默认 viewport 是 400px（模拟 VS Code 侧栏），那里大纲本来就不该出现，所以
 * 宽场景要自己声明。
 */

test.use({ viewport: { width: 1000, height: 800 } });

const PAIRS = 8;

function buildMessages(pairs: number): Message[] {
  const messages: Message[] = [];
  const ts = (i: number) =>
    new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
  for (let i = 0; i < pairs; i++) {
    messages.push({
      id: `u${i}`,
      role: "user",
      timestamp: ts(i * 2),
      blocks: [{ type: "text", content: `第 ${i} 个问题` }],
    });
    messages.push({
      id: `a${i}`,
      role: "assistant",
      timestamp: ts(i * 2 + 1),
      blocks: [{ type: "text", content: `第 ${i} 个回答` }],
    });
  }
  return messages;
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
    permissionMode: "default",
  });
  await injector.updateMessages(messages);
  await injector.endStreaming();
}

test.describe("transcript outline", () => {
  test("sits in the page gutter, clear of the message column", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector, buildMessages(PAIRS));

    const ticks = webviewPage.locator('[data-testid="outline-tick"]');
    await expect(ticks).toHaveCount(PAIRS);

    await webviewPage.waitForSelector('[data-measured-message-id="u0"]');
    const railBox = (await webviewPage
      .locator(".outline-ticks")
      .boundingBox())!;
    const surfaceBox = (await webviewPage
      .locator("#messagesContainer")
      .boundingBox())!;
    const bubbleBox = (await webviewPage
      .locator('[data-measured-message-id="u0"] .user-text-block')
      .first()
      .boundingBox())!;

    // 刻度贴着窗口左边缘一侧（约 20px），不是浮在正文上方：与内容列之间留着
    // 800px 列居中后的那片页边白。
    expect(railBox.x - surfaceBox.x).toBeGreaterThanOrEqual(8);
    expect(railBox.x - surfaceBox.x).toBeLessThanOrEqual(32);
    // 而且要与气泡之间有明显间距，不是贴着正文画（spec 场景 1）。
    expect(bubbleBox.x - (railBox.x + railBox.width)).toBeGreaterThanOrEqual(
      24,
    );
  });

  test("shows a preview card that stays inside the scroll surface", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector, buildMessages(PAIRS));

    const ticks = webviewPage.locator('[data-testid="outline-tick"]');
    await expect(ticks).toHaveCount(PAIRS);
    await ticks.nth(2).hover();

    const card = webviewPage.locator('[data-testid="outline-card"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText("第 2 个问题");
    // 卡片只放问题，不重复一遍助手回答（spec 场景 5）。
    await expect(card).not.toContainText("第 2 个回答");

    const cardBox = (await card.boundingBox())!;
    const surfaceBox = (await webviewPage
      .locator("#messagesContainer")
      .boundingBox())!;
    expect(cardBox.x).toBeGreaterThanOrEqual(surfaceBox.x);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(
      surfaceBox.x + surfaceBox.width,
    );
  });

  test("jumps to the clicked round", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector, buildMessages(PAIRS));

    // 首屏钉底，最后一个问题已在视口里；点第一个刻度应该把视口带回顶部。
    await webviewPage.waitForSelector('[data-measured-message-id="u0"]');
    const ticks = webviewPage.locator('[data-testid="outline-tick"]');
    await expect(ticks).toHaveCount(PAIRS);
    await ticks.nth(0).click();

    await expect(
      webviewPage.locator('[data-measured-message-id="u0"]'),
    ).toBeVisible();
    const atTop = await webviewPage.evaluate(() => {
      const container = document.getElementById("messagesContainer")!;
      return container.scrollTop;
    });
    expect(atTop).toBeLessThan(40);
  });

  test("disappears until the window leaves the column some gutter", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector, buildMessages(PAIRS));
    const ticks = webviewPage.locator('[data-testid="outline-tick"]');
    await expect(ticks).toHaveCount(PAIRS);

    // 860 宽：内容列已撑满 800，但左侧只剩 30px 留白，放不下目录与正文的间距。
    await webviewPage.setViewportSize({ width: 860, height: 800 });
    await expect(ticks).toHaveCount(0);

    // 420 宽（IDE 侧栏）：列自己都没撑满，更不会有留白。
    await webviewPage.setViewportSize({ width: 420, height: 800 });
    await expect(ticks).toHaveCount(0);

    await webviewPage.setViewportSize({ width: 1000, height: 800 });
    await expect(ticks).toHaveCount(PAIRS);
  });
});

/**
 * 刻度覆盖整条会话（spec 场景 9 / 16 / 17 / 18）：索引来自宿主的一次转录查询，
 * 点在还没加载进窗口的刻度上时，页面按「以它为起点的一页」取回来再落位。
 *
 * jsdom 里断过一遍结构（tests/webview/transcriptOutline.test.tsx）；这里补的是只有
 * 真排版能回答的一件：整条会话的刻度装不下时，刻度条自己变成可滚区。
 */
test.describe("transcript outline — 整条会话", () => {
  /** webview 发出去的命令（真事件循环里排过序）。 */
  const sent = (webviewPage: Page) =>
    webviewPage.evaluate(
      () =>
        (
          window as unknown as {
            getTestMessages?: () => Record<string, unknown>[];
          }
        ).getTestMessages?.() ?? [],
    );

  const lastRequestId = async (
    webviewPage: Page,
    command: string,
  ): Promise<string> => {
    const messages = await sent(webviewPage);
    const request = [...messages].reverse().find((m) => m.command === command);
    return String(request?.requestId ?? "");
  };

  /** 整条会话的索引：`count` 条问句（比窗口里的那些更早）。 */
  const historyItems = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `h${i}`,
      text: `很早的问题 ${i}`,
    }));

  /** 以 `from` 为起点的一页：首条（含它自己）用锚点 id。 */
  const pageFrom = (from: string, pairs: number): Message[] =>
    buildMessages(pairs).map((message, index) => ({
      ...message,
      id: index === 0 ? from : `${from}-${index}`,
    }));

  test("只在已加载的一页里的会话，刻度仍按整条转录画，且刻度条自己滚", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector, buildMessages(2));

    await injector.simulateExtensionMessage("transcriptOutline", {
      requestId: await lastRequestId(webviewPage, "getTranscriptOutline"),
      items: historyItems(60),
    });

    const ticks = webviewPage.locator('[data-testid="outline-tick"]');
    // 60 条索引 + 窗口里那 2 条（它们比索引新，追加在末尾）。
    await expect(ticks).toHaveCount(62);
    // 装不下：刻度条自己成了可滚区，上下箭头出现（场景 13）。
    await expect(
      webviewPage.locator('[data-testid="outline-scroll-up"]'),
    ).toBeVisible();
    await expect(
      webviewPage.locator('[data-testid="outline-scroll-down"]'),
    ).toBeVisible();
    // 没加载的那几条，预览卡用的是索引里的文本（场景 16）。
    await ticks.nth(0).hover();
    await expect(
      webviewPage.locator('[data-testid="outline-card"]'),
    ).toContainText("很早的问题 0");
  });

  test("点没加载的刻度：先取页，回来整表替换并停到历史里", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await initWithMessages(injector, buildMessages(2));

    await injector.simulateExtensionMessage("transcriptOutline", {
      requestId: await lastRequestId(webviewPage, "getTranscriptOutline"),
      items: historyItems(10),
    });
    const ticks = webviewPage.locator('[data-testid="outline-tick"]');
    // 10 条还没加载的历史 + 窗口里的那 2 条。
    await expect(ticks).toHaveCount(12);

    await ticks.nth(0).click();

    // 请求带锚点 id；请求期间那一格是「进行中」。
    await expect
      .poll(async () => {
        const messages = await sent(webviewPage);
        return messages.filter((m) => m.command === "loadMessagePage");
      })
      .toHaveLength(1);
    const requestId = await lastRequestId(webviewPage, "loadMessagePage");
    await expect(ticks.nth(0)).toHaveClass(/outline-tick--pending/);

    // 回包：以 h0 为起点的一页，页尾之后还有内容（窗口停在历史里）。
    await injector.simulateExtensionMessage("messagePage", {
      requestId,
      from: "h0",
      messages: pageFrom("h0", 8),
      hasMore: true,
      hasLater: true,
    });

    // 整表替换 + 落位：这一页的第一条成了「当前这一轮」的刻度。
    await expect(ticks.nth(0)).toHaveAttribute("aria-current", "true");
    await expect(ticks.nth(0)).not.toHaveClass(/outline-tick--pending/);
    // 底部入口换成「回到最新一页」（场景 18）。
    await expect(
      webviewPage.locator('[data-testid="jump-to-bottom"]'),
    ).toHaveAttribute("data-historical", "true");
  });
});
