/**
 * 桌面端删除会话的用户可见行为（迁移自 `e2e/desktop-delete-session.e2e.ts`）。
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
 *
 * 本套件跑在真 Chromium 里，所以外观与焦点类断言（禁用主按钮的 opacity / cursor、
 * 焦点归属）量的是真值。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen, within } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  lastSent,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

function treeGroup(sessionIds: string[], hasWorktree = false) {
  return [
    {
      workdir: DIR_A,
      sessions: sessionIds.map((sessionId) => ({
        sessionId,
        title: `会话 ${sessionId}`,
        lastActiveAt: new Date("2026-07-27T10:00:00Z").getTime(),
        hasWorktree,
        running: false,
        waitingConfirmation: false,
      })),
    },
  ];
}

afterEach(() => {
  resetHostTier();
  resetPanelState();
  localStorage.clear();
});

/** 起一棵会话树，并把唯一分屏绑到第一个会话上。 */
function setupTree(sessionIds: string[], hasWorktree = false) {
  const result = renderDesktopApp();
  bootDesktop({ workdir: DIR_A });
  sendCommand("desktopSessionTree", {
    groups: treeGroup(sessionIds, hasWorktree),
  });
  sendCommand("desktopPanes", {
    panes: [
      { paneId: "pane-1", sessionId: sessionIds[0], host: "local", row: 0 },
    ],
    focusedPaneId: "pane-1",
  });
  expect(isVisible('[data-testid="desktop-sidebar"]')).toBe(true);
  return result;
}

/**
 * 行菜单 → 删除会话 → 确认框。行的 hover tooltip 是 `position: fixed`、覆盖在行上，
 * 会拦掉普通点击；更多按钮本身常驻挂载（tabIndex -1），所以照原用例 force 点击
 * （force 只跳过可操作性等待，指针事件与焦点照常派发）。
 */
async function openDeleteConfirm(sessionId: string) {
  await userEvent.click(
    screen.getByTestId(`desktop-session-more-${sessionId}`),
    { force: true },
  );
  await expect
    .poll(() => isVisible('[data-testid="desktop-session-menu"]'))
    .toBe(true);
  await userEvent.click(screen.getByTestId("desktop-session-menu-delete"));
  await expect
    .poll(() => isVisible('[data-testid="confirm-dialog-overlay"]'))
    .toBe(true);
}

/** webview 发给宿主的删除请求。 */
const deleteMessages = (vscode: { postMessage: unknown }) =>
  sentCommands(vscode).filter(
    (message) => message.command === "desktopDeleteSession",
  );

const itemCount = (sessionId: string) =>
  document.querySelectorAll(`[data-testid="desktop-session-item-${sessionId}"]`)
    .length;

/** 分屏里已打开的面板槽数量（按 paneId 定位，不受别的分屏影响）。 */
const panelSlotCount = (paneId: string) =>
  document.querySelectorAll(
    `[data-testid="desktop-pane-${paneId}"] [data-testid="desktop-panel-slot"]`,
  ).length;

const paneEl = (paneId: string) =>
  document.querySelector<HTMLElement>(
    `[data-testid="desktop-pane-${paneId}"]`,
  )!;

describe("桌面删除会话", () => {
  it("确认删除发出 desktopDeleteSession，树刷新后该行消失、其它会话保留", async () => {
    await page.viewport(1280, 800);
    const { vscode } = setupTree(["sess-a1", "sess-a2", "sess-b1"]);
    expect(isVisible('[data-testid="desktop-session-item-sess-a2"]')).toBe(
      true,
    );

    await openDeleteConfirm("sess-a2");
    await userEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await expect
      .poll(() => deleteMessages(vscode))
      .toContainEqual({
        command: "desktopDeleteSession",
        sessionId: "sess-a2",
      });

    // host 刷新会话树（不再含 sess-a2）→ 行消失，其它会话仍在
    sendCommand("desktopSessionTree", {
      groups: treeGroup(["sess-a1", "sess-b1"]),
    });
    await expect.poll(() => itemCount("sess-a2")).toBe(0);
    expect(isVisible('[data-testid="desktop-session-item-sess-a1"]')).toBe(
      true,
    );
    expect(isVisible('[data-testid="desktop-session-item-sess-b1"]')).toBe(
      true,
    );
  });

  it("取消确认不发删除消息、会话保留", async () => {
    await page.viewport(1280, 800);
    const { vscode } = setupTree(["sess-a1", "sess-a2"]);

    await openDeleteConfirm("sess-a2");
    await userEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    await expect
      .poll(
        () =>
          document.querySelectorAll('[data-testid="confirm-dialog-overlay"]')
            .length,
      )
      .toBe(0);
    // 负向断言得有一段观察窗口：删除是确认回调里同步发的，这里留出与真机用例
    // 同样的 100ms，任何「迟到的删除」都会落进下面的发送日志里。
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(deleteMessages(vscode)).toHaveLength(0);
    expect(isVisible('[data-testid="desktop-session-item-sess-a2"]')).toBe(
      true,
    );
  });

  it("删除带面板记忆的会话后，其面板组不复活、也不渗给当前会话", async () => {
    await page.viewport(1280, 800);
    setupTree(["sess-a1", "sess-a2"]);

    // 切到 sess-a2 并给它开一个 diff 面板（写入 per-session 记忆）
    sendCommand("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a2", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-1",
    });
    await userEvent.click(
      within(paneEl("pane-1")).getByTestId("panel-toggle-btn"),
    );
    await userEvent.click(
      within(paneEl("pane-1")).getByTestId("panel-empty-item-diff"),
    );
    await expect
      .poll(
        () => paneEl("pane-1").querySelectorAll(".desktop-panel-tab").length,
      )
      .toBe(1);

    // 切回 sess-a1（无面板记忆）
    sendCommand("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-1",
    });
    await expect.poll(() => panelSlotCount("pane-1")).toBe(0);

    // 删除 sess-a2 + 树刷新（prunePanels 丢掉它的面板组）
    await openDeleteConfirm("sess-a2");
    await userEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    sendCommand("desktopSessionTree", { groups: treeGroup(["sess-a1"]) });
    await expect.poll(() => itemCount("sess-a2")).toBe(0);

    // 删后当前会话仍无面板（被删会话的 diff tab 没有渗过来）
    await expect.poll(() => panelSlotCount("pane-1")).toBe(0);
  });

  it("worktree 会话：改动检查返回后焦点落到确认按钮，Enter 即确认删除", async () => {
    // 真宿主的改动检查是异步的（git status 要走宿主，远端还要走 SSH），确认框
    // 先以「正在检查该 worktree 的改动…」的禁用态出现。这里扣住应答，分别观察
    // 检查中与检查完成两个状态的焦点归属。
    await page.viewport(1280, 800);
    const { vscode } = setupTree(["sess-a1", "sess-a2"], true);

    await openDeleteConfirm("sess-a2");
    const confirm = screen.getByTestId(
      "confirm-dialog-confirm",
    ) as HTMLButtonElement;
    await expect.poll(() => confirm.disabled).toBe(true);
    // 禁用必须看得见：检查期间主按钮不得再画成可点击的实心蓝，否则用户只
    // 能看到一个「点了没反应」的按钮（用户反馈）。jsdom 不计算 CSS，只能在
    // 真实浏览器里断言。
    const disabledStyle = getComputedStyle(confirm);
    expect(Number(disabledStyle.opacity)).toBeLessThan(1);
    expect(disabledStyle.cursor).toBe("not-allowed");
    // 检查期间主按钮不可用、接不住焦点——此时焦点仍在打开菜单的触发钮上，
    // 所以检查完成后绝不能把焦点留在那儿（Enter 会重开那一行的菜单）。
    expect(document.activeElement).toBe(
      screen.getByTestId("desktop-session-more-sess-a2"),
    );

    // 宿主回答改动检查（原用例的 `__flushWorktreeChanges` 走的就是这条回包）。
    const request = lastSent(vscode, "desktopGetWorktreeChanges")!;
    expect(request.sessionId).toBe("sess-a2");
    sendCommand("desktopWorktreeChanges", {
      sessionId: "sess-a2",
      requestId: request.requestId,
      changes: { files: 2, commits: 1 },
    });

    await expect.poll(() => confirm.disabled).toBe(false);
    await expect.poll(() => document.activeElement === confirm).toBe(true);
    // 检查返回后必须恢复成正常可点的外观（禁用样式不得常驻）。
    await expect.poll(() => getComputedStyle(confirm).opacity).toBe("1");

    // 焦点在弹窗内 ⇒ Enter 是「确认删除」，不是重开行菜单
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => deleteMessages(vscode))
      .toContainEqual({
        command: "desktopDeleteSession",
        sessionId: "sess-a2",
      });
  });
});
