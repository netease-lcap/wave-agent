import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { WRITE_TOOL_NAME } from "wave-agent-sdk";
import { elementScreenshotWebp } from "../e2e/utils/screenshot.js";

// Tutorial: Figma 设计稿 → 前端代码. Shows the conversation flow where the
// agent reads a Figma design via the figma MCP server (get_figma_data +
// download_figma_images) and then writes the generated index.html.
const DIR_A = "/Users/dev/projects/login-page";

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

test.describe("Figma MCP tutorial screenshots", () => {
  test("figma design to frontend code flow", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
      host: "local",
      hosts: ["local"],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", baseConfig);

    await injector.updateMessages([
      MockDataGenerator.createUserMessage(
        "请严格按照这个 Figma 链接生成登录页的响应式 HTML，视觉细节要跟设计稿一致：https://www.figma.com/design/9xYkZ0vF/Login-Page（含移动端与桌面端两套布局）",
        "msg_figma_u1",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "好的，我先通过 Figma MCP 服务器读取设计稿的布局信息与图片资源，再生成响应式页面。",
        "mcp__figma__get_figma_data",
        JSON.stringify({
          file_key: "9xYkZ0vF",
          node_id: "0:1",
        }),
        "Figma file: Login-Page | frames: [Mobile-Login (375x812), Desktop-Login (1440x900)] | colors: #4A90D9 / #FFFFFF / #2C3E50 | typography: Inter 16-32px",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "已获取布局信息，现在下载设计稿中的图标与图片资源。",
        "mcp__figma__download_figma_images",
        JSON.stringify({
          file_key: "9xYkZ0vF",
          node_ids: ["100:2", "100:3", "100:4"],
          format: "svg",
        }),
        "Downloaded 3 assets: logo.svg, social-google.svg, social-github.svg",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "已按设计稿生成响应式页面，包含两套断点布局与全部图标资源。",
        WRITE_TOOL_NAME,
        JSON.stringify({
          file_path: `${DIR_A}/index.html`,
          content:
            '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>登录 - Login</title>\n</head>\n<body>\n  <!-- 响应式登录页：移动端单列 / 桌面端双栏，还原 Figma 设计稿 -->\n</body>\n</html>',
        }),
        "index.html 已生成（包含响应式布局与设计稿图标资源）",
      ),
    ]);

    await webviewPage.waitForSelector(".tool-container");
    await expect(
      webviewPage.getByText("mcp__figma__get_figma_data").first(),
    ).toBeVisible();
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-figma-mcp.webp",
    );
  });
});
