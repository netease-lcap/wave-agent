import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";

/**
 * Regression e2e (real browser, desktop mode) — 会话切换时的状态收敛。
 *
 * 出处：
 *  - PR #2140 / #2149（contextUsage 第三轮）：「切会话后上下文用量」必须清空再接
 *    新会话的 replay（同值会话刷新不清空、桌面 host 在 pane 绑定时 replay 缓存的
 *    用量）——usageSessionRef 同步清空修复了「上一会话的百分比泄漏到下一会话」。
 *  - PR #2109：右面板折叠/展开逐会话记忆（面板 tab + 折叠态 + 宽度整体入
 *    SessionUiStore 的 per-session group cache），切走再切回必须恢复原样。
 *  - longchat-switch.e2e.ts（#2142 家族）：切到长对话后必须落在底部，用户上一会话
 *    的滚动位置不得残留。
 */

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    model: "claude-sonnet-4-20250514",
  },
  permissionMode: "default",
};

function paneMessages(paneId: string, sessionId: string) {
  return [
    MockDataGenerator.createUserMessage("看看这个 bug", `u-${paneId}`),
    MockDataGenerator.createAssistantMessage(
      "我先读一下代码。",
      `a-${sessionId}`,
    ),
  ];
}

async function setupPane(
  webviewPage: Page,
  panes: Array<{ paneId: string; sessionId: string }>,
) {
  const injector = new MessageInjector(webviewPage);
  await webviewPage.setViewportSize({ width: 1280, height: 800 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.simulateExtensionMessage("desktopPanes", {
    panes: panes.map((p) => ({ ...p, host: "local", row: 0 })),
    focusedPaneId: panes[0].paneId,
  });
  // Panel groups are pruned against the session tree (DesktopApp.prunePanels):
  // every session we switch between must exist in the tree or its per-session
  // panel memory is dropped on the next desktopPanes push.
  await injector.simulateExtensionMessage("desktopSessionTree", {
    groups: [
      {
        workdir: DIR_A,
        sessions: panes.map((p) => ({
          sessionId: p.sessionId,
          title: p.sessionId,
          lastActiveAt: Date.now(),
          hasWorktree: false,
          running: false,
          waitingConfirmation: false,
        })),
      },
    ],
  });
  for (const p of panes) {
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      paneId: p.paneId,
      session: { id: p.sessionId },
    });
    await injector.simulateExtensionMessage("updateMessages", {
      paneId: p.paneId,
      messages: paneMessages(p.paneId, p.sessionId),
    });
  }
  return injector;
}

async function switchPaneSession(
  injector: MessageInjector,
  paneId: string,
  sessionId: string,
) {
  await injector.simulateExtensionMessage("desktopPanes", {
    panes: [{ paneId, sessionId, host: "local", row: 0 }],
    focusedPaneId: paneId,
  });
  await injector.simulateExtensionMessage("setInitialState", {
    ...initialState,
    paneId,
    session: { id: sessionId },
    messages: paneMessages(paneId, sessionId),
  });
}

function contextPct(webviewPage: Page, paneId: string) {
  return webviewPage
    .getByTestId(`desktop-pane-${paneId}`)
    .locator(".compress-context-pct");
}

function contextButton(webviewPage: Page, paneId: string) {
  return webviewPage
    .getByTestId(`desktop-pane-${paneId}`)
    .locator(".compress-context-button");
}

async function dragHandle(webviewPage: Page, dx: number) {
  const handle = webviewPage.getByTestId("panel-slot-drag-handle");
  const h = await handle.boundingBox();
  if (!h) throw new Error("panel-slot-drag-handle not visible");
  const y = h.y + h.height / 2;
  const x0 = h.x + h.width / 2;
  await webviewPage.mouse.move(x0, y);
  await webviewPage.mouse.down();
  await webviewPage.mouse.move(x0 + dx, y, { steps: 16 });
  await webviewPage.mouse.up();
}

async function slotWidth(webviewPage: Page): Promise<number> {
  const box = await webviewPage.getByTestId("desktop-panel-slot").boundingBox();
  if (!box) throw new Error("desktop-panel-slot not visible");
  return Math.round(box.width);
}

test.describe("桌面会话切换状态收敛", () => {
  test("上下文用量：切会话先清空再接新会话 replay，同会话重推保持不变", async ({
    webviewPage,
  }) => {
    const injector = await setupPane(webviewPage, [
      { paneId: "pane-1", sessionId: "sess-a1" },
    ]);

    await injector.simulateExtensionMessage("contextUsage", {
      paneId: "pane-1",
      percent: 45,
    });
    await expect(contextPct(webviewPage, "pane-1")).toHaveText("45%");

    // 切到会话 B：host 先推 setInitialState（同步清空用量）再 replay 缓存用量
    await switchPaneSession(injector, "pane-1", "sess-b1");
    await expect(contextPct(webviewPage, "pane-1")).toHaveCount(0);
    await expect(contextButton(webviewPage, "pane-1")).toHaveAttribute(
      "title",
      "",
    );

    await injector.simulateExtensionMessage("contextUsage", {
      paneId: "pane-1",
      percent: 12,
    });
    await expect(contextPct(webviewPage, "pane-1")).toHaveText("12%");

    // 同一会话重推 setInitialState（host 刷新）不得把用量清掉
    await switchPaneSession(injector, "pane-1", "sess-b1");
    await expect(contextPct(webviewPage, "pane-1")).toHaveText("12%");
  });

  test("上下文用量：双 pane 各自独立，不互相泄漏", async ({ webviewPage }) => {
    const injector = await setupPane(webviewPage, [
      { paneId: "pane-1", sessionId: "sess-a1" },
      { paneId: "pane-2", sessionId: "sess-b1" },
    ]);

    await injector.simulateExtensionMessage("contextUsage", {
      paneId: "pane-1",
      percent: 30,
    });
    await injector.simulateExtensionMessage("contextUsage", {
      paneId: "pane-2",
      percent: 88,
    });

    await expect(contextPct(webviewPage, "pane-1")).toHaveText("30%");
    await expect(contextPct(webviewPage, "pane-2")).toHaveText("88%");

    // 切换焦点 pane 不改变任一 pane 的用量
    await webviewPage.getByTestId("desktop-pane-pane-2").click();
    await expect(contextPct(webviewPage, "pane-1")).toHaveText("30%");
    await expect(contextPct(webviewPage, "pane-2")).toHaveText("88%");
  });

  test("右面板 tab + 折叠态逐会话记忆：切走再切回恢复", async ({
    webviewPage,
  }) => {
    const injector = await setupPane(webviewPage, [
      { paneId: "pane-1", sessionId: "sess-a1" },
    ]);
    const pane = webviewPage.getByTestId("desktop-pane-pane-1");
    const toggle = pane.getByTestId("panel-toggle-btn");

    // 会话 A 打开 diff 面板再收起
    await toggle.click();
    await pane.getByTestId("panel-empty-item-diff").click();
    await expect(pane.locator(".desktop-panel-tab")).toHaveCount(1);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(pane.getByTestId("desktop-panel-slot")).toHaveCSS(
      "display",
      "none",
    );

    // 切到会话 B：空会话不继承 A 的面板（槽位不渲染）
    await switchPaneSession(injector, "pane-1", "sess-b1");
    await expect(pane.getByTestId("desktop-panel-slot")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // 切回会话 A：diff tab 与折叠态一并恢复
    await switchPaneSession(injector, "pane-1", "sess-a1");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(pane.getByTestId("desktop-panel-slot")).toHaveCSS(
      "display",
      "none",
    );
    await expect(pane.locator(".desktop-panel-tab")).toHaveCount(1);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(pane.locator(".desktop-panel-tab")).toBeVisible();
  });

  test("右面板宽度逐会话记忆：拖动后切走再切回恢复手动宽度", async ({
    webviewPage,
  }) => {
    const injector = await setupPane(webviewPage, [
      { paneId: "pane-1", sessionId: "sess-a1" },
    ]);
    const pane = webviewPage.getByTestId("desktop-pane-pane-1");

    await pane.getByTestId("panel-toggle-btn").click();
    await pane.getByTestId("panel-empty-item-diff").click();
    await expect(pane.locator(".desktop-panel-tab")).toHaveCount(1);

    const initialWidth = await slotWidth(webviewPage);
    // 向右拖 = 变窄（宽度上限受「对话列不小于 360」钳制，变窄方向空间更大）
    await dragHandle(webviewPage, 160);
    const narrowed = await slotWidth(webviewPage);
    expect(narrowed).toBeLessThan(initialWidth - 100);

    // 切到会话 B → 该会话用自己的默认宽度，不继承 A 的手动宽度
    await switchPaneSession(injector, "pane-1", "sess-b1");
    await pane.getByTestId("panel-toggle-btn").click();
    await pane.getByTestId("panel-empty-item-preview").click();
    const sessionBWidth = await slotWidth(webviewPage);
    expect(Math.abs(sessionBWidth - narrowed)).toBeGreaterThan(50);

    // 切回会话 A → 恢复手动宽度
    await switchPaneSession(injector, "pane-1", "sess-a1");
    expect(await slotWidth(webviewPage)).toBe(narrowed);
  });

  test("长对话切换：短→长→短 每次切换都落在底部", async ({ webviewPage }) => {
    const injector = await setupPane(webviewPage, [
      { paneId: "pane-1", sessionId: "sess-a1" },
    ]);

    const longMessages = [];
    for (let i = 0; i < 60; i++) {
      longMessages.push(
        MockDataGenerator.createUserMessage(`user ${i}`, `u-${i}`),
        MockDataGenerator.createAssistantMessage(`reply ${i}`, `a-${i}`),
      );
    }
    const shortMessages = longMessages.slice(0, 8);

    const bottomGap = () =>
      webviewPage.evaluate(() => {
        const c = document.getElementById("messagesContainer");
        if (!c) return 9999;
        return c.scrollHeight - c.scrollTop - c.clientHeight;
      });

    // 长会话 → 落底
    await injector.simulateExtensionMessage("updateMessages", {
      paneId: "pane-1",
      messages: longMessages,
    });
    await webviewPage.waitForTimeout(500);
    expect(await bottomGap()).toBeLessThan(2);

    // 用户上滚后切到短会话 → 必须落底，不继承上会话滚动位置
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer");
      if (c) {
        c.scrollTop = 0;
        c.dispatchEvent(new Event("scroll"));
      }
    });
    await switchPaneSession(injector, "pane-1", "sess-a2");
    await injector.simulateExtensionMessage("updateMessages", {
      paneId: "pane-1",
      messages: shortMessages,
    });
    await webviewPage.waitForTimeout(500);
    expect(await bottomGap()).toBeLessThan(2);

    // 再切回长会话 → 仍落底
    await switchPaneSession(injector, "pane-1", "sess-a1");
    await injector.simulateExtensionMessage("updateMessages", {
      paneId: "pane-1",
      messages: longMessages,
    });
    await webviewPage.waitForTimeout(700);
    expect(await bottomGap()).toBeLessThan(2);
  });
});
