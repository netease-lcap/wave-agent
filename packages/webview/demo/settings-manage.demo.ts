import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { elementScreenshotWebp } from "../e2e/utils/screenshot.js";
import {
  openSettings,
  simulateHostMessage,
  waitForSentCommand,
} from "../e2e/utils/settingsHarness.js";

/**
 * 设置页「钩子」「MCP 服务」选项卡 demo（/hooks、/mcp 斜杠命令落地页）：
 * 独立加载 settings.js bundle（settings-preview-entry），模拟 host 下发
 * settingsState(nav) 选中选项卡，再回 hooksResponse / mcpServersResponse +
 * mcpConfigPathsResponse 展示来源 Tab 列表、钩子事件摘要与 MCP 连接状态。
 */

const userHooks = {
  PreToolUse: [
    {
      matcher: "Write",
      hooks: [{ type: "command", command: "node scripts/lint-check.js" }],
    },
    {
      matcher: "Read",
      hooks: [
        {
          type: "command",
          command: "node scripts/audit-read.js --scope=$FILE",
        },
      ],
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
    },
  ],
};

test.describe("设置页钩子选项卡 Demo", () => {
  test("should show hook entries with event summary and actions", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      settingsState: { workdir: "/work/wave-agent", nav: "hooks" },
    });

    // 等视图挂载（发出 getHooksByScope 请求）后再回数据，避免响应先于 listener
    await expect(webviewPage.getByText("新增钩子")).toBeVisible();
    await simulateHostMessage(webviewPage, {
      command: "hooksResponse",
      // 归属键：当前 Tab 为「用户级钩子」，回带 scope 才能通过过期即弃
      scope: "user",
      hooks: userHooks,
      configPath: "~/.wave/settings.json",
    });

    // 3 source tabs + 钩子条目、事件摘要与命令
    await expect(webviewPage.getByText("用户级钩子")).toBeVisible();
    await expect(webviewPage.getByText("项目级钩子")).toBeVisible();
    await expect(webviewPage.getByText("插件钩子")).toBeVisible();
    await expect(webviewPage.getByText("PreToolUse:Write")).toBeVisible();
    await expect(webviewPage.getByText("工具执行前").first()).toBeVisible();
    await expect(webviewPage.getByText("新会话启动时").first()).toBeVisible();
    await expect(
      webviewPage.getByText("node scripts/load-project-context.js"),
    ).toBeVisible();

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
    await openSettings(webviewPage, {
      settingsState: { workdir: "/work/wave-agent", nav: "mcp" },
    });

    // 等视图挂载（发出 getMcpServers / getMcpConfigPaths 请求）后再回数据
    await expect(webviewPage.getByText("新增用户级 MCP 服务")).toBeVisible();
    await simulateHostMessage(webviewPage, {
      command: "mcpServersResponse",
      servers: mcpServers,
    });
    await simulateHostMessage(webviewPage, {
      command: "mcpConfigPathsResponse",
      userPath: "~/.wave/mcp.json",
      projectPath: null,
    });

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

// 服务端下发的托管配置（三端同款「服务端配置」区块）：取一份有代表性的下发
// 内容——env（含密钥）、权限策略、记忆开关与上下文长度，让截图能体现「组织到底
// 管控了哪些项」。展示值为原文 JSON，不做字段筛选与脱敏。
const managedSettings = {
  env: {
    WAVE_MODEL: "deepseek-v4",
    WAVE_BASE_URL: "https://gateway.example.com/v1",
    WAVE_API_KEY: "sk-org-example-key",
  },
  permissions: {
    defaultMode: "default",
    deny: ["Bash(rm -rf*)", "Read(.env)"],
  },
  autoMemoryEnabled: false,
  contextLength: 200,
};

test.describe("设置页服务端配置区块 Demo", () => {
  test("should show server-managed config as read-only JSON", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      settingsState: { workdir: "/work/wave-agent", nav: "global" },
    });

    // 等视图挂载（发出 getManagedSettings 请求）后再回数据，避免响应先于 listener
    const request = await waitForSentCommand(webviewPage, "getManagedSettings");
    await simulateHostMessage(webviewPage, {
      command: "managedSettingsResponse",
      requestId: request.requestId,
      managedSettings,
    });

    await expect(
      webviewPage.getByTestId("settings-managed-json"),
    ).toBeVisible();

    const view = webviewPage.locator(".settings-page");
    await elementScreenshotWebp(
      view,
      "../../docs/public/screenshots/spec-managed-settings.webp",
    );
  });
});
