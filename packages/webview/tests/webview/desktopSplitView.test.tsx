/**
 * 桌面端分屏布局（spec `desktop-split-pane.md`）。
 *
 * 迁移自 `e2e/desktop-split-view.e2e.ts`。三条用例分别是：
 *  1. 会话标题盒只包住文字、头部整片都是拖拽起手点（标题不再吞掉拖拽）；
 *  2. 分屏关闭按钮不压住头部最右的面板开关，且与头部按钮垂直居中对齐；
 *  3. 多分屏溢出到第二行，两行之间有一条可拖拽的分隔条。
 *
 * 本套件跑在真 Chromium 里：`getBoundingClientRect()` / `elementFromPoint()` /
 * `getComputedStyle()` 都是真几何。拖拽那条用例不靠鼠标位移触发浏览器原生拖拽，
 * 而是按浏览器的形态把 `mousedown` 与带 `DataTransfer` 的 `dragstart` 派发给
 * 起手点元素与可拖拽的头部（写法差异见用例内注释）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page } from "vitest/browser";
import { fireEvent, screen } from "@testing-library/react";
import { MockDataGenerator } from "../fixtures/mockData";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

afterEach(() => {
  resetHostTier();
  resetPanelState();
  localStorage.clear();
});

const paneEl = (paneId: string) =>
  document.querySelector<HTMLElement>(
    `[data-testid="desktop-pane-${paneId}"]`,
  )!;

/** 起一遍桌面端外壳：工作目录 + 初值（+ 可选分屏布局）。 */
function bootShell(panes?: Record<string, unknown>[]) {
  const result = renderDesktopApp();
  sendCommand("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  sendCommand("setInitialState", initialState);
  if (panes) {
    sendCommand("desktopPanes", { panes, focusedPaneId: "pane-1" });
  }
  return result;
}

describe("Desktop split-view panes", () => {
  it("session title hugs its text and the whole header stays draggable", async () => {
    await page.viewport(1280, 720);

    bootShell([
      { paneId: "pane-1", sessionId: "sess-a1" },
      { paneId: "pane-2", sessionId: "sess-a2" },
    ]);
    // 桌面端头部标题是纯展示、不可就地改名（spec session-management.md
    // 「会话重命名入口」：改名入口归侧边栏行菜单；设计师 2026-10-30 拍板拿下
    // 头部入口）。带 session 也拿不到 role=button —— 标题不再占住拖拽起手点。
    sendCommand("setInitialState", {
      ...initialState,
      paneId: "pane-1",
      session: {
        id: "sess-a1",
        sessionType: "main",
        workdir: DIR_A,
        firstMessage: "修复登录页样式",
      },
    });

    const header = paneEl("pane-1").querySelector<HTMLElement>(
      '[data-testid="chat-header"]',
    )!;
    const title = paneEl("pane-1").querySelector<HTMLElement>(
      '[data-testid="header-title"]',
    )!;
    expect(title.className).toContain("header-title");
    expect(title.className).not.toContain("header-title-editable");
    expect(title.getAttribute("role")).toBeNull();
    expect((title.textContent ?? "").trim()).toBe("修复登录页样式");

    // 标题盒只包住文字：撑满剩余宽度（flex:1）时 hover 高亮会糊满整个头部。
    // （原用例先 `expect(box).not.toBeNull()`；`getBoundingClientRect()` 不返回
    // null，改成直接量真盒子，零尺寸的壳子过不了下面的比例判定。）
    const headerBox = header.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    expect(titleBox.width).toBeGreaterThan(0);
    expect(headerBox.width).toBeGreaterThan(0);
    expect(titleBox.width).toBeLessThan(headerBox.width * 0.5);

    // 标题右侧的头部空白区必须是可拖拽起手点：拖拽逻辑挂在 .chat-header 上，
    // 任何可交互元素（按钮/输入框/[role=button]）都会否决它，所以这块不能是
    // 标题的地盘。
    const probeX = titleBox.x + titleBox.width + 80;
    const probeY = headerBox.y + headerBox.height / 2;
    const underProbe = document.elementFromPoint(probeX, probeY);
    expect({
      isHeader: underProbe?.classList.contains("chat-header") === true,
      blockedBy:
        underProbe
          ?.closest('button, a, input, select, textarea, [role="button"]')
          ?.getAttribute("data-testid") ?? null,
    }).toEqual({ isHeader: true, blockedBy: null });

    // 真按一次：头部空白区与标题文字上起手都必须带上 pane 载荷。标题不再是
    // 可点改名区（没有 role=button），因此也不该再吞掉落在它上面的拖拽 ——
    // 头部整片都是拖拽区。
    //
    // 写法：浏览器在起手点按下后会把 dragstart 派发给可拖拽的头部本身，所以
    // 这里先在 `elementFromPoint` 得到的那颗元素上真派发 mousedown（组件的
    // 「按下点在可交互子元素上就否决拖拽」判定只读这个 target），再照浏览器的
    // 形态把带 DataTransfer 的 dragstart 派发给头部。
    const dragStarts: Array<{ prevented: boolean; payload: string }> = [];
    const onDragStart = (event: Event) => {
      const drag = event as DragEvent;
      dragStarts.push({
        prevented: drag.defaultPrevented,
        payload: drag.dataTransfer?.getData("application/x-wave-pane") ?? "",
      });
    };
    document.addEventListener("dragstart", onDragStart);
    const dragFrom = (x: number) => {
      const y = headerBox.y + headerBox.height / 2;
      const under = document.elementFromPoint(x, y);
      expect(under).toBeTruthy();
      fireEvent.mouseDown(under!, { clientX: x, clientY: y });
      const dataTransfer = new DataTransfer();
      header.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: x,
          clientY: y,
        }),
      );
    };

    try {
      dragFrom(probeX);
      dragFrom(titleBox.x + titleBox.width / 2);
    } finally {
      document.removeEventListener("dragstart", onDragStart);
    }

    expect(dragStarts).toEqual([
      { prevented: false, payload: JSON.stringify({ paneId: "pane-1" }) },
      { prevented: false, payload: JSON.stringify({ paneId: "pane-1" }) },
    ]);
  });

  it("pane close button does not overlap the header panel toggle", async () => {
    await page.viewport(1280, 720);

    bootShell([
      { paneId: "pane-1", sessionId: "sess-a1" },
      { paneId: "pane-2", sessionId: "sess-a2" },
    ]);

    const pane = paneEl("pane-1");
    const closeButton = screen.getByTestId("desktop-pane-close-pane-1");
    const panelToggle = pane.querySelector<HTMLElement>(
      '[data-testid="panel-toggle-btn"]',
    )!;
    await expect
      .poll(() => isVisible('[data-testid="desktop-pane-close-pane-1"]'))
      .toBe(true);
    expect(
      isVisible(
        '[data-testid="desktop-pane-pane-1"] [data-testid="panel-toggle-btn"]',
      ),
    ).toBe(true);

    // The absolutely-positioned close button must sit in its own reserved
    // header space, not on top of the right-most header button.
    const closeBox = closeButton.getBoundingClientRect();
    const toggleBox = panelToggle.getBoundingClientRect();
    // 两颗按钮都得有真盒子：原用例在 Playwright 下先 `expect(box).not.toBeNull()`
    // 兜住「没渲染出来」的情形，`getBoundingClientRect()` 永不返回 null，所以这里
    // 直接量盒子的尺寸——零尺寸的壳子会让下面的相交判定恒为 false。
    expect(closeBox.width).toBeGreaterThan(0);
    expect(closeBox.height).toBeGreaterThan(0);
    expect(toggleBox.width).toBeGreaterThan(0);
    expect(toggleBox.height).toBeGreaterThan(0);
    const intersects =
      closeBox.x < toggleBox.x + toggleBox.width &&
      closeBox.x + closeBox.width > toggleBox.x &&
      closeBox.y < toggleBox.y + toggleBox.height &&
      closeBox.y + closeBox.height > toggleBox.y;
    expect(intersects).toBe(false);

    // The close button must be vertically centered with the header buttons
    // (44px header, 22px button) — not pinned to the top edge.
    const closeCenterY = closeBox.y + closeBox.height / 2;
    const toggleCenterY = toggleBox.y + toggleBox.height / 2;
    expect(Math.abs(closeCenterY - toggleCenterY)).toBeLessThanOrEqual(1.5);
  });

  it("two-row split layout packs overflow into a second row", async () => {
    await page.viewport(1280, 720);

    // Four panes: pane-1/pane-2 on the top row, pane-3/pane-4 on the bottom
    // row (row:1). rowHeights [0.6, 0.4] gives the top row 60% of the height.
    bootShell();
    sendCommand("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1", row: 0, width: 0.5 },
        { paneId: "pane-2", sessionId: "sess-a2", row: 0, width: 0.5 },
        { paneId: "pane-3", sessionId: "sess-a3", row: 1, width: 0.5 },
        { paneId: "pane-4", sessionId: "sess-a4", row: 1, width: 0.5 },
      ],
      focusedPaneId: "pane-1",
      rowHeights: [0.6, 0.4],
    });

    // Each pane gets its own conversation; route messages by paneId.
    const paneMsg = (id: string, user: string, reply: string) =>
      sendCommand("updateMessages", {
        paneId: id,
        messages: [
          MockDataGenerator.createUserMessage(user, `u-${id}`),
          MockDataGenerator.createAssistantMessage(reply, `a-${id}`),
        ],
      });
    paneMsg("pane-1", "修复登录页样式", "我先看一下样式文件。");
    paneMsg("pane-2", "给购物车加测试", "我会先补充测试用例。");
    paneMsg("pane-3", "梳理会话索引", "从持久化层开始梳理。");
    paneMsg("pane-4", "补全终端面板测试", "覆盖首次聚焦路径。");

    await expect
      .poll(() => isVisible('[data-testid="desktop-pane-pane-1"]'))
      .toBe(true);
    expect(isVisible('[data-testid="desktop-pane-pane-3"]')).toBe(true);
    // Two rows + a draggable separator between them.
    expect(isVisible('[data-testid="desktop-pane-row"]')).toBe(true);
    expect(isVisible('[data-testid="desktop-pane-row-1"]')).toBe(true);
    expect(isVisible('[data-testid="desktop-row-separator"]')).toBe(true);
  });
});
