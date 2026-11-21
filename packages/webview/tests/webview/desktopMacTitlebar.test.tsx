/**
 * macOS 隐藏标题栏（spec「macOS 隐藏标题栏」）。
 *
 * 迁移自 `e2e/desktop-mac-titlebar.e2e.ts`。main 进程仅在 darwin 隐藏系统标题栏，
 * webview 据此在侧边栏顶部渲染 44px 窗口行（侧边栏首行：系统红绿灯落位 + 右侧同排
 * 「收起侧边栏」按钮，整行是窗口拖拽区、按钮 no-drag 可点，**不画**假圆点），侧边
 * 栏收起时再在对话顶栏左端让出 ~76px 拖拽区。`-webkit-app-region` 真正的拖拽行为仍
 * 需 mac 实机确认，这里量的是 DOM 几何。
 *
 * 真机页面的这两个全局由 Electron preload 在 bundle 之前注入（`waveHostType` 决定
 * 挂 DesktopApp、`wavePlatform` 就是 `process.platform`），`isMacHiddenTitlebar()`
 * 要求两者同时成立。unit 测试不走那个入口，所以这里自己补上——必须在挂载**之前**
 * 就位，否则首次渲染走的是「非 desktop 宿主」的假圆点分支。依据见
 * `src/utils/platform.ts` 与 `src/components/DesktopSidebar.tsx` 的
 * `renderWindowRow`；`tests/webview/desktopPreview.test.tsx` 同样补 `waveHostType`。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR = "/work/a";

const SIDEBAR = '[data-testid="desktop-sidebar"]';
const DRAG_ROW = ".sidebar-window-row--mac-drag";
const COLLAPSE = '[data-testid="desktop-sidebar-collapse"]';
const TRAFFIC_SPACER = '[data-testid="chat-header-mac-traffic"]';

beforeEach(() => {
  // 侧栏收起态是 localStorage 持久化的（DesktopChromeContext），上一个用例收起的
  // 侧栏会带到下一个用例，量出来的就没有 44px 窗口行了。
  localStorage.clear();
  window.waveHostType = "desktop";
  window.wavePlatform = "darwin";
});

afterEach(() => {
  resetHostTier();
  resetPanelState();
  delete window.waveHostType;
  delete window.wavePlatform;
});

const q = (selector: string) => {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`no element for ${selector}`);
  return node;
};

const box = (node: Element) => node.getBoundingClientRect();

/** 起一个桌面分屏（`/work/a`），并推一次会话树——侧栏随之重渲染。 */
function bootDesktopWithSessionTree() {
  renderDesktopApp();
  sendCommand("desktopWorkdirState", {
    workdir: DIR,
    recentWorkdirs: [DIR],
  });
  sendCommand("desktopSessionTree", { groups: [] });
}

describe("macOS hidden titlebar", () => {
  it("侧边栏顶部渲染出 44px 拖拽行，装着收起按钮", async () => {
    await page.viewport(960, 640);
    bootDesktopWithSessionTree();

    await expect.poll(() => isVisible(SIDEBAR)).toBe(true);
    await expect.poll(() => isVisible(DRAG_ROW)).toBe(true);
    // 真红绿灯由系统画在这一行上，webview 不许再画一份自己的圆点（不重复）。
    expect(document.querySelectorAll(".window-dot").length).toBe(0);
    // 44px 行落在侧边栏最顶上 —— 它就是侧边栏自己的第一行内容：品牌行从它下沿开始。
    const rowBox = box(q(DRAG_ROW));
    expect(rowBox.height).toBeCloseTo(44, 0);
    expect(rowBox.y).toBeCloseTo(0, 0);
    const brandBox = box(q(".desktop-sidebar-header"));
    expect(brandBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 1);

    // 收起按钮坐在拖拽行里，让开给红绿灯留的位置（侧栏 12px + 行 padding-left
    // 68px → 按钮左缘 ≈ 80px），整颗落在 44px 行内，所以点得到（no-drag）。
    await expect.poll(() => isVisible(COLLAPSE)).toBe(true);
    const collapseBox = box(q(COLLAPSE));
    expect(collapseBox.x).toBeGreaterThanOrEqual(74);
    expect(collapseBox.x).toBeLessThanOrEqual(92);
    expect(collapseBox.y).toBeGreaterThanOrEqual(rowBox.y);
    expect(collapseBox.y).toBeLessThanOrEqual(
      rowBox.y + rowBox.height - collapseBox.height,
    );
  });

  it("侧边栏收起后，对话顶栏左端让出红绿灯区", async () => {
    await page.viewport(960, 640);
    bootDesktopWithSessionTree();

    // 进 mac 环境后走真的收起控件（它现在就挂在那条窗口行里），重渲染时才会走到
    // mac 的让位分支。
    await expect.poll(() => isVisible(COLLAPSE)).toBe(true);
    await userEvent.click(q(COLLAPSE));

    // 侧边栏整条消失，对话顶栏从窗口左缘开始。
    await expect.poll(() => document.querySelectorAll(SIDEBAR).length).toBe(0);
    await expect.poll(() => isVisible(TRAFFIC_SPACER)).toBe(true);
    const spacerBox = box(q(TRAFFIC_SPACER));
    // 窗口最顶上一条 ~76px 宽、整顶栏高的让位带（拖拽区）；对话顶栏自己有 12px
    // 左内衬，所以它的左缘落在 x≈12。
    expect(spacerBox.y).toBeCloseTo(0, 0);
    expect(spacerBox.x).toBeCloseTo(12, 0);
    expect(spacerBox.width).toBeGreaterThanOrEqual(74);
    // 整顶栏高的带：`.chat-header` 含 1px 下边框共 44px，被拉满的子项量出来是
    // 43px（content box）。42–44 都算对 —— 拖拽区只需盖住红绿灯，而红绿灯悬在
    // 顶栏上半部分。
    expect(spacerBox.height).toBeGreaterThanOrEqual(42);
    expect(spacerBox.height).toBeLessThanOrEqual(44);

    // 展开按钮整颗落在这条带的右边 —— 永远不压到红绿灯（否则它的点击会被吃掉）。
    const trafficZoneEnd = spacerBox.x + spacerBox.width;
    const expandBox = box(q('[data-testid="desktop-sidebar-expand"]'));
    expect(expandBox.x).toBeGreaterThanOrEqual(trafficZoneEnd);
  });
});
