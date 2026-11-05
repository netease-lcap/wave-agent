import type { Page } from "@playwright/test";
import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * Real-browser geometry of the desktop account card's usage popover. jsdom has
 * no layout at all (`getBoundingClientRect` is all zeros, `maxHeight` can only
 * be asserted against a stubbed anchor), so the three things that actually
 * matter visually are verified here: the popup hugs the personal-info row, it
 * keeps the card's width and right edge, and it re-measures itself when the
 * window is resized instead of drifting away from the card.
 */

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 两个维度都有内容（页签会渲染），且本周触顶 ⇒ 预警点挂着。 */
const accountInfo = {
  isAuthenticated: true,
  user: { id: "user-1", email: "alice@example.com" },
  billing: {
    mode: "api",
    reason: "week",
    plan: {
      monthUsed: 600,
      monthLimit: 1000,
      weekUsed: 500,
      weekLimit: 500,
      expireDate: "2027-03-01",
    },
  },
  apiQuota: { limit: 10000, used: 1153.14 },
};

type Box = { x: number; y: number; width: number; height: number };
type Geometry = { card: Box; row: Box; pop: Box };

/** 账户卡片 / 个人信息行 / 用量浮层三块布局盒（真 Chromium 才有布局）。 */
async function measure(webviewPage: Page): Promise<Geometry> {
  const card = await webviewPage.getByTestId("account-card").boundingBox();
  const row = await webviewPage.locator(".account-card-main").boundingBox();
  const pop = await webviewPage
    .getByTestId("account-usage-popover")
    .boundingBox();
  if (!card || !row || !pop) throw new Error("用量浮层的布局盒量不到");
  return { card, row, pop };
}

/** 浮层底边贴个人信息行顶、宽度与右缘跟卡片对齐（留 1.5px 亚像素余量）。 */
function expectHuggingCard({ card, row, pop }: Geometry) {
  expect(Math.abs(pop.y + pop.height - row.y)).toBeLessThan(1.5);
  expect(Math.abs(pop.width - card.width)).toBeLessThan(1.5);
  expect(Math.abs(pop.x + pop.width - (card.x + card.width))).toBeLessThan(1.5);
}

async function openPopover(webviewPage: Page, height: number) {
  await webviewPage.setViewportSize({ width: 960, height });
  const injector = new MessageInjector(webviewPage);
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.simulateExtensionMessage("desktopAccountInfo", accountInfo);

  await expect(webviewPage.getByTestId("account-usage-btn")).toBeVisible();
  await webviewPage.getByTestId("account-usage-btn").click();
  await expect(webviewPage.getByTestId("account-usage-popover")).toBeVisible();
}

test.describe("Desktop account usage popover geometry", () => {
  test("hugs the personal-info row and follows a window resize", async ({
    webviewPage,
  }) => {
    await openPopover(webviewPage, 640);
    expectHuggingCard(await measure(webviewPage));

    const before = await measure(webviewPage);
    // 窗口变矮 ⇒ 卡片贴底部、个人信息行上移。浮层坐标是打开那一刻的快照，
    // 不跟随 resize 就会停在原处、与卡片分家。
    await webviewPage.setViewportSize({ width: 960, height: 520 });
    await expect
      .poll(async () => {
        const g = await measure(webviewPage);
        return Math.abs(g.pop.y + g.pop.height - g.row.y);
      })
      .toBeLessThan(1.5);

    const after = await measure(webviewPage);
    expectHuggingCard(after);
    expect(after.row.y).toBeLessThan(before.row.y - 40);
    expect(after.pop.y).toBeLessThan(before.pop.y - 40);
  });

  test("stays inside the viewport when the window is very short", async ({
    webviewPage,
  }) => {
    // 窗口矮到个人信息行顶上没有多少空间（这里行顶只剩 ~98px）：可用高度按
    // 「行顶到视口顶」实算，浮层宁可只剩一条（内部滚动）也不越过视口顶部。
    // 留最小高度兜底的话浮层会顶出去一截——那截用户连滚都滚不到。
    await openPopover(webviewPage, 140);
    const { row, pop } = await measure(webviewPage);
    expect(pop.y).toBeGreaterThanOrEqual(0);
    expect(pop.y + pop.height).toBeLessThanOrEqual(row.y + 1.5);
  });
});
