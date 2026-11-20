/**
 * 桌面端面板页签条的溢出规则（spec `desktop-right-panel.md` 场景 12：页签横向滚动，
 * 「＋」贴住条带可见右缘且始终可点）。
 *
 * 迁移自 `e2e/desktop-panel-tabs-overflow.e2e.ts`。溢出与滚动裁切只能在真布局里量，
 * 所以跑在真 Chromium 上。当前实现（0903 基线 3d634ffc）先量页签还装不装得下，再
 * 决定「＋」画在哪儿：装得下时作为条带最后一个子元素内联，装不下时钉在可滚动条带
 * **外面**。回归守卫：如果哪天钉住机制被关掉（「＋」留在溢出条带里），它会被挤出
 * 可见区、点不到，下面的断言就红。
 *
 * 页面挂的是**生产**单分屏路径（宿主推 `desktopPanes` 带 sessionId → 外壳把 pane 级
 * ChatApp 包进 `.desktop-pane`），那个包裹层正是真实使用中约束对话容器的东西
 * （`.desktop-pane .chat-container { min-width: 0 }`）；没有 pane 的根布局只存在于
 * 第一次推 pane 之前，在这里用会让不断变宽的页签条把对话容器一起撑开，永远不溢出。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { fireEvent, screen } from "@testing-library/react";
import { MockDataGenerator } from "../fixtures/mockData";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 装了一个真实会话的单分屏（视口 1280×720）。 */
async function setupConversationPane() {
  const result = renderDesktopApp();
  bootDesktop({ workdir: DIR_A });
  sendCommand("desktopPanes", {
    panes: [{ paneId: "pane-1", sessionId: "sess-a1" }],
    focusedPaneId: "pane-1",
  });
  // 分屏里的 ChatApp 只收带自己 paneId 的消息；真机在这个 pane 绑上会话后会再推
  // 一次带 paneId 的快照。给一条真实对话，让这个分屏是一副正常的消息视图。
  sendCommand("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated: true,
    permissionMode: "default",
    paneId: "pane-1",
  });
  sendCommand("updateMessages", {
    paneId: "pane-1",
    messages: [
      MockDataGenerator.createUserMessage("修复登录页样式", "u-p1"),
      MockDataGenerator.createAssistantMessage("我先看一下样式文件。", "a-p1"),
    ],
  });
  await expect
    .poll(() => isVisible('[data-testid="desktop-pane-pane-1"]'))
    .toBe(true);
  return result;
}

const strip = () =>
  document.querySelector<HTMLElement>(".desktop-panel-tabs-strip")!;
const stripTabs = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      ".desktop-panel-tabs-strip [data-panel-tab]",
    ),
  );
/** 「＋」内联时是条带的最后一个子元素，溢出后移到条带外面（两种只挂一个）。 */
const addButton = () =>
  document.querySelector<HTMLElement>('[data-testid="panel-tabs-add"]')!;

/**
 * 元素与视口有非空交集 —— 对齐 Playwright 的 `toBeInViewport()`（默认 ratio 0，
 * 只要相交就算）。
 */
function inViewport(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return (
    r.right > 0 &&
    r.bottom > 0 &&
    r.left < window.innerWidth &&
    r.top < window.innerHeight
  );
}

describe("Desktop panel tab strip overflow", () => {
  it("＋ stays visible and clickable at the strip's right edge once tabs overflow", async () => {
    await page.viewport(1280, 720);
    await setupConversationPane();

    // 第一个面板：终端（单实例），从 pane 头部的面板开关 → 空态入口进去。
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    fireEvent.click(screen.getByTestId("panel-empty-item-terminal"));
    expect(stripTabs()).toHaveLength(1);

    // 装得下的情形（浏览器语义）：「＋」跟在最后一个页签后面、留在条带里面 ——
    // 两者只隔条带的 8px 间距，而不是被钉到最右边紧挨全屏按钮。
    const lastTabBox = stripTabs()[0].getBoundingClientRect();
    const fitGap = addButton().getBoundingClientRect().left - lastTabBox.right;
    expect(fitGap).toBeGreaterThanOrEqual(0);
    expect(fitGap).toBeLessThanOrEqual(12);

    // 继续加新预览页签（每点一次「＋」加一个），直到条带明显溢出 —— 留出约
    // 150px 越界。过了这一步条带就放不下尾随的「＋」，组件必须把它切到钉住的
    // 位置；若留在内联（回归），它会被挤出可见区，下面的断言就红。
    const overflowPx = () => strip().scrollWidth - strip().clientWidth;
    let added = 0;
    while (overflowPx() < 150 && added < 25) {
      fireEvent.click(addButton());
      fireEvent.click(screen.getByTestId("panel-toggle-item-preview"));
      added += 1;
    }
    expect(overflowPx()).toBeGreaterThanOrEqual(150);

    // 用户场景：切回**第一个**页签。条带滚回起点；「＋」必须仍然可见、并且完整
    // 落在页签条里。轮询滚动位置落定，免得新加页签的自动滚动抢在断言前面。
    await userEvent.click(stripTabs()[0]);
    await expect.poll(() => strip().scrollLeft, { timeout: 3000 }).toBe(0);
    const add = addButton();
    expect(inViewport(add)).toBe(true);
    const barBox = screen
      .getByTestId("desktop-panel-tabs")
      .getBoundingClientRect();
    const addBox = add.getBoundingClientRect();
    expect(addBox.x).toBeGreaterThanOrEqual(barBox.x - 1);
    expect(addBox.x + addBox.width).toBeLessThanOrEqual(
      barBox.x + barBox.width + 1,
    );

    // 仍然点得动：打开面板类型菜单；Escape 收回到「＋」。
    await userEvent.click(add);
    await expect
      .poll(() => isVisible('[data-testid="panel-toggle-menu"]'))
      .toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => isVisible('[data-testid="panel-toggle-menu"]'))
      .toBe(false);
    expect(document.activeElement).toBe(addButton());

    // 溢出的页签也够得到：把条带滚到尽头，最新（最后）那个页签进入可见区。
    strip().scrollLeft = strip().scrollWidth;
    await expect
      .poll(() => inViewport(stripTabs()[stripTabs().length - 1]))
      .toBe(true);
    const lastBox = stripTabs()[stripTabs().length - 1].getBoundingClientRect();
    const stripBox = strip().getBoundingClientRect();
    expect(lastBox.left).toBeGreaterThanOrEqual(stripBox.left - 1);
    expect(lastBox.right).toBeLessThanOrEqual(stripBox.right + 1);
  });
});
