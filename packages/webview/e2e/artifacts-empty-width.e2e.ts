import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * 创作集（`.artifacts-content`）的宽度只该由父级决定，不该由「有没有列表」决定。
 *
 * 线上现象（设计师截图）：空态下整页内容列明显变窄、整体右移居中 ——「创作集」标题
 * 的左边距从 276 变成 375 左右，分类 tab 行、搜索框跟着一起收。根因是内容列靠
 * `margin-inline: auto` 居中，而**交叉轴上的 auto margin 会让这条 flex 子项不再吃
 * 父级的 `align-items: stretch`**（CSS Flexbox §8.1/§9.5），宽度退化成 fit-content：
 * 有列表时被宽表格撑满，表格不渲染（空态 / 加载 / 出错 / 未登录）时就只剩页头那行
 * 文字的宽度。修法是给内容列一个确定的 `width: 100%`（宽于 1280 时仍由 max-width
 * 截断、由 auto margin 居中）。
 *
 * jsdom 量不出几何（内存里没有布局），所以这条回归落在真 Chromium 里：同一窗口下
 * 「有列表」与「空态」的内容列 / 页头 / tab 行必须逐像素同框。两种窗口宽度都测 ——
 * 窄于此前的 1280 上限（按父级铺满）与宽于它（被 max-width 截断并居中）。
 */

const DIR_A = "/Users/dev/projects/wave-agent";

const rectOf = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: Math.round(rect.x), width: Math.round(rect.width) };
  }, selector);

async function openArtifacts(page: Page, width: number) {
  const injector = new MessageInjector(page);
  await page.setViewportSize({ width, height: 900 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated: true,
    permissionMode: "default",
  });
  await page.getByTestId("desktop-artifacts").click();
  await expect(page.getByTestId("artifacts-page")).toBeVisible();
  return injector;
}

/** 答掉页面的列表 / 分类两个请求（requestId 取自页面刚发出的那两条）。 */
async function replyList(
  page: Page,
  injector: MessageInjector,
  items: Record<string, unknown>[],
) {
  const sent = await page.evaluate(() => window.getTestMessages());
  const lastOf = (command: string) =>
    [...sent].reverse().find((m) => m.command === command);
  const categoryRequest = lastOf("desktopArtifactCategoriesGet");
  if (categoryRequest) {
    await injector.simulateExtensionMessage("desktopArtifactCategories", {
      requestId: categoryRequest.requestId,
      categories: [],
      assignments: {},
    });
  }
  await injector.simulateExtensionMessage("desktopArtifactsList", {
    requestId: lastOf("desktopArtifactsList")?.requestId,
    items,
  });
}

const oneItem = {
  slug: "account-card",
  title: "账户卡片",
  rel: "mine",
  ownerEmail: "me@corp.com",
  publishedAt: "2026-11-12T11:00:00.000Z",
  shareScope: "enterprise",
};

const layout = async (page: Page) => ({
  content: await rectOf(page, ".artifacts-content"),
  header: await rectOf(page, ".artifacts-page-header"),
  tabs: await rectOf(page, ".artifacts-tabs-row"),
});

for (const width of [1440, 1600]) {
  test(`空态与列表的内容列同宽同起点（窗口 ${width}）`, async ({
    webviewPage: page,
  }) => {
    const injector = await openArtifacts(page, width);

    await replyList(page, injector, []);
    await expect(page.getByTestId("artifacts-empty")).toBeVisible();
    const empty = await layout(page);

    await replyList(page, injector, [oneItem]);
    await expect(page.getByTestId("artifacts-table")).toBeVisible();
    const list = await layout(page);

    expect(empty).toEqual(list);
    // 内容列确实铺到了父级（窄窗口）或被 1280 截断（宽窗口），不是哪段文字的宽度。
    expect(empty.content?.width).toBeGreaterThan(800);
  });
}
