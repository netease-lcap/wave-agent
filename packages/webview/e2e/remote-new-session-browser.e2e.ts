import { expect, test } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Page } from "@playwright/test";

/**
 * 远控页「新建对话 → 浏览…」里那块目录浏览面板在真浏览器里的形态
 * （spec remote-web.md「Web 端也能发起新会话」场景 2）。
 *
 * 两件事 jsdom 判不了，只能在这里咬：
 *
 * 1. **面板是弹窗的一屏，不是下拉浮层**。它和桌面端远程主机共用同一个组件，
 *    而那边的样式是从触发按钮**向上展开的绝对定位弹层**（`bottom: 100%`）。
 *    照搬进弹窗的后果是弹窗本体塌成只剩标题与按钮的空壳、面板悬在弹窗外面
 *    ——2026-11-13 用户报「新对话浏览目录，没有关闭的入口」，看到的就是那一幕。
 * 2. **退路必须真的在视野里**。手机上没有 Esc，浏览态底部那枚「返回」是唯一
 *    出口（位置与按钮样式跟同族弹窗的「返回列表」一致）；而手机键盘弹出后可视区
 *    只剩半屏，`vh` 不跟着缩（iOS 上仍是整屏），弹窗会有一截落在可视区上方
 *    ——遮罩不能滚时那一截永远够不到（用户同一次报的「头部超出视野范围，
 *    也无法滚动」）。
 */

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  remotePage: true,
  userAgent: IPHONE_UA,
});

/** 顶栏「新建对话」→「浏览…」→ 一份目录回执，停在浏览器面板上。 */
async function openBrowser(page: Page) {
  await page.evaluate(() => {
    // harness 的外壳给 #root 钉了 100vh，真远控页没有这一条。
    (document.getElementById("root") as HTMLElement).style.height = "100%";
  });
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });

  await page.click('[data-testid="new-session-btn"]');
  await page.click('[data-testid="remote-new-session-browse"]');
  const requestId = await page.evaluate(() => {
    const msgs = window.getTestMessages();
    return [...msgs].reverse().find((m) => m.command === "newSessionListDirs")
      ?.requestId as string;
  });
  await injector.simulateExtensionMessage("newSessionDirs", {
    requestId,
    resolvedPath: "/home/alice",
    dirs: ["projects", "documents", "github", "tmp"],
  });
  await expect(
    page.locator('[data-testid="desktop-remote-browser"]'),
  ).toBeVisible();
}

test("目录面板落在新建对话弹窗里，不悬在弹窗外面", async ({ webviewPage }) => {
  await openBrowser(webviewPage);

  const dialog = await webviewPage
    .locator('[data-testid="remote-new-session-dialog"]')
    .boundingBox();
  const browser = await webviewPage
    .locator('[data-testid="desktop-remote-browser"]')
    .boundingBox();
  expect(dialog).not.toBeNull();
  expect(browser).not.toBeNull();

  // 上下都在弹窗里：`bottom: 100%` 的下拉形态会让它的底边落在弹窗顶边之上。
  expect(browser!.y).toBeGreaterThanOrEqual(dialog!.y);
  expect(browser!.y + browser!.height).toBeLessThanOrEqual(
    dialog!.y + dialog!.height,
  );
  // 弹窗没有被面板顶塌：内容区还有高度，整个弹窗不是只剩标题与按钮的一条。
  const scrollArea = await webviewPage
    .locator(".configuration-fields-scroll-area")
    .boundingBox();
  expect(scrollArea!.height).toBeGreaterThan(0);
  expect(dialog!.height).toBeGreaterThan(200);
});

test("「返回」在面板自己那一行、紧挨「选择此目录」，点它退回「最近目录」那一屏", async ({
  webviewPage,
}) => {
  await openBrowser(webviewPage);

  const back = webviewPage.locator(
    '[data-testid="desktop-remote-browser-back"]',
  );
  await expect(back).toBeVisible();
  await expect(back).toHaveText("返回");

  // 退回去是**面板这一层**的动作，所以它跟「选择此目录」同一行、同尺寸，
  // 落在主操作右侧：同一层的次级动作，不抢主操作的注意力。
  const selectBox = await webviewPage
    .locator('[data-testid="desktop-remote-browser-select"]')
    .boundingBox();
  const backBox = await back.boundingBox();
  expect(backBox!.height).toBe(selectBox!.height);
  expect(backBox!.y).toBe(selectBox!.y);
  expect(backBox!.x).toBeGreaterThan(selectBox!.x);

  // 而弹窗级按钮条还是只有「创建」「取消」——两层动作不混。
  await expect(
    webviewPage.locator(".configuration-actions button"),
  ).toHaveCount(2);

  // 面板里一个档位：列表行与「选择此目录」同字号。只把按钮抬到 14px、列表
  // 留着 12px，看起来就像「选择按钮字号偏大」（2026-11-13 用户看截图后问的）。
  const fontSizeOf = (selector: string) =>
    webviewPage
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);
  expect(await fontSizeOf('[data-testid="desktop-remote-browser-item"]')).toBe(
    await fontSizeOf('[data-testid="desktop-remote-browser-select"]'),
  );

  await back.click();

  // 退路回到「最近目录 + 浏览…」那一屏，而不是把整个弹窗关掉。
  await expect(
    webviewPage.locator('[data-testid="desktop-remote-browser"]'),
  ).toHaveCount(0);
  await expect(
    webviewPage.locator('[data-testid="remote-new-session-dialog"]'),
  ).toBeVisible();
  await expect(
    webviewPage.locator('[data-testid="remote-new-session-browse"]'),
  ).toBeVisible();
  await expect(back).toHaveCount(0);
});

test("手机键盘把可视区压到半屏后，头部与底部按钮都还在视野里", async ({
  webviewPage,
}) => {
  await openBrowser(webviewPage);

  // 键盘弹出 ≈ 可视区变矮。真机上 `vh` 不跟着缩，弹窗照样按整屏算高度 ——
  // 这里量的就是随之而来的那件事：弹窗的两端还在不在可视区内。
  await webviewPage.setViewportSize({ width: 390, height: 420 });
  await webviewPage.waitForTimeout(100);

  const metrics = await webviewPage.evaluate(() => {
    const rect = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    return {
      viewportH: window.innerHeight,
      dialog: rect('[data-testid="remote-new-session-dialog"]'),
      crumbs: rect('[data-testid="desktop-remote-browser-crumbs"]'),
      footer: rect(".desktop-remote-browser-footer"),
      actions: rect(".configuration-actions"),
    };
  });

  expect(metrics.dialog).not.toBeNull();
  expect(metrics.crumbs).not.toBeNull();
  // 顶部（面包屑行）不能被推出视口，底部两行（面板自己的「选择此目录 + 返回」，
  // 以及弹窗的「创建 / 取消」）也不能被键盘挡住——两头同时可达，弹窗才算真的能用。
  expect(metrics.crumbs!.top).toBeGreaterThanOrEqual(0);
  expect(metrics.crumbs!.bottom).toBeLessThanOrEqual(metrics.viewportH);
  expect(metrics.footer!.bottom).toBeLessThanOrEqual(metrics.viewportH);
  expect(metrics.actions!.top).toBeGreaterThanOrEqual(0);
  expect(metrics.actions!.bottom).toBeLessThanOrEqual(metrics.viewportH);
});
