import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Desktop local workdir selector (spec desktop-app.md 首次启动/选择工作目录):
// new-session state (no messages) shows the workdir dropdown with the recents
// list and the 浏览… entry. The shared webview bundle must be rebuilt first
// (node esbuild.config.mjs) or these shots capture the old UI.
const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/web-dashboard";
const DIR_C = "/Users/dev/projects/docs-site";

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

test.describe("Desktop workdir selector screenshots", () => {
  test("local workdir dropdown with recents + browse", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    // New-session state: no messages, the workdir selector renders at the
    // input's top-left and the dropdown expands upward.
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
      host: "local",
      hosts: ["local"],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    await expect(webviewPage.getByTestId("desktop-workdir")).toBeVisible();
    await webviewPage.getByTestId("desktop-workdir").click();
    await expect(webviewPage.getByTestId("desktop-workdir-menu")).toBeVisible();
    await expect(webviewPage.getByText("最近打开")).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-workdir-recent-item"),
    ).toHaveCount(3);
    await expect(
      webviewPage.getByTestId("desktop-workdir-browse"),
    ).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-workdir-dropdown.webp",
    );
  });
});
