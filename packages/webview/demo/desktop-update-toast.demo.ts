import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

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

// Update announcements are pushed by the desktop host as showToast messages and
// rendered by the root ChatApp instance as a VS Code-style bottom-right toast.
// Button-less toasts (update found, downloading) auto-dismiss after 8s; toasts
// with an action (restart-install, open download page) persist until acted on.
test.describe("Desktop Update Toast Screenshots", () => {
  test("capture the update toasts", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 960, height: 640 });

    // Mount ChatApp (single pane) and wait for its message listener before
    // sending setInitialState, otherwise the payload is lost to the race.
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await seedSidebarSessions(injector, DIR_A, [
      { sessionId: "s-ut-1", title: "修复登录页样式问题" },
      {
        sessionId: "s-ut-2",
        title: "为支付服务接入监控告警",
        hasWorktree: true,
      },
      {
        sessionId: "s-ut-3",
        title: "梳理灰度发布流程",
        waitingConfirmation: true,
      },
    ]);
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("帮我修复登录页的样式问题", "msg-u1"),
      MockDataGenerator.createAssistantMessage(
        "我先看一下登录页组件的样式文件，找出对齐问题的原因。",
        "msg-a1",
      ),
    ]);
    await expect(webviewPage.locator(".message.user")).toBeVisible();

    // ── 1. Update found, downloading in background (no button) ──────
    await injector.simulateExtensionMessage("showToast", {
      toast: {
        id: "update-1",
        message: "发现新版本 v0.20.0（当前 v0.19.7），正在后台下载…",
      },
    });
    await expect(webviewPage.getByTestId("toast")).toBeVisible();
    await expect(webviewPage.getByTestId("toast")).toContainText(
      "发现新版本 v0.20.0",
    );
    // Wait for the 0.15s fade-in to finish — toBeVisible passes at opacity 0
    // and a screenshot taken mid-animation would look translucent.
    await expect(webviewPage.getByTestId("toast")).toHaveCSS("opacity", "1");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-update-toast.webp",
    );

    // The button-less toast auto-dismisses after 8s; wait for it to leave
    // so the second screenshot shows the action toast alone (not stacked).
    await expect(webviewPage.getByTestId("toast")).toHaveCount(0, {
      timeout: 10000,
    });

    // ── 2. Download finished: action toast with 重启安装 button ─────
    await injector.simulateExtensionMessage("showToast", {
      toast: {
        id: "update-2",
        message: "新版本 v0.20.0 已下载完成，重启应用以完成安装。",
        actionLabel: "重启安装",
        action: { type: "quitAndInstall" },
      },
    });
    await expect(webviewPage.getByTestId("toast")).toContainText("已下载完成");
    await expect(
      webviewPage.getByRole("button", { name: "重启安装" }),
    ).toBeVisible();
    await expect(webviewPage.getByTestId("toast")).toHaveCSS("opacity", "1");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-update-toast-action.webp",
    );
  });
});
