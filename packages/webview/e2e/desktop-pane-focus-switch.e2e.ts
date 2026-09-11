import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";

/**
 * Regression e2e (real browser, desktop mode) — pane/会话焦点切换的联动。
 *
 * 语义出处（FR-031/FR-032 + spec desktop-sessions.md 场景 4）：
 *  - 侧边栏「当前会话」行由聚焦 pane 的绑定会话决定（DesktopShell 读
 *    panes.find(focusedPaneId)?.sessionId），切会话后 current 高亮必须跟着走。
 *  - 点击非聚焦 pane → 发 desktopFocusPane；host 再推 desktopPanes 更新聚焦
 *    pane。焦点切换不得影响另一 pane 的会话内容（并行会话模型）。
 */

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

function treeGroup(sessionIds: string[]) {
  return [
    {
      workdir: DIR_A,
      sessions: sessionIds.map((sessionId) => ({
        sessionId,
        title: `会话 ${sessionId}`,
        lastActiveAt: new Date("2026-07-27T10:00:00Z").getTime(),
        hasWorktree: false,
        running: false,
        waitingConfirmation: false,
      })),
    },
  ];
}

async function setup(
  webviewPage: Page,
  sessionIds: string[],
  paneIds: string[],
) {
  const injector = new MessageInjector(webviewPage);
  await webviewPage.setViewportSize({ width: 1280, height: 800 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.simulateExtensionMessage("desktopSessionTree", {
    groups: treeGroup(sessionIds),
  });
  await injector.simulateExtensionMessage("desktopPanes", {
    panes: paneIds.map((paneId, i) => ({
      paneId,
      sessionId: sessionIds[i],
      host: "local",
      row: 0,
    })),
    focusedPaneId: paneIds[0],
  });
  for (const [i, paneId] of paneIds.entries()) {
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      paneId,
      session: { id: sessionIds[i] },
    });
    await injector.simulateExtensionMessage("updateMessages", {
      paneId,
      messages: [
        MockDataGenerator.createUserMessage(`来自 ${paneId}`, `u-${paneId}`),
      ],
    });
  }
  await expect(webviewPage.getByTestId("desktop-sidebar")).toBeVisible();
  return injector;
}

function sentCommands(webviewPage: Page): Promise<string[]> {
  return webviewPage.evaluate(() =>
    (
      (
        window as unknown as { getTestMessages?: () => unknown[] }
      ).getTestMessages?.() ?? []
    ).map((m) => (m as { command?: string }).command ?? ""),
  );
}

test.describe("桌面 pane/会话焦点切换联动", () => {
  test("点击非聚焦 pane 发出 desktopFocusPane，另一 pane 内容不受影响", async ({
    webviewPage,
  }) => {
    const injector = await setup(
      webviewPage,
      ["sess-a1", "sess-b1"],
      ["pane-1", "pane-2"],
    );
    await injector.clearMessageLog();

    await webviewPage.getByTestId("desktop-pane-pane-2").click();
    await expect
      .poll(async () => {
        const messages = await webviewPage.evaluate(() =>
          (
            (
              window as unknown as { getTestMessages?: () => unknown[] }
            ).getTestMessages?.() ?? []
          ).find(
            (m) => (m as { command?: string }).command === "desktopFocusPane",
          ),
        );
        return messages;
      })
      .toMatchObject({ command: "desktopFocusPane", paneId: "pane-2" });

    // 两个 pane 的会话内容都还在（焦点切换不重挂载/清空兄弟 pane）
    await expect(webviewPage.getByTestId("desktop-pane-pane-1")).toContainText(
      "来自 pane-1",
    );
    await expect(webviewPage.getByTestId("desktop-pane-pane-2")).toContainText(
      "来自 pane-2",
    );
    expect(await sentCommands(webviewPage)).not.toContain(
      "desktopSelectSession",
    );
  });

  test("切换 pane 绑定会话后，侧边栏当前行跟随聚焦 pane", async ({
    webviewPage,
  }) => {
    const injector = await setup(
      webviewPage,
      ["sess-a1", "sess-a2"],
      ["pane-1"],
    );

    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a1"),
    ).toHaveClass(/desktop-session-item--current/);

    // 聚焦 pane 换绑会话 → current 高亮迁移
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a2", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-1",
    });
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a2"),
    ).toHaveClass(/desktop-session-item--current/);
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a1"),
    ).not.toHaveClass(/desktop-session-item--current/);
  });

  test("聚焦 pane 变化时 current 行看聚焦 pane 而非其它 pane", async ({
    webviewPage,
  }) => {
    await setup(webviewPage, ["sess-a1", "sess-b1"], ["pane-1", "pane-2"]);

    // 聚焦 pane-1（sess-a1）
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a1"),
    ).toHaveClass(/desktop-session-item--current/);
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-b1"),
    ).not.toHaveClass(/desktop-session-item--current/);

    // host 确认焦点切到 pane-2 → current 行必须跟着聚焦 pane 走
    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1", host: "local", row: 0 },
        { paneId: "pane-2", sessionId: "sess-b1", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-2",
    });
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-b1"),
    ).toHaveClass(/desktop-session-item--current/);
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a1"),
    ).not.toHaveClass(/desktop-session-item--current/);
  });
});
