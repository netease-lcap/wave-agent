/**
 * 桌面端 pane/会话焦点切换的联动（FR-031/FR-032 + spec `desktop-sessions.md` 场景 4）。
 *
 * 迁移自 `e2e/desktop-pane-focus-switch.e2e.ts`。原文写明的语义：
 *  - 侧边栏「当前会话」行由聚焦 pane 的绑定会话决定（DesktopShell 读
 *    `panes.find(focusedPaneId)?.sessionId`），切会话后 current 高亮必须跟着走；
 *  - 点击非聚焦 pane → 发 `desktopFocusPane`；宿主再推 `desktopPanes` 更新聚焦
 *    pane。焦点切换不得影响另一 pane 的会话内容（并行会话模型）。
 *
 * 多分屏的消息推法照 `desktopApp.test.tsx` / `desktopSplitView.test.tsx`：
 * `desktopPanes` 定布局后，每个 pane 自己的 `setInitialState` / `updateMessages`
 * 都带 `paneId`（pane 实例只收自己那一份）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { MockDataGenerator } from "../fixtures/mockData";
import { sendCommand } from "./test-utils";
import {
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 侧边栏会话树（原文的 `treeGroup`，只有一个工作目录分组）。 */
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

const q = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const classOf = (testId: string) => q(`[data-testid="${testId}"]`).className;

const hasClass = (testId: string, className: string) =>
  classOf(testId).includes(className);

/**
 * 起一个多 pane 桌面端：工作目录 → 初值 → 会话树 → pane 布局 → 每个 pane 自己的
 * 初值与消息。返回 mock 宿主，供断言它收到了什么。
 */
async function setup(sessionIds: string[], paneIds: string[]) {
  const { vscode } = renderDesktopApp();
  sendCommand("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  sendCommand("setInitialState", initialState);
  sendCommand("desktopSessionTree", { groups: treeGroup(sessionIds) });
  sendCommand("desktopPanes", {
    panes: paneIds.map((paneId, i) => ({
      paneId,
      sessionId: sessionIds[i],
      host: "local",
      row: 0,
    })),
    focusedPaneId: paneIds[0],
  });
  for (const [i, paneId] of paneIds.entries()) {
    sendCommand("setInitialState", {
      ...initialState,
      paneId,
      session: { id: sessionIds[i] },
    });
    sendCommand("updateMessages", {
      paneId,
      messages: [
        MockDataGenerator.createUserMessage(`来自 ${paneId}`, `u-${paneId}`),
      ],
    });
  }
  // 原文 `setup` 末尾的 `expect(desktop-sidebar).toBeVisible()`：外壳没起来时
  // 后面的断言都是空转，先确认侧边栏在屏上。
  await expect
    .poll(
      () =>
        document
          .querySelector<HTMLElement>('[data-testid="desktop-sidebar"]')
          ?.getBoundingClientRect().width ?? 0,
    )
    .toBeGreaterThan(0);
  return { vscode };
}

describe("桌面 pane/会话焦点切换联动", () => {
  it("点击非聚焦 pane 发出 desktopFocusPane，另一 pane 内容不受影响", async () => {
    await page.viewport(1280, 800);

    const { vscode } = await setup(
      ["sess-a1", "sess-b1"],
      ["pane-1", "pane-2"],
    );
    // 原文的 `clearMessageLog()`：记下此刻已发过几条，之后只看切片（启动那批
    // 报文里本来也没有 desktopFocusPane，所以下面轮询到的必然是这次点击发的）。
    const mark = sentCommands(vscode).length;

    // 真指针点击：焦点是 mousedown 时发的（`userEvent.click` 走 CDP 真输入，
    // 命中测试与 Playwright 的 `locator.click()` 同一套）。
    await userEvent.click(q('[data-testid="desktop-pane-pane-2"]'));
    await expect
      .poll(
        () =>
          sentCommands(vscode)
            .slice(mark)
            .find((message) => message.command === "desktopFocusPane"),
        { timeout: 4000 },
      )
      .toMatchObject({ command: "desktopFocusPane", paneId: "pane-2" });

    // 两个 pane 的会话内容都还在（焦点切换不重挂载/清空兄弟 pane）
    expect(
      (q('[data-testid="desktop-pane-pane-1"]').textContent ?? "").includes(
        "来自 pane-1",
      ),
    ).toBe(true);
    expect(
      (q('[data-testid="desktop-pane-pane-2"]').textContent ?? "").includes(
        "来自 pane-2",
      ),
    ).toBe(true);
    expect(
      sentCommands(vscode)
        .slice(mark)
        .map((message) => message.command),
    ).not.toContain("desktopSelectSession");
  });

  it("切换 pane 绑定会话后，侧边栏当前行跟随聚焦 pane", async () => {
    await page.viewport(1280, 800);

    await setup(["sess-a1", "sess-a2"], ["pane-1"]);

    await expect
      .poll(() =>
        hasClass(
          "desktop-session-item-sess-a1",
          "desktop-session-item--current",
        ),
      )
      .toBe(true);

    // 聚焦 pane 换绑会话 → current 高亮迁移
    sendCommand("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a2", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-1",
    });
    await expect
      .poll(() =>
        hasClass(
          "desktop-session-item-sess-a2",
          "desktop-session-item--current",
        ),
      )
      .toBe(true);
    expect(
      hasClass("desktop-session-item-sess-a1", "desktop-session-item--current"),
    ).toBe(false);
  });

  it("聚焦 pane 变化时 current 行看聚焦 pane 而非其它 pane", async () => {
    await page.viewport(1280, 800);

    await setup(["sess-a1", "sess-b1"], ["pane-1", "pane-2"]);

    // 聚焦 pane-1（sess-a1）
    await expect
      .poll(() =>
        hasClass(
          "desktop-session-item-sess-a1",
          "desktop-session-item--current",
        ),
      )
      .toBe(true);
    expect(
      hasClass("desktop-session-item-sess-b1", "desktop-session-item--current"),
    ).toBe(false);

    // 宿主确认焦点切到 pane-2 → current 行必须跟着聚焦 pane 走
    sendCommand("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1", host: "local", row: 0 },
        { paneId: "pane-2", sessionId: "sess-b1", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-2",
    });
    await expect
      .poll(() =>
        hasClass(
          "desktop-session-item-sess-b1",
          "desktop-session-item--current",
        ),
      )
      .toBe(true);
    expect(
      hasClass("desktop-session-item-sess-a1", "desktop-session-item--current"),
    ).toBe(false);
  });
});
