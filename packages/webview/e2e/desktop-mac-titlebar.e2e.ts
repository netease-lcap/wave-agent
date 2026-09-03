import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * macOS 隐藏标题栏（spec「macOS 隐藏标题栏」）：main 进程仅在 darwin 隐藏系统
 * 标题栏，webview 据此在侧边栏顶部渲染 44px 窗口行（系统红绿灯落位 + 整行拖拽
 * 区，不画假圆点），侧边栏收起时在对话顶栏左端让出 ~76px 拖拽区。Linux 真机
 * 无法跑 mac Electron，这里通过 evaluate 注入 `wavePlatform="darwin"`（等价于
 * mac preload 环境）并用真实的 UI 操作触发重渲染，做 DOM 几何验证；
 * -webkit-app-region 的实际拖拽行为仍需 mac 实机确认。
 */
test.describe("macOS hidden titlebar", () => {
  test("sidebar top renders an empty 44px drag row clear of controls", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    });
    await injector.waitForChatAppReady();

    // Switch to the mac environment and force a sidebar re-render (a session
    // tree push changes its props).
    await webviewPage.evaluate(() => {
      (window as unknown as { wavePlatform?: string }).wavePlatform = "darwin";
    });
    await injector.simulateExtensionMessage("desktopSessionTree", {
      groups: [],
    });

    await expect(webviewPage.getByTestId("desktop-sidebar")).toBeVisible();
    const dragRow = webviewPage.locator(".sidebar-window-row--mac-drag");
    await expect(dragRow).toBeVisible();
    // Real OS traffic lights live on this row — the webview must not draw its
    // own dots on top (no duplication).
    await expect(webviewPage.locator(".window-dot")).toHaveCount(0);
    // 44px row at the very top of the sidebar; the brand row starts below it,
    // so no interactive control sits under the traffic lights.
    const rowBox = await dragRow.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.height).toBeCloseTo(44, 0);
    expect(rowBox!.y).toBeCloseTo(0, 0);
    const brandBox = await webviewPage
      .locator(".desktop-sidebar-header")
      .boundingBox();
    expect(brandBox).not.toBeNull();
    expect(brandBox!.y).toBeGreaterThanOrEqual(rowBox!.y + rowBox!.height - 1);
  });

  test("collapsed sidebar clears the traffic-light zone at the header's left", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    });
    await injector.waitForChatAppReady();

    // Enter the mac environment, then collapse the sidebar through the real
    // control — the re-render evaluates the mac spacer branch.
    await webviewPage.evaluate(() => {
      (window as unknown as { wavePlatform?: string }).wavePlatform = "darwin";
    });
    await webviewPage.getByTestId("desktop-sidebar-collapse").click();

    // Sidebar fully gone; the chat header now starts at the window's left edge.
    await expect(webviewPage.getByTestId("desktop-sidebar")).toHaveCount(0);
    const spacer = webviewPage.getByTestId("chat-header-mac-traffic");
    await expect(spacer).toBeVisible();
    const spacerBox = await spacer.boundingBox();
    expect(spacerBox).not.toBeNull();
    // A ~76px wide, full-header-height band reserved for the system traffic
    // lights (drag region) at the very top of the window; the chat header's own
    // 12px left padding places its left edge at x≈12.
    expect(spacerBox!.y).toBeCloseTo(0, 0);
    expect(spacerBox!.x).toBeCloseTo(12, 0);
    expect(spacerBox!.width).toBeGreaterThanOrEqual(74);
    // Full-header-height band: `.chat-header` is 44px incl. a 1px bottom
    // border, so the stretched child measures 43px (content box). Accept the
    // 42–44px range — the drag region only needs to cover the lights, which
    // hover in the header's top half.
    expect(spacerBox!.height).toBeGreaterThanOrEqual(42);
    expect(spacerBox!.height).toBeLessThanOrEqual(44);

    // The expand button sits fully to the right of that band — never under the
    // traffic lights (its click would otherwise be blocked).
    const trafficZoneEnd = spacerBox!.x + spacerBox!.width;
    const expandBox = await webviewPage
      .getByTestId("desktop-sidebar-expand")
      .boundingBox();
    expect(expandBox).not.toBeNull();
    expect(expandBox!.x).toBeGreaterThanOrEqual(trafficZoneEnd);
  });
});
