import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * 吸顶用户消息条只在**已加载的窗口**里找锚点（`computeSticky`），而宿主首屏只推最近
 * 一页（`MESSAGE_FIRST_PAGE_SIZE = 20`，spec ui/message-rendering-system.md「首屏只进
 * 一页」）。一轮任务产生的消息数可以超过一页，于是窗口从**一轮对话的中间**开始：用户
 * 自己那条不在窗口里，吸顶条没有锚点、整条不渲染，读者得自己上翻一页才回来（spec
 * 场景 5）。这里用真实的几何验证那条自动续页真的把页面取回来，并且它不把停在底部的
 * 读者拽走。
 */

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

const user = (id: string, text: string): Message => ({
  id,
  role: "user",
  timestamp: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  blocks: [{ type: "text", content: text }],
});

const assistant = (id: string, text: string): Message => ({
  id,
  role: "assistant",
  timestamp: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  blocks: [{ type: "text", content: text }],
});

// 每条都够高，让 20 条一页稳稳撑满一屏（否则「一页没撑满」那条 fill 规则也会请求）。
const body = "这是一段比较长的回答。\n".repeat(10);
const olderPage: Message[] = [
  user("u-anchor", "我写给 AI 的最新一条消息"),
  assistant("a-anchor", `回答的开头\n\n${body}`),
];
const tailWindow: Message[] = Array.from({ length: 20 }, (_, i) =>
  assistant(`a-${i}`, `工具阶段 ${i}\n\n${body}`),
);

async function setupPane(webviewPage: Page) {
  const injector = new MessageInjector(webviewPage);
  await webviewPage.setViewportSize({ width: 1280, height: 800 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.simulateExtensionMessage("desktopPanes", {
    panes: [{ paneId: "pane-1", host: "local", row: 0 }],
    focusedPaneId: "pane-1",
  });
  await injector.simulateExtensionMessage("desktopSessionTree", {
    groups: [
      {
        workdir: DIR_A,
        sessions: [
          {
            sessionId: "sess-1",
            title: "sess-1",
            lastActiveAt: Date.now(),
            hasWorktree: false,
            running: false,
            waitingConfirmation: false,
          },
        ],
      },
    ],
  });
  return injector;
}

async function bindSession(injector: MessageInjector, messages: Message[]) {
  await injector.simulateExtensionMessage("setInitialState", {
    ...initialState,
    paneId: "pane-1",
    session: { id: "sess-1" },
    messages,
    historyExhausted: false,
    supportsMessagePaging: true,
  });
}

async function loadOlderRequests(webviewPage: Page) {
  return await webviewPage.evaluate(() =>
    window
      .getTestMessages()
      .filter((message) => message.command === "loadOlderMessages"),
  );
}

const stickyBar = (webviewPage: Page) =>
  webviewPage.evaluate(() => {
    const card = document.querySelector(
      "[data-testid='sticky-user-message']",
    ) as HTMLElement | null;
    const container = document.getElementById(
      "messagesContainer",
    ) as HTMLElement;
    const containerTop = container.getBoundingClientRect().top;
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return {
      text: (card.querySelector(".sticky-user-content") as HTMLElement)
        .textContent,
      // 距滚动容器顶多少像素：吸顶条贴在容器顶（CSS top: 10px）而不是留在
      // 视口外或者被内容挤走。
      offsetFromContainerTop: Math.round(rect.top - containerTop),
      height: Math.round(rect.height),
      gapFromBottom: Math.round(
        container.scrollHeight - container.scrollTop - container.clientHeight,
      ),
    };
  });

test("pulls the page that holds the user's own message when the first one starts mid-turn", async ({
  webviewPage,
}) => {
  const injector = await setupPane(webviewPage);
  await bindSession(injector, tailWindow);

  // 没有任何上翻手势：这一页自己发现「窗口里一条用户消息都没有」，于是按窗口头
  // 那条消息往前取一页（宿主不会重发它）。
  await expect
    .poll(async () => (await loadOlderRequests(webviewPage)).length, {
      timeout: 10000,
    })
    .toBe(1);
  const [request] = await loadOlderRequests(webviewPage);
  expect(request).toMatchObject({ before: "a-0" });

  // 取回的那一页带来用户自己那条消息，吸顶条的锚点就有了。
  await injector.simulateExtensionMessage("olderMessages", {
    paneId: "pane-1",
    requestId: request.requestId,
    messages: olderPage,
    hasMore: true,
  });

  await expect(
    webviewPage.locator("[data-testid='sticky-user-message']"),
  ).toHaveCount(1);

  const bar = await stickyBar(webviewPage);
  expect(bar?.text).toBe("我写给 AI 的最新一条消息");
  expect(bar?.height).toBeGreaterThan(0);
  // 贴在容器顶上（CSS 是 top: 10px），不是浮在视口外。
  expect(bar?.offsetFromContainerTop).toBeLessThan(60);
  // 读者的位置没被前插拽走：他一直停在底部（前插前在底部，前插后还在）。
  expect(bar?.gapFromBottom).toBeLessThan(40);
});

test("leaves a first page that already holds the user's message alone", async ({
  webviewPage,
}) => {
  const injector = await setupPane(webviewPage);
  // 一轮长回答：用户那条就在这一页的开头，没有理由再往前取页。
  await bindSession(injector, [
    user("u-1", "只问了一句"),
    ...Array.from({ length: 8 }, (_, i) =>
      assistant(`a-${i}`, `回答 ${i}\n\n${body}`),
    ),
  ]);
  await webviewPage.waitForTimeout(1500);

  expect(await loadOlderRequests(webviewPage)).toHaveLength(0);

  // 上翻之后吸顶条照常出现，而且只有一条（不是另挂一份）。别一路滚到顶：
  // 用户消息的顶边必须严格越过视口顶才会吸顶（停在 0 就没有候选）。
  await webviewPage.mouse.move(640, 400);
  for (let i = 0; i < 2; i++) await webviewPage.mouse.wheel(0, -400);
  await expect(
    webviewPage.locator("[data-testid='sticky-user-message']"),
  ).toHaveCount(1);
  const bar = await stickyBar(webviewPage);
  expect(bar?.text).toBe("只问了一句");
  // 这一页就是全部历史：上翻不会触发取页。
  expect(await loadOlderRequests(webviewPage)).toHaveLength(0);
});
