import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";

const DIR = "/Users/dev/projects/wave-agent";

const band = {
  modId: "todo:band",
  plugin: "todo",
  revision: 1,
  tree: { type: "Text", props: {}, children: ["还剩 3 项待办"] },
};

/**
 * 带 / 状态行与输入卡**左右对齐**，提示则是右下角浮层（spec
 * `ecosystem/plugin-mods.md`「状态带、状态行与提示」）。
 *
 * 带与状态行是 `.input-area-container` 的直接子元素，而输入卡自己收在
 * `.input-wrapper` 里（插件端 800 / 桌面 768，`margin: auto` 居中）。第一版漏了
 * 这一层：1180 宽的桌面窗口里，带的两端比输入卡各宽出 61px，状态行文字也落到
 * 卡的左缘之外 —— jsdom 没有布局，只有真 Chromium 能量出来，所以这条断言在这里。
 */
test.describe("Desktop mod composer slot alignment", () => {
  test("带与状态行的左右缘与输入卡重合；提示固定在右下角", async ({
    webviewPage: page,
  }) => {
    const injector = new MessageInjector(page);
    await page.setViewportSize({ width: 1180, height: 760 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR,
      recentWorkdirs: [DIR],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [
        MockDataGenerator.createUserMessage("把还剩几项待办放到输入框上面"),
        MockDataGenerator.createAssistantMessage("已经接到 AbovePrompt 站点。"),
      ],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
    });
    await injector.endStreaming();
    await expect(page.getByTestId("message-input")).toBeVisible();

    await injector.simulateExtensionMessage("desktopModBand", {
      bands: [band],
    });
    await injector.simulateExtensionMessage("desktopModStatus", {
      payload: { modId: "todo:status", plugin: "todo", text: "监听中" },
    });
    await injector.simulateExtensionMessage("desktopModToast", {
      payload: {
        modId: "todo:band",
        plugin: "todo",
        text: "已勾掉一项",
        timeoutMs: 60_000,
      },
    });
    await expect(page.getByTestId("mod-band")).toBeVisible();
    await expect(page.getByTestId("mod-toast")).toBeVisible();

    const card = await page.locator(".input-content").boundingBox();
    const bandBox = await page.getByTestId("mod-band").boundingBox();
    const statusBox = await page.getByTestId("mod-status").boundingBox();
    const toastBox = await page.getByTestId("mod-toast").boundingBox();
    expect(card && bandBox && statusBox && toastBox).toBeTruthy();
    if (!card || !bandBox || !statusBox || !toastBox) return;

    // 亚像素级容差：CSS 的居中可能落在半个像素上。
    for (const [name, box] of [
      ["band", bandBox],
      ["status", statusBox],
    ] as const) {
      expect(
        Math.abs(box.x - card.x),
        `${name} 左缘 ${box.x} vs 输入卡 ${card.x}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(box.x + box.width - (card.x + card.width)),
        `${name} 右缘 ${box.x + box.width} vs 输入卡 ${card.x + card.width}`,
      ).toBeLessThanOrEqual(1);
    }

    // 带在卡上方、状态行在卡下方（两处站点没有互换）。带的**外框**会比内容多
    // 出 10px 的滚动内衬（见 `.mod-band` 的 padding-block），所以拿最后一条的
    // 下缘比，而不是容器边框。
    const lastItemBottom = await page.evaluate(() => {
      const items = document.querySelectorAll(".mod-band-item");
      const last = items[items.length - 1];
      return last ? last.getBoundingClientRect().bottom : null;
    });
    expect(lastItemBottom).not.toBeNull();
    expect(lastItemBottom as number).toBeLessThanOrEqual(card.y);
    expect(statusBox.y).toBeGreaterThanOrEqual(card.y + card.height);

    // 提示不在这条对齐轴上：它是固定右下角浮层（CC 的 cds Toast 口径），
    // 刻意不受输入卡宽度约束 —— 宽度对齐的断言不该把它算进来。
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    if (!viewport) return;
    expect(toastBox.width).toBeLessThan(card.width);
    expect(
      Math.abs(toastBox.x + toastBox.width - (viewport.width - 16)),
      `浮层右缘 ${toastBox.x + toastBox.width} vs 视口 ${viewport.width - 16}`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(toastBox.y + toastBox.height - (viewport.height - 16)),
      `浮层下缘 ${toastBox.y + toastBox.height} vs 视口 ${viewport.height - 16}`,
    ).toBeLessThanOrEqual(1);

    // 失败态走同一条渲染路径（错误摘要盖在上一帧的树上），宽度约束不能只挂在
    // 「这一帧渲染成功」那半边 —— 曾经有一版截图里错误态的带比卡宽出一截。
    await injector.simulateExtensionMessage("desktopModBand", {
      bands: [
        {
          modId: "todo:band",
          plugin: "todo",
          revision: 2,
          tree: band.tree,
          error:
            "ui.render 失败：TypeError: Cannot read properties of undefined",
        },
      ],
    });
    await expect(page.locator(".mod-panel-error")).toBeVisible();
    const errorBandBox = await page.getByTestId("mod-band").boundingBox();
    expect(errorBandBox).toBeTruthy();
    if (!errorBandBox) return;
    expect(
      Math.abs(errorBandBox.x - card.x),
      `错误态带左缘 ${errorBandBox.x} vs 输入卡 ${card.x}`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(errorBandBox.x + errorBandBox.width - (card.x + card.width)),
      `错误态带右缘 ${errorBandBox.x + errorBandBox.width} vs 输入卡 ${card.x + card.width}`,
    ).toBeLessThanOrEqual(1);
  });
});
