import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

// Real-browser verification of the session row menu placement
// (spec docs/specs/desktop/desktop-sessions.md「会话行菜单完整可见」场景 1-2):
// 菜单必须完整落在窗口内——行下方放不下就整个翻到行的上方；上下都放不下时才
// 夹在窗口内并内部滚动。jsdom/单测只覆盖几何函数，这里验证真实渲染与点击路径。

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

const seed = async (injector: MessageInjector) => {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.simulateExtensionMessage("desktopSessionTree", {
    groups: MANY,
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  // 账户卡片在场时会话列表最矮，是最容易把菜单挤出窗口的形态。
  await injector.simulateExtensionMessage("desktopAccountInfo", {
    isAuthenticated: true,
    user: { id: "user-1", email: "alice@example.com" },
  });
};

/** 行菜单的「⋯」只在行 hover 时可见，且 hover 气泡会挡住正常点击（见
 *  desktop-delete-session.e2e.ts 同一处说明）——统一 force-click。 */
const openRowMenu = async (
  page: import("@playwright/test").Page,
  sessionId: string,
) => {
  await page.getByTestId(`desktop-session-more-${sessionId}`).click({
    force: true,
  });
  await expect(page.getByTestId("desktop-session-menu")).toBeVisible();
};

type Box = { top: number; bottom: number; left: number; right: number };

const menuGeometry = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const menu = document.querySelector(
      '[data-testid="desktop-session-menu"]',
    ) as HTMLElement;
    const toBox = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
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
  });

const scrollTreeTo = (
  page: import("@playwright/test").Page,
  position: "top" | "bottom",
) =>
  page.evaluate((where) => {
    const tree = document.querySelector(
      '[data-testid="desktop-session-tree"]',
    ) as HTMLElement;
    tree.scrollTop = where === "top" ? 0 : tree.scrollHeight;
  }, position);

test.describe("会话行菜单落点", () => {
  test("行在列表上方时照常向下展开，三项都完整可见", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 1200, height: 800 });
    const injector = new MessageInjector(webviewPage);
    await seed(injector);
    await expect(webviewPage.getByTestId("account-card")).toBeVisible();

    await openRowMenu(webviewPage, "s-3");
    const row = await webviewPage
      .getByTestId("desktop-session-more-s-3")
      .boundingBox();
    const geo = await menuGeometry(webviewPage);

    // 下方放得下 ⇒ 保持向下展开（不翻转），且窗口顶部不再是判据
    expect(geo.menu.top).toBeGreaterThanOrEqual(row!.y + row!.height);
    expect(geo.scrollable).toBe(false);
    for (const item of geo.items) {
      expect(item.top).toBeGreaterThanOrEqual(0);
      expect(item.bottom).toBeLessThanOrEqual(geo.viewport.height);
    }
    expect(geo.items).toHaveLength(3);
  });

  test("列表滚到底时，最后一条会话的菜单翻到行上方且三项都在窗口内", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 1200, height: 800 });
    const injector = new MessageInjector(webviewPage);
    await seed(injector);
    await expect(webviewPage.getByTestId("account-card")).toBeVisible();

    // 滚到底：最后一条会话贴在会话列表下缘（= 窗口下缘附近），下方必然放不下菜单
    await scrollTreeTo(webviewPage, "bottom");
    await expect(
      webviewPage.getByTestId("desktop-session-item-s-40"),
    ).toBeVisible();

    await openRowMenu(webviewPage, "s-40");
    const row = await webviewPage
      .getByTestId("desktop-session-more-s-40")
      .boundingBox();
    const geo = await menuGeometry(webviewPage);

    // ① 整个菜单在窗口内（改前：bottom 844 > 视口 800，后两项被裁掉）
    expect(geo.menu.top).toBeGreaterThanOrEqual(0);
    expect(geo.menu.bottom).toBeLessThanOrEqual(geo.viewport.height);
    // ② 翻到了行的上方：菜单底边不越过行的顶边（留 4px 缝，不盖住触发它的行）
    expect(geo.menu.bottom).toBeLessThanOrEqual(row!.y + 0.5);
    // ③ 三项全部完整可见、可点
    expect(geo.items).toHaveLength(3);
    for (const item of geo.items) {
      expect(item.top).toBeGreaterThanOrEqual(0);
      expect(item.bottom).toBeLessThanOrEqual(geo.viewport.height);
    }

    // ④ 翻转后的菜单是真能点的：删除会话 → 弹确认框
    await webviewPage.getByTestId("desktop-session-menu-delete").click();
    await expect(
      webviewPage.getByTestId("confirm-dialog-overlay"),
    ).toBeVisible();
  });

  test("窗口很矮、行贴着列表底边时菜单仍在窗口内（必要时内部滚动）", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 1200, height: 320 });
    const injector = new MessageInjector(webviewPage);
    await seed(injector);
    await expect(webviewPage.getByTestId("account-card")).toBeVisible();

    await scrollTreeTo(webviewPage, "bottom");
    await openRowMenu(webviewPage, "s-40");
    const geo = await menuGeometry(webviewPage);

    expect(geo.menu.top).toBeGreaterThanOrEqual(0);
    expect(geo.menu.bottom).toBeLessThanOrEqual(geo.viewport.height);
    // 可滚动时（夹取分支）菜单自带滚动：滚到底后最后一项也要能进窗口
    if (geo.scrollable) {
      await webviewPage.evaluate(() => {
        const menu = document.querySelector(
          '[data-testid="desktop-session-menu"]',
        ) as HTMLElement;
        menu.scrollTop = menu.scrollHeight;
      });
      const scrolled = await menuGeometry(webviewPage);
      expect(scrolled.items[2].bottom).toBeLessThanOrEqual(
        scrolled.viewport.height,
      );
    }
    // 无论走哪个分支，最后一项都必须点得到
    await webviewPage.getByTestId("desktop-session-menu-delete").click();
    await expect(
      webviewPage.getByTestId("confirm-dialog-overlay"),
    ).toBeVisible();
  });
});
