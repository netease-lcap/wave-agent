/**
 * 侧栏滚动契约（spec docs/specs/desktop/desktop-layout.md「会话列表滚动、入口固定」
 * 场景 1-4）：会话列表是侧栏唯一的滚动容器——「新对话」/「插件市场」/「创作集」
 * 入口与账户卡片固定不动，窗口变矮时压缩全部落在列表上。
 *
 * 迁移自 `e2e/desktop-sidebar-scroll.e2e.ts`。jsdom 没有布局，`scrollHeight` /
 * `clientHeight` / `getBoundingClientRect` 都量不出真值，所以这条契约只能在真引擎
 * 里断言（本套件跑在真 Chromium 里，读到的是真布局）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  twoFrames,
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

/** 18 rows across two groups — well past one screen at 700px. */
const MANY_GROUPS = [
  {
    host: "local",
    workdir: DIR_A,
    sessions: Array.from({ length: 12 }, (_, i) =>
      treeSession(`s-a${i + 1}`, `会话 A${i + 1}`),
    ),
  },
  {
    host: "local",
    workdir: DIR_B,
    sessions: Array.from({ length: 6 }, (_, i) =>
      treeSession(`s-b${i + 1}`, `会话 B${i + 1}`),
    ),
  },
];

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

type Box = { x: number; y: number; width: number; height: number };

const el = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`no element for ${selector}`);
  return element;
};

/** 侧栏与会话列表两个滚动盒的真值（`overflowY` 也一并读，脚本里量的是它）。 */
function scrollState() {
  const read = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return null;
    return {
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    };
  };
  return {
    sidebar: read('[data-testid="desktop-sidebar"]')!,
    tree: read('[data-testid="desktop-session-tree"]')!,
  };
}

const boxOf = (selector: string): Box => {
  const rect = el(selector).getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};

/** Pin geometry of every fixed row so a scroll that moved them is caught. */
const fixedBoxes = () => ({
  newChat: boxOf('[data-testid="desktop-new-session"]'),
  pluginMarket: boxOf('[data-testid="desktop-plugin-market"]'),
  account: boxOf('[data-testid="account-card"]'),
  sidebar: boxOf('[data-testid="desktop-sidebar"]'),
});

type FixedBoxes = ReturnType<typeof fixedBoxes>;

const expectPinned = (before: FixedBoxes, after: FixedBoxes) => {
  for (const key of ["newChat", "pluginMarket", "account"] as const) {
    expect(
      Math.abs(after[key].y - before[key].y),
      `${key} must not move while the list scrolls`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(after[key].height - before[key].height),
    ).toBeLessThanOrEqual(1);
  }
};

const tree = () => el('[data-testid="desktop-session-tree"]');

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

describe("Desktop sidebar scroll region", () => {
  it("only the session list scrolls; entries and account card stay pinned", async () => {
    await page.viewport(1000, 700);
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B],
    });
    sendCommand("setInitialState", initialState);
    sendCommand("desktopSessionTree", { groups: MANY_GROUPS });
    sendCommand("desktopAccountInfo", {
      isAuthenticated: true,
      user: { id: "user-1", email: "alice@example.com" },
      billing: {
        mode: "plan",
        plan: {
          monthUsed: 400,
          monthLimit: 1000,
          weekUsed: 60,
          weekLimit: 500,
          expireDate: "2027-03-01",
        },
      },
      apiQuota: { limit: null, used: 1153.14 },
    });
    // 布局（ResizeObserver + 首帧）落定后再量。
    await twoFrames();

    await expect
      .poll(() => isVisible('[data-testid="account-card"]'))
      .toBe(true);
    await expect
      .poll(() => isVisible('[data-testid="desktop-session-item-s-a12"]'))
      .toBe(true);

    // ── Scenario 1: the list overflows, the sidebar itself does not ──
    const initial = scrollState();
    expect(initial.tree.overflowY).toBe("auto");
    expect(initial.tree.scrollHeight).toBeGreaterThan(
      initial.tree.clientHeight,
    );
    expect(initial.sidebar.overflowY).toBe("hidden");
    expect(initial.sidebar.scrollHeight).toBe(initial.sidebar.clientHeight);
    expect(initial.sidebar.scrollTop).toBe(0);

    // ── Scenario 2: the account card sits flush with the sidebar bottom ──
    const before = fixedBoxes();
    expect(
      Math.abs(
        before.sidebar.y +
          before.sidebar.height -
          (before.account.y + before.account.height),
      ),
      "account card must hug the sidebar bottom",
    ).toBeLessThanOrEqual(13); // sidebar padding-bottom is 12px

    // ── Scenario 1/3: scrolling moves only the list; entries never move ──
    tree().scrollTop = tree().scrollHeight;
    await twoFrames();
    const scrolled = scrollState();
    expect(scrolled.tree.scrollTop).toBeGreaterThan(0);
    expect(scrolled.sidebar.scrollTop).toBe(0);
    expect(scrolled.sidebar.scrollHeight).toBe(scrolled.sidebar.clientHeight);
    expectPinned(before, fixedBoxes());

    // ── Scenario 3: wheel past the end changes nothing outside the list ──
    // browser mode 里 `userEvent.wheel` 派发的是真 `WheelEvent`（命中测试走真元素），
    // 但合成事件本身不会让浏览器滚动：这条断言因此验的是「列表已到尽头后再滚，
    // 列表外的一切都不动」——与原文在这一步要保住的契约同一件事。列表自身的位置
    // 另有下面那条「再写一次到底，位置仍被夹在最大值」兜住。
    await userEvent.hover(tree());
    await userEvent.wheel(tree(), { delta: { y: 800 } });
    tree().scrollTop = tree().scrollHeight + 800; // 浏览器把越界值夹回最大值
    await twoFrames();
    const overscrolled = scrollState();
    expect(overscrolled.tree.scrollTop).toBe(scrolled.tree.scrollTop);
    expect(overscrolled.sidebar.scrollTop).toBe(0);
    expect({
      body: document.body.scrollTop,
      doc: document.documentElement.scrollTop,
    }).toEqual({ body: 0, doc: 0 });
    expectPinned(before, fixedBoxes());

    // ── Scenario 4: shrink the window — the card keeps its height and the
    // compression lands on the list (which stays scrollable) ──
    await page.viewport(1000, 380);
    await twoFrames();
    const shortBefore = fixedBoxes();
    const shortState = scrollState();
    expect(shortState.tree.clientHeight).toBeLessThan(
      initial.tree.clientHeight,
    );
    expect(shortState.tree.scrollHeight).toBeGreaterThan(
      shortState.tree.clientHeight,
    );
    expect(shortBefore.newChat.height).toBe(before.newChat.height);
    expect(shortBefore.pluginMarket.height).toBe(before.pluginMarket.height);
    expect(shortBefore.account.height).toBe(before.account.height);
    expect(shortState.sidebar.scrollTop).toBe(0);

    // The list can still be scrolled to its end inside the shrunken region.
    tree().scrollTop = 0;
    await twoFrames();
    tree().scrollTop = tree().scrollHeight;
    await twoFrames();
    const shortScrolled = scrollState();
    expect(shortScrolled.tree.scrollTop).toBeGreaterThan(0);
    expectPinned(shortBefore, fixedBoxes());
    await expect
      .poll(() => isVisible('[data-testid="desktop-session-item-s-b6"]'))
      .toBe(true);
  });
});
