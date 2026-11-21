/**
 * 桌面端右侧面板分隔条拖拽（spec `desktop-right-panel.md`）。
 *
 * 迁移自 `e2e/desktop-panel-drag-resize.e2e.ts`。原文件说明的回归背景：PR #2083
 * 把拖拽把手从每个 pane 提到共享的 `.desktop-panel-slot` 上，而槽位的 CSS 当时
 * 没有 `position`，于是把手的绝对定位锚到了 `.desktop-chat-body`，画在整行的最左
 * 边（x≈257 而不是槽位所在的 x≈620）——悬停没高亮、光标不变、拖拽完全没反应。
 * jsdom 单测抓不到这类问题（它把 mousemove 直接派发给 window，量不到几何），所以
 * 这里跑在真 Chromium 上：把手盒子贴着槽位左缘、悬停光标是 `col-resize`、真拖一
 * 次宽度跟着变、拖到极限时夹在面板下限而不是塌掉。
 *
 * 拖拽的派发形态见 `startDrag` 的注释。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { fireEvent, screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";
/** 与 ChatApp.tsx 的 `PANEL_MIN_WIDTH` 同值（2026-10-30 设计评审后从 320 降到 202）。 */
const PANEL_MIN_WIDTH = 202;

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

const q = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const near = (got: number, want: number, tol: number) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

/** 槽位的 border-box 宽度（inline width = 生效宽度）。 */
const slotWidth = () =>
  q('[data-testid="desktop-panel-slot"]').getBoundingClientRect().width;

/** 单分屏 + 展开面板 + 开一个差异面板（原用例的 setup）。 */
async function setupSinglePane() {
  const result = renderDesktopApp();
  bootDesktop({ workdir: DIR_A });
  sendCommand("desktopPanes", {
    panes: [{ paneId: "pane-1", sessionId: "sess-dr-1" }],
    focusedPaneId: "pane-1",
  });
  fireEvent.click(screen.getByTestId("panel-toggle-btn"));
  fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
  await expect
    .poll(() => isVisible('[data-testid="desktop-panel-slot"]'))
    .toBe(true);
  return result;
}

/**
 * 按下分隔条，返回「把指针移到 x」「松开」两个动作。
 *
 * browser mode 里没有任意坐标的 `mouse.down/move/up`：`userEvent` 只能 hover /
 * click 到某颗元素上，表达不了「按住不放 → 指针移到别处 → 松开」。所以这里按浏览器
 * 的真实派发形态重放：`mousedown` 落在分隔条上（组件的 `onMouseDown` 只读
 * `panelSlotRef` 的矩形、用它算「槽位右缘 − 指针 x」，起手坐标本身不参与计算），
 * 随后的 `mousemove` / `mouseup` 派发给 `window` —— 产品的拖拽监听正是挂在
 * `window` 上的（`ChatApp.handleSlotResizeStart`），所以每一次 `mousemove` 都被
 * 真实读到，`clientX` 决定面板宽度。断言的是真几何：拖完量槽位盒子的宽度。
 */
function startDrag() {
  const handle = q('[data-testid="panel-slot-drag-handle"]');
  const box = handle.getBoundingClientRect();
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width / 2;
  fireEvent.mouseDown(handle, { clientX: x0, clientY: y });
  const moveTo = (x: number) =>
    fireEvent.mouseMove(window, { clientX: x, clientY: y });
  return {
    x0,
    /** 一次拖到位，中间按 `steps` 步插值（Playwright 的 `steps` 语义）。 */
    moveBy(dx: number, steps = 24) {
      for (let i = 1; i <= steps; i++) moveTo(x0 + (dx * i) / steps);
    },
    up() {
      fireEvent.mouseUp(window, { clientX: x0, clientY: y });
    },
  };
}

/** 按住分隔条拖 dx（左负 = 变宽，正 = 变窄）后松开。 */
function dragHandle(dx: number, steps = 24) {
  const drag = startDrag();
  drag.moveBy(dx, steps);
  drag.up();
}

describe("Desktop panel divider drag (real geometry)", () => {
  it("divider handle sits on the slot's left edge, shows col-resize, and drags live", async () => {
    await page.viewport(1280, 720);
    await setupSinglePane();

    const slot = q('[data-testid="desktop-panel-slot"]');
    const handle = q('[data-testid="panel-slot-drag-handle"]');
    expect(isVisible('[data-testid="panel-slot-drag-handle"]')).toBe(true);
    const slotBox = slot.getBoundingClientRect();
    const handleBox = handle.getBoundingClientRect();

    // 回归守卫：把手绝对定位在槽位左缘（left:-3px）并占满槽位高度 —— 不是整行
    // 对话区的最左边。
    near(handleBox.x, slotBox.x - 3, 2);
    near(handleBox.height, slotBox.height, 2);

    // 悬停可见反馈：分隔条上是 col-resize 光标（拖拽过程中也是）。
    await userEvent.hover(handle);
    expect(getComputedStyle(handle).cursor).toBe("col-resize");

    // 真按一次：按钮还按着的时候槽位就开始变窄。
    const S0 = slotBox.width;
    await userEvent.hover(handle);
    const drag = startDrag();
    expect(getComputedStyle(document.body).cursor).toBe("col-resize");
    drag.moveBy(90, 12); // 拖到一半，键还按着
    await expect.poll(slotWidth).toBeLessThanOrEqual(S0 - 80);
    near(slotWidth(), S0 - 90, 8);
    drag.moveBy(120, 6);
    drag.up();
    await expect.poll(slotWidth).toBeLessThanOrEqual(S0 - 110);
    near(slotWidth(), S0 - 120, 8);

    // 一路往右拖会夹在面板下限，而不是把面板拖没。
    dragHandle(2000);
    near(slotWidth(), PANEL_MIN_WIDTH, 4);
    expect(isVisible('[data-testid="desktop-panel-slot"]')).toBe(true);
    expect(isVisible('[data-testid="diff-pane"]')).toBe(true);
  });

  it("manual drag locks the width against auto-fill; collapse/expand remembers it", async () => {
    await page.viewport(1280, 720);
    await setupSinglePane();

    const S_auto = slotWidth();

    // 从没手动拖过：再开第二个 tab 仍然是自动 40/60，宽度不变。
    fireEvent.click(screen.getByTestId("panel-tabs-add"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-preview"));
    near(slotWidth(), S_auto, 3);

    // 手动拖一次：槽位变窄，并且从此锁定宽度。
    dragHandle(140);
    const S_manual = slotWidth();
    near(S_manual, S_auto - 140, 8);

    // 新 tab 不得把手动宽度重新自动铺满（再开一个预览 tab：setup 已经开了差异，
    // 除预览外的种类都是单实例，而且「＋」菜单不再列出已开的种类）。
    fireEvent.click(screen.getByTestId("panel-tabs-add"));
    fireEvent.click(screen.getByTestId("panel-toggle-item-preview"));
    await expect.poll(slotWidth).toBeLessThanOrEqual(S_manual + 3);
    near(slotWidth(), S_manual, 3);

    // 折叠 → 展开：手动宽度从分组缓存里回来。
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    await expect
      .poll(() => isVisible('[data-testid="desktop-panel-slot"]'))
      .toBe(false);
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    await expect
      .poll(() => isVisible('[data-testid="desktop-panel-slot"]'))
      .toBe(true);
    await expect.poll(slotWidth).toBeLessThanOrEqual(S_manual + 3);
    near(slotWidth(), S_manual, 3);
  });

  it("empty state (no tabs) keeps the divider draggable", async () => {
    await page.viewport(1280, 720);
    await setupSinglePane();

    const S0 = slotWidth();
    fireEvent.click(screen.getByTestId("panel-tab-close-diff-1"));

    // 关掉最后一个 tab 时槽位一起退场（spec「右侧面板」场景 10，不留空态残影）；
    // 用户要回到空态得自己再展一次面板。
    await expect
      .poll(() => isVisible('[data-testid="desktop-panel-slot"]'))
      .toBe(false);
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    await expect
      .poll(() => isVisible('[data-testid="panel-empty-state"]'))
      .toBe(true);
    // 分隔条照样贴槽位左缘，而且照样能拖。
    expect(isVisible('[data-testid="panel-slot-drag-handle"]')).toBe(true);
    const slotBox = q(
      '[data-testid="desktop-panel-slot"]',
    ).getBoundingClientRect();
    const handleBox = q(
      '[data-testid="panel-slot-drag-handle"]',
    ).getBoundingClientRect();
    near(handleBox.x, slotBox.x - 3, 2);

    // 自动铺满时宽度已经是上限，所以先往窄拖、再往宽拖（两个方向都动得了空态槽位）。
    dragHandle(90);
    near(slotWidth(), S0 - 90, 8);
    expect(isVisible('[data-testid="panel-empty-state"]')).toBe(true);

    dragHandle(-45);
    near(slotWidth(), S0 - 45, 8);
    expect(isVisible('[data-testid="desktop-panel-slot"]')).toBe(true);
  });

  it("empty-state entries collapse to one column on a narrow slot (CSS container query)", async () => {
    await page.viewport(1280, 720);
    await setupSinglePane();

    // 空态：关掉 setup 的差异 tab，整块槽位随之收起，于是再展开一次、不留 tab。
    fireEvent.click(screen.getByTestId("panel-tab-close-diff-1"));
    await expect
      .poll(() => isVisible('[data-testid="desktop-panel-slot"]'))
      .toBe(false);
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    await expect
      .poll(() => isVisible('[data-testid="panel-empty-state"]'))
      .toBe(true);

    // 空态入口在 DOM 里的顺序与位置。顺序镜像 `PANEL_ITEMS`
    // （PanelToggleMenu.tsx）—— 那边加一种面板时要同步这张表。
    const itemBoxes = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid^="panel-empty-item-"]',
        ),
      ).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          kind: (el.getAttribute("data-testid") ?? "").replace(
            "panel-empty-item-",
            "",
          ),
          x: r.x,
          y: r.y,
        };
      });

    // 拖到 202px 下限：入口排成单列，DOM 顺序不变。
    dragHandle(2000);
    await expect.poll(slotWidth).toBeLessThanOrEqual(206);
    near(slotWidth(), PANEL_MIN_WIDTH, 4);
    const narrow = itemBoxes();
    expect(narrow.map((b) => b.kind)).toEqual([
      "preview",
      "plan",
      "diff",
      "terminal",
      "file",
      "tasks",
    ]);
    for (let i = 1; i < narrow.length; i++) {
      near(narrow[i].x, narrow[0].x, 2);
      expect(narrow[i].y).toBeGreaterThan(narrow[i - 1].y);
    }

    // 再拖回自动铺满的宽度：两列网格回来了（预览/计划同一行，差异从下面那行的
    // 左列开始）。
    dragHandle(-2000);
    const wide = itemBoxes();
    const [preview, plan, diff] = wide;
    near(preview.y, plan.y, 2);
    expect(plan.x).toBeGreaterThan(preview.x + 50);
    near(diff.x, preview.x, 2);
    expect(diff.y).toBeGreaterThan(preview.y + 20);
  });
});
