/**
 * 桌面端下拉菜单的 roving-tabindex 键盘模型（主机 / 工作目录 / 分支选择器、
 * 侧栏「更多」菜单、头部「＋」面板菜单）。
 *
 * 迁移自 `e2e/desktop-selector-keyboard.e2e.ts`。原文强调「每条按键都是真键盘
 * 事件、每条焦点断言都量真的 `document.activeElement`」——jsdom 只能手写
 * `focus()`，量不到真实焦点链路，所以这套用例跑在真 Chromium 里：打开即聚焦某个
 * 条目（`useRovingMenu` 的 rAF 延迟聚焦）、方向键真的搬焦点且到边界不绕、
 * Enter/Space 激活当前条目、Escape 关闭并把焦点还给触发键、Tab 关闭但不激活。
 *
 * 宿主档由 `desktopHarness` 打开（`data-host="desktop"` + host-desktop.css）；
 * 这些菜单的条目顺序 / 初始聚焦位置都由组件自己决定，所以断言只看焦点落点。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  lastSent,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/shop-server";
const DIR_C = "/Users/dev/projects/notes-app";

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

/**
 * 按真机顺序推消息（与 `bootDesktop` 同一条链路，只是这些用例各自要推不同的
 * `desktopWorkdirState` 载荷：主机列表 / 多条最近目录）。每条命令各自 `act()`。
 */
function boot(workdirState: Record<string, unknown>) {
  const result = renderDesktopApp();
  sendCommand("desktopWorkdirState", workdirState);
  sendCommand("setInitialState", initialState);
  return result;
}

/** 真焦点落在第 `index` 个 `data-testid` 上（等价 Playwright 的 `toBeFocused`）。 */
async function expectFocused(
  testId: string,
  index = 0,
  timeout = 2000,
): Promise<void> {
  await expect
    .poll(
      () => document.activeElement === screen.queryAllByTestId(testId)[index],
      {
        timeout,
      },
    )
    .toBe(true);
}

/** 菜单开着 / 关着（关掉 = 卸载或不可见，等价 `toBeHidden`）。 */
async function expectVisible(selector: string, visible = true) {
  await expect.poll(() => isVisible(selector)).toBe(visible);
}

describe("Desktop dropdown roving keyboard", () => {
  it("workdir menu: opens focused, arrows move, Enter selects, Escape returns to trigger", async () => {
    await page.viewport(960, 640);
    const { vscode } = boot({
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
    });

    const trigger = screen.getByTestId("desktop-workdir");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expectVisible('[data-testid="desktop-workdir-menu"]');

    // Opening focuses the first recent item (hook's rAF-deferred focus).
    await expectFocused("desktop-workdir-recent-item", 0);

    // ArrowDown moves real focus to the next recent entry.
    await userEvent.keyboard("{ArrowDown}");
    await expectFocused("desktop-workdir-recent-item", 1);

    // Enter activates the focused entry: posts the selection and closes.
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => lastSent(vscode, "desktopSelectRecentWorkdir"))
      .toBeTruthy();
    await expectVisible('[data-testid="desktop-workdir-menu"]', false);
    await expect.poll(() => document.activeElement === trigger).toBe(true);
  });

  it("workdir menu: Escape returns focus, Tab closes without activating", async () => {
    await page.viewport(960, 640);
    const { vscode } = boot({
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
    });

    const trigger = screen.getByTestId("desktop-workdir");

    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expectVisible('[data-testid="desktop-workdir-menu"]');
    await expectFocused("desktop-workdir-recent-item", 0);

    await userEvent.keyboard("{Escape}");
    await expectVisible('[data-testid="desktop-workdir-menu"]', false);
    await expect.poll(() => document.activeElement === trigger).toBe(true);

    // Reopen and leave with Tab: the menu closes, nothing gets activated
    // (no desktopSelectRecentWorkdir / desktopSelectWorkdir posted).
    const before = vscode.postMessage.mock.calls.length;
    await userEvent.keyboard("{Enter}");
    await expectVisible('[data-testid="desktop-workdir-menu"]');
    // Wait for the open auto-focus to land on the first item first — Tab
    // closes the menu only from an item (from the trigger it would just move
    // focus to the next tab stop with the menu open).
    await expectFocused("desktop-workdir-recent-item", 0);
    await userEvent.keyboard("{Tab}");
    await expectVisible('[data-testid="desktop-workdir-menu"]', false);

    // 「nothing gets activated」：重开之后的这段窗口里没有选中类命令发出去。
    const sent = vscode.postMessage.mock.calls
      .slice(before)
      .map(([message]) => (message as { command?: string }).command);
    expect(sent).not.toContain("desktopSelectRecentWorkdir");
    expect(sent).not.toContain("desktopSelectWorkdir");
  });

  it("host menu: arrows rove over 本地/SSH hosts and Enter selects", async () => {
    await page.viewport(960, 640);
    const { vscode } = boot({
      host: "prod",
      hosts: ["prod", "stage"],
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });

    const trigger = screen.getByTestId("desktop-host");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expectVisible('[data-testid="desktop-host-menu"]');

    // Opens focused on 本地, then arrows walk prod → stage (no wrap below).
    await expectFocused("desktop-host-local", 0);
    await userEvent.keyboard("{ArrowDown}");
    await expectFocused("desktop-host-item", 0);
    await userEvent.keyboard("{ArrowDown}");
    await expectFocused("desktop-host-item", 1);
    // Next stop is the 添加主机… entry; pressing it again clamps there.
    await userEvent.keyboard("{ArrowDown}");
    await expectFocused("desktop-host-add-entry", 0);
    await userEvent.keyboard("{ArrowDown}");
    await expectFocused("desktop-host-add-entry", 0);

    // ArrowUp back to the last SSH host; Enter selects it and closes back to
    // the trigger.
    await userEvent.keyboard("{ArrowUp}");
    await expectFocused("desktop-host-item", 1);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => lastSent(vscode, "desktopSelectHost")).toBeTruthy();
    await expectVisible('[data-testid="desktop-host-menu"]', false);
    await expect.poll(() => document.activeElement === trigger).toBe(true);
  });

  it("branch menu: opens focused on the current branch (not necessarily first)", async () => {
    await page.viewport(960, 640);
    const { vscode } = boot({ workdir: DIR_A, recentWorkdirs: [DIR_A] });

    // The new-session page asks for the repo's branches; current is the LAST
    // item so the auto-focus must land there, not on the first option.
    await expect
      .poll(() => lastSent(vscode, "desktopListGitBranches"), { timeout: 4000 })
      .toBeTruthy();
    sendCommand("desktopGitBranches", {
      workdir: DIR_A,
      result: {
        branches: ["main", "feature/login", "develop"],
        current: "develop",
      },
    });

    const trigger = screen.getByTestId("desktop-branch-selector");
    await expectVisible('[data-testid="desktop-worktree-controls"]');

    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expectFocused("desktop-branch-item", 2);

    // ArrowUp walks back to feature/login; Escape closes back to the trigger.
    await userEvent.keyboard("{ArrowUp}");
    await expectFocused("desktop-branch-item", 1);
    await userEvent.keyboard("{Escape}");
    await expectVisible('[data-testid="desktop-branch-menu"]', false);
    await expect.poll(() => document.activeElement === trigger).toBe(true);
  });

  it("account card more menu: auto-focus on open, arrows move, Escape returns", async () => {
    await page.viewport(960, 640);
    boot({ workdir: DIR_A, recentWorkdirs: [DIR_A] });
    sendCommand("desktopAccountInfo", {
      isAuthenticated: true,
      user: { id: "user-1", email: "alice@example.com" },
      billing: null,
      apiQuota: null,
    });

    // v3 account card: the personal-info hotzone opens the menu.
    const trigger = screen.getByTestId("account-card-hotzone");
    await userEvent.click(trigger);
    await expectVisible('[data-testid="more-menu"]');

    // Controlled menu mounts already open: the first item gets real focus.
    await expectFocused("more-menu-settings", 0);

    await userEvent.keyboard("{ArrowDown}");
    await expectFocused("more-menu-enterprise", 0);

    await userEvent.keyboard("{Escape}");
    await expectVisible('[data-testid="more-menu"]', false);
    await expect.poll(() => document.activeElement === trigger).toBe(true);
  });

  it("panel tabs ＋ menu: opens focused, Space activates + closes, arrows move, Escape returns", async () => {
    await page.viewport(960, 640);
    boot({ workdir: DIR_A, recentWorkdirs: [DIR_A] });

    // The "＋" menu lives in the tab bar, so a first tab must exist: open the
    // terminal panel via the header toggle (empty slot → empty-state entry).
    await userEvent.click(screen.getByTestId("panel-toggle-btn"));
    await userEvent.click(screen.getByTestId("panel-empty-item-terminal"));
    await expectVisible('[data-testid="terminal-pane"]');

    const add = screen.getByTestId("panel-tabs-add");
    await userEvent.click(add);
    await expectVisible('[data-testid="panel-toggle-menu"]');

    // Opening focuses the first item (预览).
    await expectFocused("panel-toggle-item-preview", 0);

    // Arrows move between items without activating.
    await userEvent.keyboard("{ArrowDown}");
    await expectFocused("panel-toggle-item-plan", 0);
    await userEvent.keyboard("{ArrowDown}");
    await expectFocused("panel-toggle-item-diff", 0);

    // Space activates the focused item; the tab-bar menu is closeOnActivate —
    // the diff panel opens and the menu closes back to the "＋" trigger.
    await userEvent.keyboard(" ");
    await expectVisible('[data-testid="panel-toggle-menu"]', false);
    await expectVisible('[data-testid="diff-pane"]');
    await expect.poll(() => document.activeElement === add).toBe(true);
  });
});
