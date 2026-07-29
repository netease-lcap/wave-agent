import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";

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

test.describe("Desktop split-view panes", () => {
  test("pane close button does not overlap the header panel toggle", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 1280, height: 720 });

    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1" },
        { paneId: "pane-2", sessionId: "sess-a2" },
      ],
      focusedPaneId: "pane-1",
    });

    const pane = webviewPage.getByTestId("desktop-pane-pane-1");
    const closeButton = webviewPage.getByTestId("desktop-pane-close-pane-1");
    const panelToggle = pane.getByTestId("panel-toggle-btn");
    await expect(closeButton).toBeVisible();
    await expect(panelToggle).toBeVisible();

    // The absolutely-positioned close button must sit in its own reserved
    // header space, not on top of the right-most header button.
    const closeBox = await closeButton.boundingBox();
    const toggleBox = await panelToggle.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    const intersects =
      closeBox!.x < toggleBox!.x + toggleBox!.width &&
      closeBox!.x + closeBox!.width > toggleBox!.x &&
      closeBox!.y < toggleBox!.y + toggleBox!.height &&
      closeBox!.y + closeBox!.height > toggleBox!.y;
    expect(intersects).toBe(false);

    await webviewPage.screenshot({
      path: "../../docs/public/screenshots/desktop-split-view.png",
    });
  });
});
