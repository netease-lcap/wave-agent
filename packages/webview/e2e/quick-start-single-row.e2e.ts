import { expect, test } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Page } from "@playwright/test";

/**
 * 空态「快捷方式」区的单行横滚（spec ui/prompt-templates.md 场景 9 + 边界情况
 * 「窗口装不下怎么排？」）。
 *
 * 这块排布原本只给桌面端（设计师 2026-11-16），插件端与远控页是两行换行；2026-12
 * 用户要求三端统一成「一行 + 两侧渐隐」。换行与否、蒙层有没有显形都只有真浏览器
 * 算得出来（jsdom 不解析样式表），所以口径钉在这里：
 *
 * - 一级 12 个分类挤在一条线上（所有胶囊同一个 top），行高 = 一颗胶囊高；
 * - 装不下 ⇒ 真的可滚（scrollWidth > clientWidth），右侧有蒙层 + 右箭头，左侧什么都没有；
 * - 滚到最右 ⇒ 反过来（右侧干净、左侧出现），箭头点一下也能滚。
 */

/** 远控页要有会话才画空态（无会话时输入框禁用、快捷方式区整个不渲染）。 */
const SESSION = {
  id: "session-1",
  sessionType: "main",
  workdir: "/repo/app",
  firstMessage: "给登录页加个校验",
  createdAt: "2026-10-14T08:00:00Z",
  lastActiveAt: "2026-10-14T09:00:00Z",
  latestTotalTokens: 100,
};

async function bootEmptyChat(page: Page) {
  const injector = new MessageInjector(page);
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [SESSION],
    session: SESSION,
    permissionMode: "default",
  });
  await expect(page.getByTestId("quick-start")).toBeVisible();
}

/** 一行排布的四个数：换行模式、行高、胶囊高、所有胶囊的 top 集合。 */
function rowMetrics(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector(".quick-start-row") as HTMLElement;
    const pills = Array.from(
      row.querySelectorAll(".quick-start-cat"),
    ) as HTMLElement[];
    const tops = Array.from(
      new Set(
        pills.map((pill) => Math.round(pill.getBoundingClientRect().top)),
      ),
    );
    return {
      flexWrap: getComputedStyle(row).flexWrap,
      rowHeight: Math.round(row.getBoundingClientRect().height),
      pillHeight: Math.round(pills[0].getBoundingClientRect().height),
      tops,
      scrollWidth: row.scrollWidth,
      clientWidth: row.clientWidth,
    };
  });
}

/** 两侧蒙层的实际不透明度（显形判据是 `.is-visible`，这里量算出来的效果）。 */
async function fades(page: Page) {
  const opacity = async (side: "start" | "end") =>
    page
      .locator(`.quick-start-fade--${side}`)
      .evaluate((el) => getComputedStyle(el).opacity);
  return { start: await opacity("start"), end: await opacity("end") };
}

/**
 * 蒙层的显隐带 120ms 过渡（`transition: opacity`），刚挂上 `.is-visible` 那一刻
 * 量到的是中间值 —— 等它到位，别对着过渡帧断言。
 */
async function expectFades(
  page: Page,
  expected: { start: string; end: string },
) {
  await expect.poll(() => fades(page)).toEqual(expected);
}

async function expectSingleRow(page: Page) {
  const metrics = await rowMetrics(page);
  expect(metrics.flexWrap).toBe("nowrap");
  // 12 个分类在同一条线上：出现第二个 top 就是换行了。
  expect(metrics.tops).toHaveLength(1);
  // 行高不超过一颗胶囊（换行的话这里会是两颗 + gap）。
  expect(metrics.rowHeight).toBeLessThanOrEqual(metrics.pillHeight + 2);
  // 800px 列里 12 个分类确实装不下 —— 下面那些蒙层/箭头才有意义。
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
}

test.describe("插件端（VS Code / JetBrains）", () => {
  test("12 个分类排成一行，右侧渐隐 + 右箭头，滚到最右就翻过来", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 900, height: 700 });
    await bootEmptyChat(webviewPage);

    await expectSingleRow(webviewPage);
    await expect(
      webviewPage.getByTestId("quick-start-arrow-next"),
    ).toBeVisible();
    await expect(webviewPage.getByTestId("quick-start-arrow-prev")).toHaveCount(
      0,
    );
    await expectFades(webviewPage, { start: "0", end: "1" });

    // 点右箭头真的滚了一屏（不是只有个长得像按钮的装饰）。
    const before = await webviewPage.evaluate(
      () =>
        (document.querySelector(".quick-start-row") as HTMLElement).scrollLeft,
    );
    await webviewPage.getByTestId("quick-start-arrow-next").click();
    await expect
      .poll(() =>
        webviewPage.evaluate(
          () =>
            (document.querySelector(".quick-start-row") as HTMLElement)
              .scrollLeft,
        ),
      )
      .toBeGreaterThan(before);

    // 滚到最右：右侧的蒙层与箭头让位给左侧。
    await webviewPage.evaluate(() => {
      const row = document.querySelector(".quick-start-row") as HTMLElement;
      row.scrollLeft = row.scrollWidth;
    });
    await expect(
      webviewPage.getByTestId("quick-start-arrow-prev"),
    ).toBeVisible();
    await expect(webviewPage.getByTestId("quick-start-arrow-next")).toHaveCount(
      0,
    );
    await expectFades(webviewPage, { start: "1", end: "0" });
  });

  test("切到二级时高度不变（同为一行），分隔线不被压没", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 900, height: 700 });
    await bootEmptyChat(webviewPage);
    const levelOne = await rowMetrics(webviewPage);

    await webviewPage.getByTestId("quick-start-cat-feature-dev").click();

    const levelTwo = await webviewPage.evaluate(() => {
      const row = document.querySelector(".quick-start-row") as HTMLElement;
      return {
        flexWrap: getComputedStyle(row).flexWrap,
        rowHeight: Math.round(row.getBoundingClientRect().height),
        // 「界面过窄时返回与选项之间的分割线就不见了」——flex 行里它是唯一还会
        // 被压成 0 的那一个，这里量实宽。
        dividerWidth: Math.round(
          (
            row.querySelector(".quick-start-divider") as HTMLElement
          ).getBoundingClientRect().width,
        ),
      };
    });
    expect(levelTwo.flexWrap).toBe("nowrap");
    // 场景 7：层级间切换高度不变、下方输入卡不位移。
    expect(levelTwo.rowHeight).toBe(levelOne.rowHeight);
    expect(levelTwo.dividerWidth).toBe(1);
  });
});

test.describe("远控页（手机）", () => {
  test.use({ remotePage: true, viewport: { width: 390, height: 844 } });

  test("一行横滚 + 右侧渐隐，与插件端同一套", async ({ webviewPage }) => {
    await bootEmptyChat(webviewPage);

    await expectSingleRow(webviewPage);
    await expect(
      webviewPage.getByTestId("quick-start-arrow-next"),
    ).toBeVisible();
    await expect.poll(async () => (await fades(webviewPage)).end).toBe("1");
  });
});
