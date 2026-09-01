import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

const WORKDIR = "/Users/dev/projects/wave-agent";

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

// Regression: opening a right-side panel (e.g. 计划) on a brand-new
// conversation used to shift the whole welcome page (brand mark + input card)
// left by half the panel width — the row-level justify-content:center on the
// welcome chat body centers the group [chat-main(100%) + panel], and with the
// panel flex-shrink:0 the overflow spills onto the sidebar. The welcome group
// must stay inside the message column (the space left of the panel).
test.describe("Desktop welcome page with a side panel", () => {
  test("welcome group stays inside the message column when a panel is open", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 1400, height: 900 });

    // The desktop layout only mounts ChatApp after desktopWorkdirState, so
    // push the initial state only once the mount's message listener exists
    // (webviewReady) — a setInitialState sent before that lands in the gap
    // and is dropped.
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: WORKDIR,
      recentWorkdirs: [WORKDIR],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    await expect(webviewPage.getByTestId("welcome-wordmark")).toBeVisible();

    // Open the 计划 panel from the header toggle.
    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-toggle-item-plan").click();
    await expect(webviewPage.getByTestId("plan-pane")).toBeVisible();

    const geom = await webviewPage.evaluate(() => {
      const r = (sel: string) =>
        document.querySelector(sel)!.getBoundingClientRect();
      const body = r(".desktop-chat-body");
      const main = r(".desktop-chat-main");
      const input = r(".input-wrapper");
      const welcome = r('[data-testid="welcome-wordmark"]');
      return {
        bodyLeft: body.left,
        bodyRight: body.right,
        mainLeft: main.left,
        mainRight: main.right,
        inputLeft: input.left,
        inputRight: input.right,
        welcomeLeft: welcome.left,
        welcomeRight: welcome.right,
      };
    });

    // The message column must not spill left of the chat body (no overflow
    // onto the sidebar), and the input card must sit fully inside it.
    expect(geom.mainLeft).toBeGreaterThanOrEqual(geom.bodyLeft - 1);
    expect(geom.inputLeft).toBeGreaterThanOrEqual(geom.bodyLeft - 1);
    expect(geom.welcomeLeft).toBeGreaterThanOrEqual(geom.bodyLeft - 1);

    // Welcome group centered horizontally within the message column.
    const mainCenter = (geom.mainLeft + geom.mainRight) / 2;
    const inputCenter = (geom.inputLeft + geom.inputRight) / 2;
    expect(Math.abs(inputCenter - mainCenter)).toBeLessThan(2);

    // The message column ends where the panel begins (shares the row).
    expect(geom.mainRight).toBeLessThanOrEqual(geom.bodyRight + 1);
  });
});
