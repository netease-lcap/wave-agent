import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

// Real-browser verification of the sidebar scroll contract
// (spec docs/specs/desktop/desktop-layout.md 「会话列表滚动、入口固定」场景 1-4):
// the session list is the sidebar's only scroll container — 新对话 / 插件市场
// entries and the account card stay pinned. jsdom has no layout, so this
// contract can only be asserted where a real engine computes heights.

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

const scrollState = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const read = (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return null;
      return {
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflowY: getComputedStyle(el).overflowY,
      };
    };
    return {
      sidebar: read('[data-testid="desktop-sidebar"]')!,
      tree: read('[data-testid="desktop-session-tree"]')!,
    };
  });

const boxOf = async (
  page: import("@playwright/test").Page,
  selector: string,
): Promise<Box> => {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  return box;
};

/** Pin geometry of every fixed row so a scroll that moved them is caught. */
const fixedBoxes = async (page: import("@playwright/test").Page) => ({
  newChat: await boxOf(page, '[data-testid="desktop-new-session"]'),
  pluginMarket: await boxOf(page, '[data-testid="desktop-plugin-market"]'),
  account: await boxOf(page, '[data-testid="account-card"]'),
  sidebar: await boxOf(page, '[data-testid="desktop-sidebar"]'),
});

const expectPinned = (
  before: Awaited<ReturnType<typeof fixedBoxes>>,
  after: Awaited<ReturnType<typeof fixedBoxes>>,
) => {
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

test.describe("Desktop sidebar scroll region", () => {
  test("only the session list scrolls; entries and account card stay pinned", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1000, height: 700 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B],
    });
    await injector.simulateExtensionMessage("desktopSessionTree", {
      groups: MANY_GROUPS,
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.simulateExtensionMessage("desktopAccountInfo", {
      isAuthenticated: true,
      user: { id: "user-1", email: "alice@example.com" },
      plan: { monthlyQuota: 100, months: 12, used: 240 },
      apiQuota: { limit: null, used: 1153.14 },
    });

    const tree = webviewPage.getByTestId("desktop-session-tree");
    await expect(webviewPage.getByTestId("account-card")).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-session-item-s-a12"),
    ).toBeVisible();

    // ── Scenario 1: the list overflows, the sidebar itself does not ──
    const initial = await scrollState(webviewPage);
    expect(initial.tree.overflowY).toBe("auto");
    expect(initial.tree.scrollHeight).toBeGreaterThan(
      initial.tree.clientHeight,
    );
    expect(initial.sidebar.overflowY).toBe("hidden");
    expect(initial.sidebar.scrollHeight).toBe(initial.sidebar.clientHeight);
    expect(initial.sidebar.scrollTop).toBe(0);

    // ── Scenario 2: the account card sits flush with the sidebar bottom ──
    const before = await fixedBoxes(webviewPage);
    expect(
      Math.abs(
        before.sidebar.y +
          before.sidebar.height -
          (before.account.y + before.account.height),
      ),
      "account card must hug the sidebar bottom",
    ).toBeLessThanOrEqual(13); // sidebar padding-bottom is 12px

    // ── Scenario 1/3: scrolling moves only the list; entries never move ──
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const scrolled = await scrollState(webviewPage);
    expect(scrolled.tree.scrollTop).toBeGreaterThan(0);
    expect(scrolled.sidebar.scrollTop).toBe(0);
    expect(scrolled.sidebar.scrollHeight).toBe(scrolled.sidebar.clientHeight);
    expectPinned(before, await fixedBoxes(webviewPage));

    // ── Scenario 3: wheel past the end changes nothing outside the list ──
    await tree.hover();
    await webviewPage.mouse.wheel(0, 800);
    const overscrolled = await scrollState(webviewPage);
    expect(overscrolled.tree.scrollTop).toBe(scrolled.tree.scrollTop);
    expect(overscrolled.sidebar.scrollTop).toBe(0);
    const docScroll = await webviewPage.evaluate(() => ({
      body: document.body.scrollTop,
      doc: document.documentElement.scrollTop,
    }));
    expect(docScroll).toEqual({ body: 0, doc: 0 });
    expectPinned(before, await fixedBoxes(webviewPage));

    // ── Scenario 4: shrink the window — the card keeps its height and the
    // compression lands on the list (which stays scrollable) ──
    await webviewPage.setViewportSize({ width: 1000, height: 380 });
    const shortBefore = await fixedBoxes(webviewPage);
    const shortState = await scrollState(webviewPage);
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
    await tree.evaluate((el) => {
      el.scrollTop = 0;
    });
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const shortScrolled = await scrollState(webviewPage);
    expect(shortScrolled.tree.scrollTop).toBeGreaterThan(0);
    expectPinned(shortBefore, await fixedBoxes(webviewPage));
    await expect(
      webviewPage.getByTestId("desktop-session-item-s-b6"),
    ).toBeVisible();
  });
});
