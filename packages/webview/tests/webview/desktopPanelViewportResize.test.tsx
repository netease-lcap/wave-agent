/**
 * 桌面端「窗口变窄时对话列被压成 0」的回归（spec `desktop-right-panel.md` 场景 4）。
 *
 * 迁移自 `e2e/desktop-panel-viewport-resize.e2e.ts`。原文件说明的缺陷背景：面板槽位
 * 带着内联的绝对像素宽度 + `flex: 0 0 auto`，而 `.desktop-chat-main` 是
 * `min-width: 0`，ChatApp 又完全没监听 resize —— 于是窗口每少一个像素都从对话列里
 * 扣。现在的实现：行宽由 ResizeObserver + `window.resize` 双通道采集，面板宽度
 * 在渲染期派生（`clamp(记忆宽度, 202, 行宽 − 360)`），绝不写回会话记忆。
 *
 * 两个用例分别守：
 *  1. 视口逐级变窄（1600 = 出货默认窗宽，720 = Electron `minWidth`）时对话列保住
 *     360 下限、面板宽度始终等于派生值、文档不出现横向滚动、行装不下两列下限时
 *     槽位右缘被裁切而左缘的分隔条仍然可命中；
 *  2. 窗口缩放绝不把派生宽度写回记忆 —— 缩回去再放回来，用户拖出来的宽度要回来。
 *
 * 空 `messages` 让欢迎页那条分支留在屏上，它与会话页是同一条 DOM 路径
 * （`.chat-container--welcome` → `.desktop-chat-body`）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page } from "vitest/browser";
import { fireEvent, screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  twoFrames,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

/** 与 ChatApp.tsx 的 `CHAT_MAIN_MIN_WIDTH` / `PANEL_MIN_WIDTH` 同值。 */
const CHAT_MAIN_MIN_WIDTH = 360;
const PANEL_MIN_WIDTH = 202;

/** 1600 是出货默认窗宽；720 是 Electron 的 `minWidth`（packages/desktop/src/main/index.ts）。 */
const STAIR = [1600, 1400, 1200, 1000, 900, 800, 720];

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 单分屏 + 展开面板 + 开一个差异面板（原用例的 setup，视口 1600×800）。 */
async function setupSinglePane() {
  const result = renderDesktopApp();
  bootDesktop({ workdir: DIR_A });
  sendCommand("desktopPanes", {
    panes: [{ paneId: "pane-1", sessionId: "sess-vr-1" }],
    focusedPaneId: "pane-1",
  });
  fireEvent.click(screen.getByTestId("panel-toggle-btn"));
  fireEvent.click(screen.getByTestId("panel-empty-item-diff"));
  await expect
    .poll(() => isVisible('[data-testid="desktop-panel-slot"]'))
    .toBe(true);
  return result;
}

interface Metrics {
  /** `.chat-container` —— ChatApp 的 ResizeObserver 量的就是它（派生宽度的输入）。 */
  containerW: number;
  /** 装对话列 + 面板槽位的那一行。 */
  rowW: number;
  rowRight: number;
  /** `.desktop-chat-main` —— 对话列。 */
  chatW: number;
  /** `.desktop-panel-slot` 的 border-box 宽度（inline width = 生效宽度）。 */
  panelW: number;
  panelRight: number;
  /** 分隔条中心点是否真的命得中。 */
  handleHit: boolean;
  docScrollWidth: number;
  docClientWidth: number;
}

/**
 * 量一次布局（原用例走 `page.evaluate`，这里同一个 JS 环境，直接读 DOM）。
 *
 * 桌面端把「面板宽度 = 派生值」做成了渲染期计算，所以量之前先让 ResizeObserver
 * 与那一帧重渲染落地：调用方在每次 `page.viewport(...)` 之后 `await twoFrames()`。
 */
const measure = (): Metrics => {
  const container = document.querySelector<HTMLElement>(".chat-container");
  const row = document.querySelector<HTMLElement>(".desktop-chat-body");
  const chat = document.querySelector<HTMLElement>(".desktop-chat-main");
  const slot = document.querySelector<HTMLElement>(
    '[data-testid="desktop-panel-slot"]',
  );
  const handle = document.querySelector<HTMLElement>(
    '[data-testid="panel-slot-drag-handle"]',
  );
  if (!container || !row || !chat || !slot || !handle) {
    throw new Error("desktop chat row / chat column / panel slot not mounted");
  }
  const cr = container.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const sr = slot.getBoundingClientRect();
  const hr = handle.getBoundingClientRect();
  const hit = document.elementFromPoint(
    hr.x + hr.width / 2,
    hr.y + hr.height / 2,
  );
  return {
    containerW: cr.width,
    rowW: rr.width,
    rowRight: rr.right,
    chatW: chat.clientWidth,
    panelW: sr.width,
    panelRight: sr.right,
    handleHit: hit !== null && (hit === handle || handle.contains(hit)),
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
  };
};

/** `clamp(memory, PANEL_MIN_WIDTH, max(PANEL_MIN_WIDTH, row − CHAT_MAIN_MIN_WIDTH))` */
const effectivePanelWidth = (rowW: number, memory: number): number =>
  Math.max(
    PANEL_MIN_WIDTH,
    Math.min(memory, Math.max(PANEL_MIN_WIDTH, rowW - CHAT_MAIN_MIN_WIDTH)),
  );

const near = (got: number, want: number, tol = 2) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

/**
 * 按住分隔条拖 dx 像素后松开（左负 = 变宽，正 = 变窄）。
 *
 * 派发形态与理由见 `desktopPanelDragResize.test.tsx` 的 `startDrag`：browser mode
 * 没有任意坐标的 mouse.down/move/up，而产品的拖拽监听挂在 `window` 上，因此
 * `mousedown` 落在分隔条（组件只读槽位矩形）、`mousemove`/`mouseup` 派发给
 * `window`，`clientX` 决定宽度 = 槽位右缘 − 指针 x。
 */
function dragHandle(dx: number) {
  const handle = document.querySelector<HTMLElement>(
    '[data-testid="panel-slot-drag-handle"]',
  )!;
  const box = handle.getBoundingClientRect();
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width / 2;
  fireEvent.mouseDown(handle, { clientX: x0, clientY: y });
  for (let i = 1; i <= 24; i++) {
    fireEvent.mouseMove(window, { clientX: x0 + (dx * i) / 24, clientY: y });
  }
  fireEvent.mouseUp(window, { clientX: x0 + dx, clientY: y });
}

describe("Desktop panel vs conversation column on window resize", () => {
  it("viewport stair: conversation column holds 360, panel derives from the row, nothing overflows", async () => {
    await page.viewport(1600, 800);
    await setupSinglePane();

    const wide = measure();
    // 从没拖过的槽位是活的 40/60 分栏；这个值就是整段阶梯里「记忆宽度」——
    // 窗口缩放不得改写它。
    const memory = wide.panelW;
    near(wide.panelW, effectivePanelWidth(wide.containerW, memory), 4);

    const table: Metrics[] = [];
    for (const viewport of STAIR) {
      await page.viewport(viewport, 800);
      // 让 ResizeObserver + 派生宽度的重渲染落地，再量。
      await twoFrames();
      table.push(measure());
    }

    for (const [index, m] of table.entries()) {
      const label = `viewport ${STAIR[index]}px`;
      // 1. 对话列守住下限 —— 像素取整下会出现 359.x。
      expect(m.chatW, `${label}: chat column`).toBeGreaterThanOrEqual(
        CHAT_MAIN_MIN_WIDTH - 4,
      );
      // 2. 文档没有横向滚动。
      expect(m.docScrollWidth, `${label}: document scrollWidth`).toBe(
        m.docClientWidth,
      );
      // 3. 面板是派生宽度，不是记忆里的陈旧像素值。
      near(m.panelW, effectivePanelWidth(m.containerW, memory), 3);

      // 4. 行宽装不下两列下限时，面板右缘被裁切（不是被挤成一条缝），而它左缘
      //    的分隔条仍然命得中 —— 否则窄窗口下根本够不到面板。
      if (m.panelRight > m.rowRight + 1) {
        expect(m.handleHit, `${label}: divider handle hittable`).toBe(true);
      }
    }

    // 最窄那一级必须真的踩到裁切分支，否则上面那条断言就是空转。
    const narrow = table[table.length - 1];
    expect(narrow.panelRight).toBeGreaterThan(narrow.rowRight + 1);
    near(narrow.panelW, PANEL_MIN_WIDTH, 3);
  });

  it("window resize never writes the derived width back into the session memory", async () => {
    await page.viewport(1600, 800);
    await setupSinglePane();

    // 把面板拖到行宽允许的最宽（夹在 行宽 − 360）。
    dragHandle(-2000);
    const widest = measure();
    near(widest.panelW, widest.rowW - CHAT_MAIN_MIN_WIDTH, 4);

    // 缩小窗口：面板缩到派生宽度，对话列守住 360。
    // 轮询派生宽度本身 —— 对话列在 resize 后第一帧就已经贴在 CSS 下限上，轮询
    // chatW 会在 ResizeObserver 送来新行宽之前就返回。
    await page.viewport(1000, 800);
    await expect
      .poll(() => {
        const m = measure();
        return Math.abs(
          m.panelW - effectivePanelWidth(m.containerW, widest.panelW),
        );
      })
      .toBeLessThanOrEqual(3);
    const shrunk = measure();
    expect(shrunk.chatW).toBeGreaterThanOrEqual(CHAT_MAIN_MIN_WIDTH - 4);
    expect(shrunk.panelW).toBeLessThan(widest.panelW - 100);

    // 放大回去：用户拖出来的宽度回来。如果 resize 时做了 `setPanelWidth(钳制值)`，
    // 这里就会被冻在缩小时的那一档。
    await page.viewport(1600, 800);
    await expect
      .poll(() => measure().panelW)
      .toBeGreaterThan(shrunk.panelW + 100);
    const restored = measure();
    near(restored.panelW, widest.panelW, 3);

    // 从区间底部再走一遍：窄窗口把面板压到下限，放大回去仍然恢复拖出来的宽度。
    await page.viewport(720, 800);
    await expect
      .poll(() => measure().panelW)
      .toBeLessThanOrEqual(PANEL_MIN_WIDTH + 3);
    near(measure().panelW, PANEL_MIN_WIDTH, 3);
    await page.viewport(1600, 800);
    await expect
      .poll(() => measure().panelW)
      .toBeGreaterThan(PANEL_MIN_WIDTH + 100);
    near(measure().panelW, widest.panelW, 3);
    // 对话列没有为这一切买过单。
    expect(measure().chatW).toBeGreaterThanOrEqual(CHAT_MAIN_MIN_WIDTH - 4);
  });
});
