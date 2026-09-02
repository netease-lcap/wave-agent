import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { WRITE_TOOL_NAME } from "wave-agent-sdk";
import { elementScreenshotWebp } from "../e2e/utils/screenshot.js";

// Tutorial: 网页自动化测试 via chrome-devtools MCP. Shows the conversation
// flow where the agent drives a real browser (navigate → fill → screenshot)
// and writes a test report.
const DIR_A = "/Users/dev/projects/web-test";

const baseConfig = {
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

test.describe("chrome-devtools MCP tutorial screenshots", () => {
  test("web automation test flow", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
      host: "local",
      hosts: ["local"],
    });
    await injector.waitForChatAppReady();
    await seedSidebarSessions(injector, DIR_A, [
      { sessionId: "s-cd-1", title: "DevTools 调试登录页跳转", running: true },
      {
        sessionId: "s-cd-2",
        title: "补全注册流程自动化用例",
        hasWorktree: true,
      },
      { sessionId: "s-cd-3", title: "排查接口超时与等待策略" },
    ]);
    await injector.simulateExtensionMessage("setInitialState", baseConfig);

    await injector.updateMessages([
      MockDataGenerator.createUserMessage(
        "用 chrome-devtools 打开登录页 https://example.com/login，填写账号密码点击登录，检查是否跳转成功并截图，最后把测试结论写成 test-report.md",
        "msg_web_u1",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "好的，我先打开登录页面。",
        "mcp__chrome_devtools__navigate",
        JSON.stringify({ url: "https://example.com/login" }),
        "Page loaded: https://example.com/login (status 200, 12.4s)",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "页面已加载，填写账号密码并点击登录按钮。",
        "mcp__chrome_devtools__fill",
        JSON.stringify({ selector: "#email", value: "dev@example.com" }),
        "Filled #email",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "登录成功并跳转到控制台首页，截图确认渲染结果。",
        "mcp__chrome_devtools__screenshot",
        JSON.stringify({ format: "png", full_page: false }),
        "Screenshot saved: /tmp/web-test/login-success.png",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "测试结论：登录流程通过（填写 → 提交 → 跳转 → 渲染全部正常，控制台无报错）。已生成测试报告。",
        WRITE_TOOL_NAME,
        JSON.stringify({
          file_path: `${DIR_A}/test-report.md`,
          content:
            "# 登录流程自动化测试报告\n\n- 用例：登录成功跳转\n- 步骤：打开 /login → 填写账号密码 → 点击登录 → 校验跳转\n- 结果：通过\n- 控制台错误：0\n- 截图：login-success.png",
        }),
        "test-report.md 已生成",
      ),
    ]);

    await webviewPage.waitForSelector(".tool-container");
    await expect(
      webviewPage.getByText("mcp__chrome_devtools__navigate").first(),
    ).toBeVisible();
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-chrome-devtools.webp",
    );
  });
});
