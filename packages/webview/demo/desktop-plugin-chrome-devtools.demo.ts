import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Tutorial: chrome-devtools 插件市场一键安装. Shows the plugin marketplace
// dialog with chrome-devtools selected and the install scope picker.
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

test.describe("chrome-devtools plugin install screenshot", () => {
  test("install chrome-devtools from plugin marketplace", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 720 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
      host: "local",
      hosts: ["local"],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", baseConfig);

    await injector.simulateExtensionMessage("showDialog", {
      dialogType: "plugin",
    });
    await expect(
      webviewPage.getByText("插件管理", { exact: true }),
    ).toBeVisible();

    await injector.simulateExtensionMessage("listPluginsResponse", {
      plugins: [
        {
          id: "chrome-devtools@wave-plugins-official",
          name: "chrome-devtools",
          description:
            "Chrome DevTools Protocol MCP 服务器：浏览器自动化（页面导航、元素检查、截图、网络监控、控制台执行）",
          marketplace: "wave-plugins-official",
          installed: false,
          version: "1.5.2",
        },
        {
          id: "document-skills@wave-plugins-official",
          name: "document-skills",
          description: "文档处理套件：docx / xlsx / pptx / pdf",
          marketplace: "wave-plugins-official",
          installed: false,
          version: "2.1.0",
        },
        {
          id: "frontend-design@wave-plugins-official",
          name: "frontend-design",
          description: "创建独特的、生产级前端界面设计技能",
          marketplace: "wave-plugins-official",
          installed: false,
          version: "1.3.0",
        },
      ],
    });
    await webviewPage.waitForSelector(".plugin-item");
    await expect(webviewPage.getByText("chrome-devtools")).toBeVisible();

    // Open the install detail (scope selection) for chrome-devtools.
    await webviewPage.getByText("chrome-devtools").click();
    await expect(webviewPage.getByText("选择安装作用域")).toBeVisible();
    await expect(webviewPage.getByText("为你安装 (user)")).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-plugin-chrome-devtools.webp",
    );
  });
});
