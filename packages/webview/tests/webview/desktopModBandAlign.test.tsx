/**
 * 桌面端带 / 状态行与输入卡**左右对齐**，提示则是右下角浮层（spec
 * `ecosystem/plugin-mods.md`「状态带、状态行与提示」）。
 *
 * 迁移自 `e2e/desktop-mod-band-align.e2e.ts`。带与状态行是 `.input-area-container`
 * 的直接子元素，而输入卡自己收在 `.input-wrapper` 里（插件端 800 / 桌面 768，
 * `margin: auto` 居中）。第一版漏了这一层：1180 宽的桌面窗口里，带的两端比输入卡
 * 各宽出 61px，状态行文字也落到卡的左缘之外 —— jsdom 没有布局，只有真浏览器能量
 * 出来，所以这条断言在这里。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page } from "vitest/browser";
import { MockDataGenerator } from "../fixtures/mockData";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR = "/Users/dev/projects/wave-agent";

const band = {
  modId: "todo:band",
  plugin: "todo",
  revision: 1,
  tree: { type: "Text", props: {}, children: ["还剩 3 项待办"] },
};

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 视口坐标下的外框（与 Playwright 的 `boundingBox()` 同一坐标系，不做取整）。 */
const box = (selector: string): DOMRect | null => {
  const el = document.querySelector<HTMLElement>(selector);
  return el ? el.getBoundingClientRect() : null;
};

describe("Desktop mod composer slot alignment", () => {
  it("带与状态行的左右缘与输入卡重合；提示固定在右下角", async () => {
    await page.viewport(1180, 760);

    renderDesktopApp();
    bootDesktop({ workdir: DIR });
    sendCommand("updateMessages", {
      messages: [
        MockDataGenerator.createUserMessage("把还剩几项待办放到输入框上面"),
        MockDataGenerator.createAssistantMessage("已经接到 AbovePrompt 站点。"),
      ],
    });
    expect(isVisible('[data-testid="message-input"]')).toBe(true);

    sendCommand("desktopModBand", { bands: [band] });
    sendCommand("desktopModStatus", {
      payload: { modId: "todo:status", plugin: "todo", text: "监听中" },
    });
    sendCommand("desktopModToast", {
      payload: {
        modId: "todo:band",
        plugin: "todo",
        text: "已勾掉一项",
        timeoutMs: 60_000,
      },
    });
    await expect.poll(() => isVisible('[data-testid="mod-band"]')).toBe(true);
    await expect.poll(() => isVisible('[data-testid="mod-toast"]')).toBe(true);

    const card = box(".input-content");
    const bandBox = box('[data-testid="mod-band"]');
    const statusBox = box('[data-testid="mod-status"]');
    const toastBox = box('[data-testid="mod-toast"]');
    expect(card && bandBox && statusBox && toastBox).toBeTruthy();
    if (!card || !bandBox || !statusBox || !toastBox) return;

    // 亚像素级容差：CSS 的居中可能落在半个像素上。
    for (const [name, slot] of [
      ["band", bandBox],
      ["status", statusBox],
    ] as const) {
      expect(
        Math.abs(slot.x - card.x),
        `${name} 左缘 ${slot.x} vs 输入卡 ${card.x}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(slot.x + slot.width - (card.x + card.width)),
        `${name} 右缘 ${slot.x + slot.width} vs 输入卡 ${card.x + card.width}`,
      ).toBeLessThanOrEqual(1);
    }

    // 带在卡上方、状态行在卡下方（两处站点没有互换）。带的**外框**会比内容多
    // 出 10px 的滚动内衬（见 `.mod-band` 的 padding-block），所以拿最后一条的
    // 下缘比，而不是容器边框。
    const items = document.querySelectorAll(".mod-band-item");
    const last = items[items.length - 1];
    const lastItemBottom = last ? last.getBoundingClientRect().bottom : null;
    expect(lastItemBottom).not.toBeNull();
    expect(lastItemBottom as number).toBeLessThanOrEqual(card.y);
    expect(statusBox.y).toBeGreaterThanOrEqual(card.y + card.height);

    // 提示不在这条对齐轴上：它是固定右下角浮层（CC 的 cds Toast 口径），
    // 刻意不受输入卡宽度约束 —— 宽度对齐的断言不该把它算进来。
    const viewport = { width: window.innerWidth, height: window.innerHeight };
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
    sendCommand("desktopModBand", {
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
    await expect.poll(() => isVisible(".mod-panel-error")).toBe(true);
    const errorBandBox = box('[data-testid="mod-band"]');
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
