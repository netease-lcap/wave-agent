import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * Regression e2e (real browser, desktop mode) — 删除会话的用户可见行为。
 *
 * 出处：
 *  - PR #2150：删除会话后不得被 Ctrl+Tab 复活。Anti-revival 的权威修复在
 *    desktopHost（handleDeleteSession 里清空 sessionCycleSnapshot + 取消 in-flight
 *    restore + refreshSessionTree），webview 侧只观察「确认 → 发 desktopDeleteSession
 *    → 树刷新移除该行 + 面板记忆被 prune」。Ctrl+Tab 是主进程菜单 accelerator，
 *    窗口级 webview harness 无法触达，其「不得复活」断言在 packages/desktop
 *    desktopHost.test.ts 覆盖（另见 Part B 真 host 集成层）。
 *  - 面板记忆清理：删除后 DesktopApp.prunePanels 会丢掉该会话的 per-session 面板组
 *    （chatAppPanels.test.tsx「a deleted session forgets its panel group」的浏览器版）。
 */

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
  },
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

async function setupTree(webviewPage: Page, sessionIds: string[]) {
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
    panes: [
      { paneId: "pane-1", sessionId: sessionIds[0], host: "local", row: 0 },
    ],
    focusedPaneId: "pane-1",
  });
  await expect(webviewPage.getByTestId("desktop-sidebar")).toBeVisible();
  return injector;
}

async function openDeleteConfirm(webviewPage: Page, sessionId: string) {
  // The row's hover tooltip overlays the row (position:fixed) and would
  // intercept a normal click; the more button is always mounted (tabIndex -1),
  // so force-click it.
  await webviewPage
    .getByTestId(`desktop-session-more-${sessionId}`)
    .click({ force: true });
  await expect(webviewPage.getByTestId("desktop-session-menu")).toBeVisible();
  await webviewPage.getByTestId("desktop-session-menu-delete").click();
  await expect(webviewPage.getByTestId("confirm-dialog-overlay")).toBeVisible();
}

async function deleteMessages(webviewPage: Page) {
  return webviewPage.evaluate(() =>
    (
      (
        window as unknown as { getTestMessages?: () => unknown[] }
      ).getTestMessages?.() ?? []
    ).filter(
      (m) => (m as { command?: string }).command === "desktopDeleteSession",
    ),
  );
}

test.describe("桌面删除会话", () => {
  test("确认删除发出 desktopDeleteSession，树刷新后该行消失、其它会话保留", async ({
    webviewPage,
  }) => {
    const injector = await setupTree(webviewPage, [
      "sess-a1",
      "sess-a2",
      "sess-b1",
    ]);
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a2"),
    ).toBeVisible();

    await openDeleteConfirm(webviewPage, "sess-a2");
    await webviewPage.getByTestId("confirm-dialog-confirm").click();

    await expect
      .poll(() => deleteMessages(webviewPage))
      .toContainEqual({
        command: "desktopDeleteSession",
        sessionId: "sess-a2",
      });

    // host 刷新会话树（不再含 sess-a2）→ 行消失，其它会话仍在
    await injector.simulateExtensionMessage("desktopSessionTree", {
      groups: treeGroup(["sess-a1", "sess-b1"]),
    });
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a2"),
    ).toHaveCount(0);
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a1"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-b1"),
    ).toBeVisible();
  });

  test("取消确认不发删除消息、会话保留", async ({ webviewPage }) => {
    await setupTree(webviewPage, ["sess-a1", "sess-a2"]);

    await openDeleteConfirm(webviewPage, "sess-a2");
    await webviewPage.getByTestId("confirm-dialog-cancel").click();
    await expect(webviewPage.getByTestId("confirm-dialog-overlay")).toHaveCount(
      0,
    );
    await webviewPage.waitForTimeout(100);
    expect(await deleteMessages(webviewPage)).toHaveLength(0);
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a2"),
    ).toBeVisible();
  });

  test("删除带面板记忆的会话后，其面板组不复活、也不渗给当前会话", async ({
    webviewPage,
  }) => {
    const injector = await setupTree(webviewPage, ["sess-a1", "sess-a2"]);
    const pane = webviewPage.getByTestId("desktop-pane-pane-1");
    const toggle = pane.getByTestId("panel-toggle-btn");

    // 切到 sess-a2 并给它开一个 diff 面板（写入 per-session 记忆）
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a2", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-1",
    });
    await toggle.click();
    await pane.getByTestId("panel-empty-item-diff").click();
    await expect(pane.locator(".desktop-panel-tab")).toHaveCount(1);

    // 切回 sess-a1（无面板记忆）
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-1",
    });
    await expect(pane.getByTestId("desktop-panel-slot")).toHaveCount(0);

    // 删除 sess-a2 + 树刷新（prunePanels 丢掉它的面板组）
    await openDeleteConfirm(webviewPage, "sess-a2");
    await webviewPage.getByTestId("confirm-dialog-confirm").click();
    await injector.simulateExtensionMessage("desktopSessionTree", {
      groups: treeGroup(["sess-a1"]),
    });
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a2"),
    ).toHaveCount(0);

    // 删后当前会话仍无面板（被删会话的 diff tab 没有渗过来）
    await expect(pane.getByTestId("desktop-panel-slot")).toHaveCount(0);
  });
});
