/**
 * 分支查询占位行的几何（spec `desktop-sessions.md` 场景 7/8/25）。
 *
 * 迁移自 `e2e/desktop-branches-loading-row.e2e.ts`。占位行
 * （`desktop-branches-loading`）顶替的是分支 / worktree 控件，落点与它们同一格
 * （输入区的 workdir 行）：该行 `align-items: flex-end`，行里每个控件都是 32px
 * 高的 flex 盒，所以占位行也必须撑出同样的 32px 并把文字居中——否则它那一行
 * 17px 的文字会贴在行下缘，比旁边的「本地」/工作目录名低 ~7px。
 *
 * 这条契约只能用真布局量，所以本套件跑在真 Chromium 里（宿主档由
 * `desktopHarness` 打开）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page } from "vitest/browser";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 某个选择器的盒（不存在时抛错，等价 Playwright 的 `boundingBox()` 非空断言）。 */
function boxOf(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`expected ${selector} to be laid out`);
  return element.getBoundingClientRect();
}

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

describe("Desktop branch-loading placeholder geometry", () => {
  it("sits on the same line as the host/workdir selectors it follows", async () => {
    await page.viewport(960, 640);

    renderDesktopApp();
    // 按原文顺序：先推工作目录（这一步才挂上 pane 的 ChatApp），再推初值。
    sendCommand("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
      host: "local",
      hosts: ["local"],
    });
    sendCommand("setInitialState", initialState);

    // 宿主从不回答 desktopListGitBranches，所以 300ms
    // （BRANCH_LIST_LOADING_DELAY_MS）过去后占位行取代控件。
    await expect
      .poll(() => isVisible('[data-testid="desktop-branches-loading"]'), {
        timeout: 4000,
      })
      .toBe(true);

    const hostBox = boxOf(".desktop-host-trigger");
    const workdirBox = boxOf('[data-testid="desktop-workdir"]');
    const loadingBox = boxOf('[data-testid="desktop-branches-loading"]');

    // 与 32px 控件同样的纵向尺寸 ⇒ 它的文字行落在它们那一行上，而不是贴行下缘。
    expect(loadingBox.height).toBeCloseTo(hostBox.height, 1);
    expect(loadingBox.height).toBeCloseTo(workdirBox.height, 1);
    expect(loadingBox.y).toBeCloseTo(hostBox.y, 1);
    expect(loadingBox.y).toBeCloseTo(workdirBox.y, 1);

    // 它顶替的控件落在同一格（没有位置跳动）。
    sendCommand("desktopGitBranches", {
      workdir: DIR_A,
      result: { branches: ["main", "dev"], current: "main" },
    });
    await expect
      .poll(() => isVisible('[data-testid="desktop-branch-selector"]'), {
        timeout: 4000,
      })
      .toBe(true);
    const branchBox = boxOf('[data-testid="desktop-branch-selector"]');
    expect(branchBox.y).toBeCloseTo(loadingBox.y, 1);
    expect(branchBox.height).toBeCloseTo(loadingBox.height, 1);
    expect(branchBox.x).toBeCloseTo(loadingBox.x, 1);
  });
});
