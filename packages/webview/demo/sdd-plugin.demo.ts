import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { elementScreenshotWebp } from "../e2e/utils/screenshot.js";

test.describe("Built-in SDD Plugin Demo", () => {
  test("should show SDD builtin plugin toggle in project settings tab", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 400, height: 800 });

    // Open the configuration dialog (as the extension does via /config)
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "showConfiguration",
        configurationData: {
          apiKey: "sk-ant-api03-CXB9pH2k...mH8wQz",
          headers: "",
          baseURL: "https://api.nebula-tech.com/v1",
          model: "claude-sonnet-4-20250514",
          fastModel: "claude-haiku-4-20250514",
          backendLink: "https://wave.nebula-tech.com",
          language: "Chinese",
        },
      });
    });
    await expect(
      webviewPage.getByRole("heading", { name: "设置" }),
    ).toBeVisible();

    // Switch to the 项目设置 tab (triggers loadProjectSettings in the host)
    await webviewPage.getByRole("tab", { name: "项目设置" }).click();
    const dialog = webviewPage.locator(".configuration-dialog");

    // Host replies with the project settings, including the sdd@builtin toggle
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "projectSettings",
        enabledPlugins: { "sdd@builtin": true },
      });
    });

    // Verify the SDD toggle reflects the enabled state
    const sddToggle = webviewPage.getByTestId("sdd-toggle");
    await expect(sddToggle).toBeChecked();
    await expect(
      webviewPage.getByText("规格驱动开发（SDD）插件"),
    ).toBeVisible();

    await elementScreenshotWebp(
      dialog,
      "../../docs/public/screenshots/spec-sdd-plugin.webp",
    );
  });
});
