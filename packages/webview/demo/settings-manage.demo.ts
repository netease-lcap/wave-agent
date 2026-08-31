import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { elementScreenshotWebp } from "../e2e/utils/screenshot.js";
import fs from "node:fs";
import path from "node:path";

/**
 * 设置页「钩子」「MCP 服务」选项卡 demo（/hooks、/mcp 斜杠命令落地页）：
 * 独立加载 settings.js bundle（settings-preview-entry），模拟 host 下发
 * settingsState(nav) 选中选项卡，再回 hooksResponse / mcpServersResponse +
 * mcpConfigPathsResponse 展示来源 Tab 列表、钩子开关与 MCP 连接状态。
 */

// SettingsPage 的颜色全部走 --vscode-* 变量，独立 settings.html 没有宿主注入，
// 必须手动带上深色主题变量集，否则截图为白底浅色（实测 2026-08-29）。
const themeStyles = fs.readFileSync(
  path.join(process.cwd(), "theme", "theme-base-dark.css"),
  "utf8",
);

const mockVscodeApiJs = `
    window.process = { env: { NODE_ENV: 'production' } };
    window.acquireVsCodeApi = () => ({
        postMessage: (message) => {
            if (!window.testMessages) window.testMessages = [];
            window.testMessages.push(message);
        },
        setState: () => {},
        getState: () => ({})
    });
    window.simulateExtensionMessage = (message) => {
        window.dispatchEvent(new MessageEvent('message', { data: message }));
    };
`;

const settingsHtml = `
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wave Settings</title>
    <style>${themeStyles}</style>
    <link rel="stylesheet" href="vscode-webview://mock-extension-id/settings.css">
</head>
<body>
    <div id="root"></div>
    <script>${mockVscodeApiJs}</script>
    <script src="vscode-webview://mock-extension-id/settings.js"></script>
</body>
</html>`;

/** 打开设置页 + 初始化配置（settings entry 挂载时会请求 getConfiguration） */
async function openSettings(webviewPage, nav: string) {
  await webviewPage.setViewportSize({ width: 1000, height: 760 });
  await webviewPage.setContent(settingsHtml);
  await expect(webviewPage.locator(".settings-page")).toBeVisible();
  await webviewPage.evaluate((targetNav) => {
    window.simulateExtensionMessage({
      command: "settingsState",
      workdir: "/work/wave-agent",
      nav: targetNav,
    });
    window.simulateExtensionMessage({
      command: "configurationResponse",
      configurationData: { language: "zh-CN", contextLength: 200 },
    });
  }, nav);
}

const userHooks = {
  PreToolUse: [
    {
      matcher: "Write",
      hooks: [{ type: "command", command: "node scripts/lint-check.js" }],
      enabled: true,
    },
    {
      matcher: "Read",
      hooks: [
        {
          type: "command",
          command: "node scripts/audit-read.js --scope=$FILE",
        },
      ],
      enabled: false,
    },
  ],
  SessionStart: [
    {
      hooks: [
        {
          type: "command",
          command: "node scripts/load-project-context.js",
          timeout: 30,
        },
      ],
      enabled: true,
    },
  ],
};

test.describe("设置页钩子选项卡 Demo", () => {
  test("should show hook entries with toggle and actions", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, "hooks");

    // 等视图挂载（发出 getHooksByScope 请求）后再回数据，避免响应先于 listener
    await expect(webviewPage.getByText("新增钩子")).toBeVisible();
    await webviewPage.evaluate((hooks) => {
      window.simulateExtensionMessage({
        command: "hooksResponse",
        hooks,
        configPath: "~/.wave/settings.json",
      });
    }, userHooks);

    // 3 source tabs + 钩子条目与开关
    await expect(webviewPage.getByText("用户级钩子")).toBeVisible();
    await expect(webviewPage.getByText("项目级钩子")).toBeVisible();
    await expect(webviewPage.getByText("插件钩子")).toBeVisible();
    await expect(webviewPage.getByText("PreToolUse:Write")).toBeVisible();
    await expect(webviewPage.getByText("已关闭")).toBeVisible();

    const view = webviewPage.locator(".settings-page");
    await elementScreenshotWebp(
      view,
      "../../docs/public/screenshots/spec-hooks-list.webp",
    );
  });
});

const mcpServers = [
  {
    name: "jira",
    scope: "user",
    config: {
      command: "npx",
      args: ["-y", "@mcp/server-jira"],
      env: { JIRA_API_TOKEN: "your-token-here" },
    },
    status: "connected",
    toolCount: 8,
    capabilities: ["tools"],
    lastConnected: Date.now() - 60000,
  },
  {
    name: "github",
    scope: "user",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    },
    status: "disconnected",
    toolCount: 0,
    capabilities: [],
  },
  {
    name: "sentry",
    scope: "user",
    config: { url: "https://mcp.sentry.io/sse" },
    status: "error",
    toolCount: 0,
    error: "Authentication failed: invalid token",
    capabilities: [],
  },
];

test.describe("设置页 MCP 服务选项卡 Demo", () => {
  test("should show MCP servers by scope with connection status", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, "mcp");

    // 等视图挂载（发出 getMcpServers / getMcpConfigPaths 请求）后再回数据
    await expect(webviewPage.getByText("新增用户级 MCP 服务")).toBeVisible();
    await webviewPage.evaluate((servers) => {
      window.simulateExtensionMessage({
        command: "mcpServersResponse",
        servers,
      });
      window.simulateExtensionMessage({
        command: "mcpConfigPathsResponse",
        userPath: "~/.wave/mcp.json",
        projectPath: null,
      });
    }, mcpServers);

    // 3 source tabs + 服务器连接状态
    await expect(
      webviewPage.getByRole("tab", { name: "用户级 MCP" }),
    ).toBeVisible();
    await expect(
      webviewPage.getByRole("tab", { name: "项目级 MCP" }),
    ).toBeVisible();
    await expect(
      webviewPage.getByRole("tab", { name: "插件 MCP" }),
    ).toBeVisible();
    await expect(webviewPage.getByText("jira", { exact: true })).toBeVisible();
    await expect(webviewPage.getByText("8 tools")).toBeVisible();
    await expect(
      webviewPage.getByRole("button", { name: "连接" }).first(),
    ).toBeVisible();
    await expect(
      webviewPage.getByText("Authentication failed: invalid token"),
    ).toBeVisible();

    const view = webviewPage.locator(".settings-page");
    await elementScreenshotWebp(
      view,
      "../../docs/public/screenshots/spec-mcp-settings.webp",
    );
  });
});
