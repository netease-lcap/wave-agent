import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

/**
 * Built-in SDD plugin toggle in the settings page 项目设置 view (spec
 * builtin-sdd-plugin.md 按需启用内置插件 + desktop-account-and-settings.md 设置页场景 11).
 * The shared webview bundle must be rebuilt first (node esbuild.config.mjs)
 * or these shots capture the old UI.
 */
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

test.describe("Built-in SDD Plugin Demo", () => {
  test("should show SDD builtin plugin toggle in settings project view", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 1000, height: 720 });
    const injector = new MessageInjector(webviewPage);

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("帮我修复登录页的样式问题", "msg-u1"),
      MockDataGenerator.createAssistantMessage(
        "我先看一下登录页组件的样式文件，找出对齐问题的原因。",
        "msg-a1",
      ),
    ]);

    // 账户卡片（设置页入口）依赖 host 下发账户信息。
    await injector.simulateExtensionMessage("desktopAccountInfo", {
      isAuthenticated: true,
      user: { id: "user-1", email: "alice@example.com" },
      plan: { monthlyQuota: 100, months: 12, used: 240 },
      apiQuota: { limit: null, used: 1153.14 },
      update: undefined,
    });

    // 打开设置页 → 「项目设置」视图（v3：个人信息行热区打开菜单）。
    await webviewPage.getByTestId("account-card-hotzone").click();
    await webviewPage.getByTestId("more-menu-settings").click();
    await expect(
      webviewPage.getByRole("heading", { name: "全局设置" }),
    ).toBeVisible();
    await webviewPage.getByRole("button", { name: "项目设置" }).click();
    await expect(
      webviewPage.getByRole("heading", { name: "项目设置" }),
    ).toBeVisible();

    // Host 回发项目设置（sdd@builtin 已启用）→ 开关为勾选态。
    await injector.simulateExtensionMessage("projectSettings", {
      enabledPlugins: { "sdd@builtin": true },
    });
    const sddToggle = webviewPage.getByLabel("启用 SDD 插件");
    await expect(sddToggle).toBeChecked();
    await expect(webviewPage.getByText("SDD（规格驱动开发）")).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-sdd-plugin.webp",
    );
  });
});
