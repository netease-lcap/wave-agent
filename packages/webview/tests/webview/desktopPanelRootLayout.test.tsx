/**
 * 桌面端面板分隔条拖拽的宽度夹持（单分屏启动态）。
 *
 * 迁移自 `e2e/desktop-panel-root-layout.e2e.ts`。原文的回归背景：旧的 ROOT 布局
 * （`.desktop-layout > .chat-container` 直接是 flex 子项）没有 `min-width: 0`，
 * 对话列内容的 min-content（chat main + 定宽面板槽位）把容器自己撑宽 —— 夹持用的
 * `containerW - 360` 上限跟着每次拖拽一起长，面板越拖越宽、右缘跑出窗口。那条
 * CSS 路径已经不存在：pane 布局在 desktopReady 时就推下来（spec
 * `desktop-split-pane.md`「启动即单个分屏」），欢迎页/空对话住在唯一那个 pane 里，
 * 它的 chat 容器带 `.desktop-pane .chat-container { min-width: 0 }`。
 *
 * 这条用例为「启动即单分屏」钉同一份契约：把分隔条拖到远超对话列下限的位置，
 * 槽位被夹住，而不是把容器撑宽。
 *
 * 拖拽的派发形态与理由见 `desktopPanelDragResize.test.tsx` 的 `startDrag`：
 * browser mode 里没有任意坐标的 `mouse.down/move/up`，而产品的拖拽监听挂在
 * `window` 上，所以 `mousedown` 落在分隔条（组件只读槽位矩形）、随后的
 * `mousemove`（按 `steps` 插值）/ `mouseup` 派发给 `window`，`clientX` 决定宽度。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { fireEvent, screen } from "@testing-library/react";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";
/** 与 ChatApp.tsx 的 `CHAT_MAIN_MIN_WIDTH` 同值（夹持上限 = 容器宽 − 它）。 */
const CHAT_MAIN_MIN_WIDTH = 360;

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

const q = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

/** 起单分屏（工作目录 → 初值）；pane 由宿主应答 desktopReady 时推下来。 */
async function setupSinglePane() {
  const result = renderDesktopApp();
  bootDesktop({ workdir: DIR_A });
  // 宿主应答 desktopReady 时推的就是这一个未绑定会话的分屏，欢迎页住在里面。
  await expect
    .poll(() => isVisible('[data-testid="desktop-pane-pane-1"]'))
    .toBe(true);
  return result;
}

interface Box {
  x: number;
  w: number;
  right: number;
}

/** 量「对话列 + 面板槽位」那一组的几何（原文的 `geometry()`）。 */
function geometry() {
  const box = (el: Element | null): Box | null => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, w: b.width, right: b.right };
  };
  const pane = document.querySelector(".desktop-pane");
  return {
    chat: box(pane?.querySelector(".chat-container") ?? null),
    main: box(document.querySelector(".desktop-chat-main")),
    slot: box(document.querySelector(".desktop-panel-slot")),
  };
}

/** 按住分隔条把指针移 dx 像素（正 = 往右 = 面板变窄），分 24 步后松开。 */
function dragWide(dx: number) {
  const handle = q('[data-testid="panel-slot-drag-handle"]');
  const h = handle.getBoundingClientRect();
  const y = h.y + h.height / 2;
  const x0 = h.x + h.width / 2;
  fireEvent.mouseDown(handle, { clientX: x0, clientY: y });
  for (let i = 1; i <= 24; i++) {
    fireEvent.mouseMove(window, { clientX: x0 + (dx * i) / 24, clientY: y });
  }
  fireEvent.mouseUp(window, { clientX: x0 + dx, clientY: y });
}

describe("startup single pane layout", () => {
  it("startup single pane: divider cannot widen the panel past the conversation minimum", async () => {
    await page.viewport(1280, 720);
    await setupSinglePane();

    // 空态打开右侧面板（没有标签）—— 反馈者用的就是空态：它的占位内容决定槽位的
    // min-content。
    await userEvent.click(screen.getByTestId("panel-toggle-btn"));
    await expect
      .poll(() => isVisible('[data-testid="desktop-panel-slot"]'))
      .toBe(true);
    await expect
      .poll(() => isVisible('[data-testid="panel-empty-state"]'))
      .toBe(true);

    const before = geometry();
    expect(before.chat!.w).toBeGreaterThan(0);
    // 欢迎页/空对话就渲染在启动时那一个分屏里。
    expect(document.querySelectorAll(".desktop-pane").length).toBe(1);

    // 先往窄拖（留出再往宽拖的余量），然后试着往宽拖到远超对话列下限：修复前
    // 这一步会把 chat 容器自己撑宽、槽位右缘跑出窗口。
    //
    // 复现真机 Electron 的失败条件：用户会话里欢迎列的 min-content（约 497px 的
    // 输入区）压不下去，于是 `.desktop-chat-body` 的 min-content（main + 定宽槽位）
    // 超过容器宽度，在没有 pane 的 `min-width: 0` 时每次拖拽都把 chat 容器撑宽。
    // 无头 Chromium 的 composer min-content 更小、永远不溢出，所以这里按原用例的
    // 做法给 chat main 钉一个内联 min-width 造出同样的条件。
    q(".desktop-chat-main").style.minWidth = "500px";
    dragWide(500);
    const narrowed = geometry();
    expect(narrowed.slot!.w).toBeLessThan(before.slot!.w - 100);

    // 连拖两次「往宽拖过上限」：修复前每一次拖拽都反馈进 chat 容器自己的宽度
    // （min-width:auto），夹持上限 `containerW - 360` 跟着面板一起长，槽位无限变宽。
    // 修复后容器纹丝不动，第一次拖拽把槽位夹到上限，第二次不许再变宽。
    dragWide(-3000);
    const after = geometry();

    dragWide(-3000);
    const after2 = geometry();

    // 1. 对话列保住下限（夹持生效）。
    expect(after.main!.w).toBeGreaterThanOrEqual(356);
    // 2. chat 容器没有被撑宽（没有容器反馈回路）。
    expect(Math.abs(after.chat!.w - before.chat!.w)).toBeLessThanOrEqual(3);
    // 3. 第二次拖拽不再加宽槽位（夹持生效、没有正反馈），面板停在上限 ≈ chat − 360。
    expect(after2.slot!.w).toBeLessThanOrEqual(after.slot!.w + 1);
    expect(
      Math.abs(after2.slot!.w - (after2.chat!.w - CHAT_MAIN_MIN_WIDTH)),
    ).toBeLessThanOrEqual(6);
    expect(Math.abs(after2.chat!.w - before.chat!.w)).toBeLessThanOrEqual(3);
  });
});
