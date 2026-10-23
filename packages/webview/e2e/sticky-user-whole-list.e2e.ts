import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * 吸顶用户消息条的位置与稳定性（真实几何）。
 *
 * 页面绑定会话时拿到的就是这条会话的整份列表，列表一次落地、视口直接钉在底部。
 * 长会话里用户自己那条消息因此本来就在折线之上，吸顶条应该**不需要任何手势**就
 * 出现，并且贴在滚动容器顶部；读者此后上翻、回到底部，条上的仍是最新那条问题。
 *
 * 这两件事都只能靠真实布局验证：jsdom 里的行高与 `scrollHeight` 是手写进去的，
 * 「贴在哪里」「有没有把读者从底部拽走」在那边没有意义。
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

// 每条都够高，几十条就能稳稳撑满一屏（视口 800）。
const body = "这是一段比较长的回答。\n".repeat(10);

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
  });
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

test("shows the bar as soon as a long list is bound, with the viewport at the bottom", async ({
  webviewPage,
}) => {
  const injector = await setupPane(webviewPage);
  // 一份整表：用户那条在最上面，后面是它这一轮的长回答。一次落地之后没有任何手势。
  await bindSession(injector, [
    user("u-anchor", "我写给 AI 的最新一条消息"),
    ...Array.from({ length: 20 }, (_, i) =>
      assistant(`a-${String(i)}`, `回答 ${String(i)}\n\n${body}`),
    ),
  ]);

  await expect(
    webviewPage.locator("[data-testid='sticky-user-message']"),
  ).toHaveCount(1);

  const bar = await stickyBar(webviewPage);
  expect(bar?.text).toBe("我写给 AI 的最新一条消息");
  expect(bar?.height).toBeGreaterThan(0);
  // 贴在容器顶上（CSS 是 top: 10px），不是浮在视口外。
  expect(bar?.offsetFromContainerTop).toBeLessThan(60);
  // 钉底没有被吸顶条改变：视口就在底部。
  expect(bar?.gapFromBottom).toBeLessThan(40);
});

test("keeps a single bar whose anchor follows the reader while scrolling", async ({
  webviewPage,
}) => {
  const injector = await setupPane(webviewPage);
  await bindSession(injector, [
    user("u-1", "只问了一句"),
    ...Array.from({ length: 8 }, (_, i) =>
      assistant(`a-${i}`, `回答 ${i}\n\n${body}`),
    ),
  ]);

  // 上翻之后吸顶条照常出现，而且只有一条（不是另挂一份）。别一路滚到顶：
  // 用户消息的顶边必须严格越过视口顶才会吸顶（停在 0 就没有候选）。
  await webviewPage.mouse.move(640, 400);
  for (let i = 0; i < 2; i++) await webviewPage.mouse.wheel(0, -400);
  await expect(
    webviewPage.locator("[data-testid='sticky-user-message']"),
  ).toHaveCount(1);
  const bar = await stickyBar(webviewPage);
  expect(bar?.text).toBe("只问了一句");
  expect(bar?.offsetFromContainerTop).toBeLessThan(60);
});
