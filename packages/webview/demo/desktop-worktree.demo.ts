import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Desktop worktree controls (spec desktop-sessions.md 基于分支的 worktree 隔离会
// 话): in a new-session state on a git workdir, the workdir selector is flanked by a
// branch selector and a worktree checkbox — a session in a temp worktree built
// on the chosen branch. The shared webview bundle must be rebuilt first
// (node esbuild.config.mjs).
const DIR_A = "/Users/dev/projects/wave-agent";
const BRANCHES = ["main", "feature/login-fix", "feature/payments", "v1.5.x"];

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

test.describe("Desktop worktree controls screenshots", () => {
  test("branch selector + worktree checkbox on a git workdir", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    // New-session state: the pickers render next to the workdir selector.
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
      host: "local",
      hosts: ["local"],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    // Host replies with the workdir's git branches → controls appear.
    await injector.simulateExtensionMessage("desktopGitBranches", {
      workdir: DIR_A,
      result: { branches: BRANCHES, current: "main" },
    });
    await expect(
      webviewPage.getByTestId("desktop-worktree-controls"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-branch-selector"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-worktree-checkbox"),
    ).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-worktree-controls.webp",
    );

    // Expanded branch menu: list the branches next to the checked worktree box.
    await webviewPage.getByTestId("desktop-branch-selector").click();
    await expect(webviewPage.getByTestId("desktop-branch-menu")).toBeVisible();
    await expect(webviewPage.getByTestId("desktop-branch-item")).toHaveCount(
      BRANCHES.length,
    );

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-worktree-branches.webp",
    );
  });
});
