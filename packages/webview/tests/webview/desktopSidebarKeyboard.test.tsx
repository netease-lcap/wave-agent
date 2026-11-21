/**
 * 侧栏会话树的键盘模型（spec `docs/specs/desktop/desktop-sessions.md`「会话管理」
 * 场景 13-19）。
 *
 * 迁移自 `e2e/desktop-sidebar-keyboard.e2e.ts`。契约：每一行会话都是原生
 * Tab 可达（claude.ai 模型），↑/↓/Home/End 作为加速键在行间移动，「更多」按钮
 * 不在 Tab 序列里（只走 ←/→），也没有任何删除快捷键。原文明确说「jsdom 覆盖了
 * 焦点逻辑，这里补 jsdom 给不了的那一半：原生 button 的 Enter/Space 激活、
 * `:focus-within` 的显形、以及真实的 Tab 序列」。
 *
 * 本套件跑在真 Chromium 里：`userEvent.keyboard` 走的是 Playwright 的真键盘
 * （`page.keyboard`），Tab 是真序列导航，焦点断言读的是真 `document.activeElement`。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/shop-server";

const treeSession = (sessionId: string, title: string) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
  running: false,
  waitingConfirmation: false,
});

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 当前真焦点元素的 `data-testid`（等价原文的 `activeTestId(page)`）。 */
const activeTestId = () => {
  const el = document.activeElement as HTMLElement | null;
  return el?.getAttribute("data-testid") ?? null;
};

/** 焦点是否落在分组头按钮上（组头本身没有 data-testid，testid 在外层 div）。 */
const activeIsGroupHeader = () =>
  (document.activeElement as HTMLElement | null)?.classList.contains(
    "desktop-session-group-header",
  ) ?? false;

/** 焦点落在哪个 `data-testid` 上（等价 Playwright 的 `toBeFocused`）。 */
async function expectActive(testId: string) {
  await expect.poll(activeTestId).toBe(testId);
}

/** 某条命令发出去过几次（等价原文的 `getTestMessages()` + 过滤）。 */
const sentCommandsNamed = (vscode: { postMessage: unknown }, command: string) =>
  sentCommands(vscode).filter((message) => message.command === command);

/** 分组头按钮（组头是分组 div 里的那个 button）。 */
const groupHeader = (workdir: string) =>
  document.querySelector<HTMLElement>(
    `[data-testid="desktop-session-group-local:${workdir}"] .desktop-session-group-header`,
  )!;

/** 「更多」按钮的实时透明度（`:focus-visible` / hover 决定 0 或 1）。 */
const moreOpacity = () =>
  getComputedStyle(screen.getByTestId("desktop-session-more-s1")).opacity;

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

describe("Desktop sidebar keyboard navigation", () => {
  it("Tab walks every row, arrows, Enter semantics and group collapse", async () => {
    await page.viewport(960, 720);

    const { vscode } = renderDesktopApp();
    // 按原文顺序推消息：工作目录 → 会话树 → 初值。
    sendCommand("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B],
    });
    sendCommand("desktopSessionTree", {
      groups: [
        {
          host: "local",
          workdir: DIR_A,
          sessions: [treeSession("s1", "会话一"), treeSession("s2", "会话二")],
        },
        {
          host: "local",
          workdir: DIR_B,
          sessions: [treeSession("s3", "会话三")],
        },
      ],
    });
    sendCommand("setInitialState", initialState);

    await expect
      .poll(() => isVisible('[data-testid="desktop-sidebar"]'))
      .toBe(true);

    // ── 场景 13：Tab 逐行走完会话树 ──────────────────────────────────
    // 从树之前开始 Tab：插件市场 / 创作集入口 → 分组头和会话行都在 Tab 序列里
    // （claude.ai 模型），删除按钮永远不在。
    screen.getByTestId("desktop-new-session").focus();
    // 新对话 → 插件市场 → 创作集 是侧边栏里从上到下相邻的三个入口按钮，Tab 依次
    // 经过后两者（入口本身见 spec ecosystem/plugin.md「插件市场」场景 1 与
    // desktop/desktop-artifacts.md「创作集整页」）。
    await userEvent.keyboard("{Tab}");
    await expectActive("desktop-plugin-market");
    await userEvent.keyboard("{Tab}");
    await expectActive("desktop-artifacts");
    const tabStops: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      await userEvent.keyboard("{Tab}");
      tabStops.push(activeIsGroupHeader() ? "group-header" : activeTestId());
    }
    // 顺序：header A → s1 → s2 → header B → s3（删除按钮被跳过）。
    expect(tabStops).toEqual([
      "group-header",
      "desktop-session-main-s1",
      "desktop-session-main-s2",
      "group-header",
      "desktop-session-main-s3",
    ]);

    // ── 场景 14/15：↑/↓ 跨分组移动并绕回；Home/End ──────────────────
    await screen.getByTestId("desktop-session-main-s1").focus();
    await userEvent.keyboard("{ArrowDown}");
    await expectActive("desktop-session-main-s2");
    // 越过最后一行绕回第一行（跨分组 A → B → A）。
    await userEvent.keyboard("{ArrowDown}");
    await expectActive("desktop-session-main-s3");
    await userEvent.keyboard("{ArrowDown}");
    await expectActive("desktop-session-main-s1");
    await userEvent.keyboard("{ArrowUp}");
    await expectActive("desktop-session-main-s3");
    await userEvent.keyboard("{Home}");
    await expectActive("desktop-session-main-s1");
    await userEvent.keyboard("{End}");
    await expectActive("desktop-session-main-s3");

    // ── 场景 17（前半）：会话行主按钮上的 Enter 是「恢复会话」 ────────
    // 原文先 clearMessageLog()，这里记下当前长度，之后只看切片。
    const logBeforeSelect = sentCommands(vscode).length;
    await screen.getByTestId("desktop-session-main-s1").focus();
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() =>
        sentCommands(vscode)
          .slice(logBeforeSelect)
          .filter((message) => message.command === "desktopSelectSession"),
      )
      .toContainEqual(
        expect.objectContaining({
          command: "desktopSelectSession",
          sessionId: "s1",
        }),
      );

    // ── 场景 16：←/→ 在同一行里走一格；「更多」按钮在焦点进入时显形
    // （:focus-within），并在行边缘夹住 ────────────────────────────────
    await userEvent.keyboard("{ArrowRight}");
    await expectActive("desktop-session-more-s1");
    await expect.poll(moreOpacity).toBe("1");
    // 再按 → 仍夹在「更多」按钮上。
    await userEvent.keyboard("{ArrowRight}");
    await expectActive("desktop-session-more-s1");
    // ← 回到行主按钮；「更多」按钮仍然可见 —— 行还在 :focus-within
    // （对齐 Claude 的 group-focus-within）。
    await userEvent.keyboard("{ArrowLeft}");
    await expectActive("desktop-session-main-s1");
    expect(moreOpacity()).toBe("1");

    // 焦点离开这行，它重新隐藏。
    await userEvent.keyboard("{ArrowDown}");
    await expectActive("desktop-session-main-s2");
    await expect.poll(moreOpacity).toBe("0");

    // 停在删除按钮上时，纵向移动仍从这一行出发。
    await userEvent.keyboard("{ArrowUp}");
    await expectActive("desktop-session-main-s1");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowDown}");
    await expectActive("desktop-session-main-s2");

    // ── 场景 17（后半）：「更多」按钮上的 Enter 打开行菜单；激活「删除会话」
    // 弹出确认框；Escape 取消 ─────────────────────────────────────────
    await userEvent.keyboard("{ArrowLeft}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");
    // 菜单挂载即打开，并自动聚焦第一项（并排打开）。
    await expect
      .poll(
        () =>
          document.activeElement ===
          screen.getByTestId("desktop-session-menu-split"),
      )
      .toBe(true);
    // 菜单顺序固定为 并排打开 / 重命名 / 删除会话，两个 ArrowDown 才到删除。
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .poll(
        () =>
          document.activeElement ===
          screen.getByTestId("desktop-session-menu-rename"),
      )
      .toBe(true);
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}"); // 删除会话
    await expect
      .poll(() => isVisible('[data-testid="confirm-dialog-overlay"]'))
      .toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => isVisible('[data-testid="confirm-dialog-overlay"]'))
      .toBe(false);
    // 没有确认就绝不会发删除（场景 19）。原文在这里看的是「清空日志之后的切片」，
    // 这里对整条发送日志过滤 —— 更严：任何一次删除请求都会把它弄红。
    expect(sentCommandsNamed(vscode, "desktopDeleteSession")).toHaveLength(0);

    // ── 场景 18：分组头是可用键盘切换的按钮 ──────────────────────────
    await userEvent.keyboard("{Escape}"); // 确保弹窗已经消失
    groupHeader(DIR_A).focus();
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => groupHeader(DIR_A).getAttribute("aria-expanded"))
      .toBe("false");
    await expect
      .poll(() => isVisible('[data-testid="desktop-session-main-s1"]'))
      .toBe(false);
    // 收起行整片离开方向键的候选集：只剩 s3，于是 ↓ 绕回自己。
    await screen.getByTestId("desktop-session-main-s3").focus();
    await userEvent.keyboard("{ArrowDown}");
    await expectActive("desktop-session-main-s3");
    // 重新展开，干净收尾。
    groupHeader(DIR_A).focus();
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => groupHeader(DIR_A).getAttribute("aria-expanded"))
      .toBe("true");
    await expect
      .poll(() => isVisible('[data-testid="desktop-session-main-s1"]'))
      .toBe(true);
  });
});
