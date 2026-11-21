/**
 * 会话行菜单的落点（spec desktop/desktop-sessions.md「会话行菜单完整可见」场景 1-2）。
 *
 * 迁移自 `e2e/desktop-sidebar-row-menu.e2e.ts`。菜单必须完整落在窗口内——行下方放
 * 不下就整个翻到行的上方；上下都放不下时才夹在窗口内并内部滚动。几何函数
 * （`utils/anchoredMenu.ts` 的 `placeAnchoredMenu`）有自己的单测，这里验的是真实
 * 渲染与点击路径：`position: fixed` 的菜单相对窗口的落点、以及翻转后那一项真能点。
 *
 * 本套件跑在真 Chromium 里，所以 `getBoundingClientRect` / `scrollHeight` /
 * `clientHeight` 都是真布局值。
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
  twoFrames,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

const treeSession = (sessionId: string, title: string) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
  running: false,
  waitingConfirmation: false,
});

/** 40 rows in one group — plenty past one screen at 800px. */
const MANY = [
  {
    host: "local",
    workdir: DIR_A,
    sessions: Array.from({ length: 40 }, (_, i) =>
      treeSession(`s-${i + 1}`, `会话 ${i + 1}`),
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

/**
 * 按原文顺序推消息：工作目录 → 会话树 → 初值 → 账户信息（账户卡片在场时会话
 * 列表最矮，是最容易把菜单挤出窗口的形态）。
 */
function seed() {
  const result = renderDesktopApp();
  sendCommand("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  sendCommand("desktopSessionTree", { groups: MANY });
  sendCommand("setInitialState", initialState);
  sendCommand("desktopAccountInfo", {
    isAuthenticated: true,
    user: { id: "user-1", email: "alice@example.com" },
  });
  return result;
}

/**
 * 行菜单的「⋯」只在行 hover 时可见（`opacity: 0` + `pointer-events: none`），
 * 照原文 force 点击：跳过可操作性等待，指针事件与焦点照常派发。
 */
async function openRowMenu(sessionId: string) {
  await userEvent.click(
    screen.getByTestId(`desktop-session-more-${sessionId}`),
    { force: true },
  );
  await expect
    .poll(() => isVisible('[data-testid="desktop-session-menu"]'))
    .toBe(true);
}

type Box = { top: number; bottom: number; left: number; right: number };

/** 菜单、三个菜单项与窗口尺寸（菜单是 `fixed`，所以这些值可直接和窗口比）。 */
function menuGeometry() {
  const menu = document.querySelector<HTMLElement>(
    '[data-testid="desktop-session-menu"]',
  )!;
  const toBox = (element: Element): Box => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    };
  };
  return {
    menu: toBox(menu),
    items: Array.from(menu.querySelectorAll('[role="menuitem"]')).map(toBox),
    viewport: {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
    },
    scrollable: menu.scrollHeight - menu.clientHeight > 1,
  };
}

const boxOf = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`no element for ${selector}`);
  return element.getBoundingClientRect();
};

/** 会话列表滚到顶 / 底。滚动后让 React 的 scroll 处理与布局各落一帧。 */
async function scrollTreeTo(position: "top" | "bottom") {
  const tree = document.querySelector<HTMLElement>(
    '[data-testid="desktop-session-tree"]',
  )!;
  tree.scrollTop = position === "top" ? 0 : tree.scrollHeight;
  await twoFrames();
}

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

describe("会话行菜单落点", () => {
  it("行在列表上方时照常向下展开，三项都完整可见", async () => {
    await page.viewport(1200, 800);
    seed();
    await expect
      .poll(() => isVisible('[data-testid="account-card"]'))
      .toBe(true);

    await openRowMenu("s-3");
    const row = boxOf('[data-testid="desktop-session-more-s-3"]');
    const geo = menuGeometry();

    // 下方放得下 ⇒ 保持向下展开（不翻转），且窗口顶部不再是判据
    expect(geo.menu.top).toBeGreaterThanOrEqual(row.bottom);
    expect(geo.scrollable).toBe(false);
    for (const item of geo.items) {
      expect(item.top).toBeGreaterThanOrEqual(0);
      expect(item.bottom).toBeLessThanOrEqual(geo.viewport.height);
    }
    expect(geo.items).toHaveLength(3);
  });

  it("列表滚到底时，最后一条会话的菜单翻到行上方且三项都在窗口内", async () => {
    await page.viewport(1200, 800);
    seed();
    await expect
      .poll(() => isVisible('[data-testid="account-card"]'))
      .toBe(true);

    // 滚到底：最后一条会话贴在会话列表下缘（= 窗口下缘附近），下方必然放不下菜单
    await scrollTreeTo("bottom");
    await expect
      .poll(() => isVisible('[data-testid="desktop-session-item-s-40"]'), {
        timeout: 2000,
      })
      .toBe(true);

    await openRowMenu("s-40");
    const row = boxOf('[data-testid="desktop-session-more-s-40"]');
    const geo = menuGeometry();

    // ① 整个菜单在窗口内（改前：bottom 844 > 视口 800，后两项被裁掉）
    expect(geo.menu.top).toBeGreaterThanOrEqual(0);
    expect(geo.menu.bottom).toBeLessThanOrEqual(geo.viewport.height);
    // ② 翻到了行的上方：菜单底边不越过行的顶边（留 4px 缝，不盖住触发它的行）
    expect(geo.menu.bottom).toBeLessThanOrEqual(row.top + 0.5);
    // ③ 三项全部完整可见、可点
    expect(geo.items).toHaveLength(3);
    for (const item of geo.items) {
      expect(item.top).toBeGreaterThanOrEqual(0);
      expect(item.bottom).toBeLessThanOrEqual(geo.viewport.height);
    }

    // ④ 翻转后的菜单是真能点的：删除会话 → 弹确认框
    await userEvent.click(screen.getByTestId("desktop-session-menu-delete"));
    await expect
      .poll(() => isVisible('[data-testid="confirm-dialog-overlay"]'))
      .toBe(true);
  });

  it("窗口很矮、行贴着列表底边时菜单仍在窗口内（必要时内部滚动）", async () => {
    await page.viewport(1200, 320);
    seed();
    await expect
      .poll(() => isVisible('[data-testid="account-card"]'))
      .toBe(true);

    await scrollTreeTo("bottom");
    await openRowMenu("s-40");
    const geo = menuGeometry();
    expect(geo.menu.top).toBeGreaterThanOrEqual(0);
    expect(geo.menu.bottom).toBeLessThanOrEqual(geo.viewport.height);
    if (geo.scrollable) {
      const menu = document.querySelector<HTMLElement>(
        '[data-testid="desktop-session-menu"]',
      )!;
      menu.scrollTop = menu.scrollHeight;
      await twoFrames();
      const scrolled = menuGeometry();
      expect(scrolled.items[2].bottom).toBeLessThanOrEqual(
        scrolled.viewport.height,
      );
    }
    // 无论走哪个分支，最后一项都必须点得到
    await userEvent.click(screen.getByTestId("desktop-session-menu-delete"));
    await expect
      .poll(() => isVisible('[data-testid="confirm-dialog-overlay"]'))
      .toBe(true);
  });
});
