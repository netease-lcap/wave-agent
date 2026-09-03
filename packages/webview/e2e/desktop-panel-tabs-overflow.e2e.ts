import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    fastModel: "claude-haiku-4-20250514",
  },
  permissionMode: "default",
};

/**
 * Real-browser geometry checks for the panel tab strip overflow rule (spec
 * scenario 12: tabs scroll horizontally, the "＋" sticks to the strip's visible
 * right edge and stays clickable). jsdom has no layout, so overflow / scroll
 * clipping can only be verified against real Chromium boxes.
 *
 * The current implementation (0903 基线 3d634ffc) measures whether the tabs
 * still fit and renders the "＋" in one of two spots: INLINE as the strip's
 * last child while they fit, PINNED outside the scrollable strip once they
 * overflow. Regression guard: if the pinned mechanism were ever disabled (the
 * button staying inline inside the overflowing strip), the "＋" is pushed out
 * of the visible area and becomes unreachable — the assertions below go red.
 *
 * The page mounts the PRODUCTION single-pane path (host pushes `desktopPanes`
 * with a session-bound pane → DesktopShell wraps the pane-scoped ChatApp in a
 * `.desktop-pane`). That wrapper is what constrains the chat container in real
 * use (`.desktop-pane .chat-container { min-width: 0 }`); the no-pane root
 * layout only exists before the first pane push and must not be used here —
 * without the clamp the growing tab strip would stretch the chat container
 * itself and the strip would never overflow.
 */
test.describe("Desktop panel tab strip overflow", () => {
  async function setupConversationPane(webviewPage: Page) {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [{ paneId: "pane-1", sessionId: "sess-a1" }],
      focusedPaneId: "pane-1",
    });
    // Pane-scoped ChatApp only accepts paneId-tagged messages; the real host
    // re-pushes a paneId snapshot once a session binds the pane. Give it one
    // real conversation so the pane is a normal message view.
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      paneId: "pane-1",
    });
    await injector.simulateExtensionMessage("updateMessages", {
      paneId: "pane-1",
      messages: [
        MockDataGenerator.createUserMessage("修复登录页样式", "u-p1"),
        MockDataGenerator.createAssistantMessage(
          "我先看一下样式文件。",
          "a-p1",
        ),
      ],
    });
    await expect(webviewPage.getByTestId("desktop-pane-pane-1")).toBeVisible();
    return injector;
  }

  test("＋ stays visible and clickable at the strip's right edge once tabs overflow", async ({
    webviewPage,
  }) => {
    await setupConversationPane(webviewPage);

    // First panel: terminal (single-instance) via the pane header toggle →
    // empty state entry.
    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-empty-item-terminal").click();

    const tabBar = webviewPage.getByTestId("desktop-panel-tabs");
    const strip = webviewPage.locator(".desktop-panel-tabs-strip");
    const tabs = webviewPage.locator(
      ".desktop-panel-tabs-strip [data-panel-tab]",
    );
    const add = webviewPage.getByTestId("panel-tabs-add");
    await expect(tabs).toHaveCount(1);

    // Fit case (browser semantics): the inline "＋" trails the last tab inside
    // the strip — one strip gap (8px) away, NOT pinned far right next to the
    // fullscreen action.
    const fitGap = await add.evaluate((btn) => {
      const all = Array.from(
        document.querySelectorAll(".desktop-panel-tabs-strip [data-panel-tab]"),
      );
      const last = all[all.length - 1].getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      return b.left - last.right;
    });
    expect(fitGap).toBeGreaterThanOrEqual(0);
    expect(fitGap).toBeLessThanOrEqual(12);

    // Keep adding fresh preview tabs (each "＋" click ADDS one) until the
    // strip clearly overflows — leave ~150px past the visible edge. Past that
    // point the strip can no longer host the trailing "＋", so the component
    // must switch it to the pinned spot; if it stayed inline (regression) it
    // would be pushed out of the visible area and the assertions below red.
    const overflowPx = () =>
      strip.evaluate((el) => el.scrollWidth - el.clientWidth);
    let added = 0;
    while ((await overflowPx()) < 150 && added < 25) {
      await add.click();
      await webviewPage.getByTestId("panel-toggle-item-preview").click();
      added += 1;
    }
    expect(await overflowPx()).toBeGreaterThanOrEqual(150);

    // User scenario: switch back to the FIRST tab. The strip scrolls to the
    // start; the "＋" must stay visible and fully inside the tab bar. Poll for
    // the settled scroll position so the add-tab auto-scroll effect cannot
    // race the assertion.
    await tabs.first().click();
    await expect
      .poll(() => strip.evaluate((el) => el.scrollLeft), {
        timeout: 3000,
      })
      .toBe(0);
    await expect(add).toBeInViewport();
    const barBox = (await tabBar.boundingBox())!;
    const addBox = (await add.boundingBox())!;
    expect(addBox.x).toBeGreaterThanOrEqual(barBox.x - 1);
    expect(addBox.x + addBox.width).toBeLessThanOrEqual(
      barBox.x + barBox.width + 1,
    );

    // Still clickable: opens the panel-type menu; Escape closes back to "＋".
    await add.click();
    const menu = webviewPage.getByTestId("panel-toggle-menu");
    await expect(menu).toBeVisible();
    await webviewPage.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(add).toBeFocused();

    // And the overflowed tabs stay reachable: scrolling the strip to its end
    // brings the newest (last) tab into view next to the "＋".
    await strip.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(tabs.last()).toBeInViewport();
  });
});
