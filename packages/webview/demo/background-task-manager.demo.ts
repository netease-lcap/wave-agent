import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { elementScreenshotWebp } from "../e2e/utils/screenshot.js";

test.describe("Background Task Manager Demo", () => {
  test("should show background task list and detail", async ({
    webviewPage,
  }) => {
    // Dialog min-width is 560px, wider than the default 400px demo viewport — widen so the full dialog is captured
    await webviewPage.setViewportSize({ width: 800, height: 700 });

    // 1. Open the dialog via showDialog
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "showDialog",
        dialogType: "tasks",
      });
    });

    // 2. Simulate extension pushing background tasks
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "updateBackgroundTasks",
        tasks: [
          {
            id: "bt-1",
            type: "shell",
            status: "running",
            startTime: Date.now() - 45000,
            command: "npm run build",
            description: "构建 monorepo",
            runtime: 45000,
            outputPath: "/tmp/wave-task-bt-1.log",
          },
          {
            id: "bt-2",
            type: "subagent",
            status: "completed",
            startTime: Date.now() - 120000,
            endTime: Date.now() - 80000,
            description: "探索 packages/webview 结构",
            runtime: 40000,
            exitCode: 0,
            outputPath: "/tmp/wave-task-bt-2.log",
          },
          {
            id: "bt-3",
            type: "shell",
            status: "failed",
            startTime: Date.now() - 200000,
            endTime: Date.now() - 195000,
            command: "npm test",
            description: "运行测试套件",
            runtime: 5000,
            exitCode: 1,
            outputPath: "/tmp/wave-task-bt-3.log",
          },
        ],
      });
    });

    // Verify dialog is visible
    await expect(
      webviewPage.getByTestId("background-task-manager"),
    ).toBeVisible();

    // Screenshot the list view
    const dialog = webviewPage.getByTestId("background-task-manager");
    await elementScreenshotWebp(
      dialog,
      "../../docs/public/screenshots/spec-background-task-list.webp",
    );

    // 3. Click the first task to enter detail view
    await dialog.getByText("[bt-1] shell").click();

    // 4. Simulate the getBackgroundTaskOutput response so the OUTPUT block renders
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "backgroundTaskOutput",
        taskId: "bt-1",
        output: {
          stdout: [
            "> wave-agent@ build",
            "> tsc -b && node esbuild.config.mjs",
            "",
            "[build] frontend started",
            "[build] frontend finished",
            "✓ built in 3.2s",
          ].join("\n"),
          stderr: "",
          status: "running",
          type: "shell",
          outputPath: "/tmp/wave-task-bt-1.log",
        },
      });
    });

    await expect(webviewPage.getByText("OUTPUT (last 20 lines)")).toBeVisible();

    // Screenshot the detail view
    await elementScreenshotWebp(
      dialog,
      "../../docs/public/screenshots/spec-background-task-detail.webp",
    );
  });
});
