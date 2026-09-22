import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { elementScreenshotWebp } from "../e2e/utils/screenshot.js";
import {
  openSettings,
  simulateHostMessage,
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

/**
 * 「全局设置」「个性化」选项卡的 IDE 侧画面（vsce.md 画廊「配置管理」）：两者由
 * 共享 webview 渲染，桌面端只是多一个「桌面端设置」区块（IDE 侧不渲染）。
 */

const userPreferences = {
  language: "zh-CN",
  contextLength: 200,
  autoMemoryEnabled: true,
  autoMemoryFrequency: 1,
};

test.describe("设置页全局设置选项卡 Demo", () => {
  test("should show base settings with effective values", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      settingsState: { workdir: "/work/wave-agent", nav: "global" },
      configurationData: {
        ...userPreferences,
        preferenceSources: {
          language: "user",
          contextLength: "user",
          autoMemoryEnabled: "user",
          autoMemoryFrequency: "user",
        },
      },
    });

    await expect(
      webviewPage.getByRole("heading", { name: "全局设置" }),
    ).toBeVisible();
    await expect(webviewPage.getByLabel("AI 回复语言")).toHaveValue("zh-CN");
    await expect(webviewPage.getByLabel("上下文长度")).toHaveValue("200");

    await elementScreenshotWebp(
      webviewPage.locator(".settings-section").filter({ hasText: "基础设置" }),
      "../../docs/public/screenshots/spec-settings-global.webp",
    );
  });
});

test.describe("设置页个性化选项卡 Demo", () => {
  test("should show AGENTS.md editor and auto-memory rules", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      // 该视图比默认视口高（AGENTS.md 编辑器 + 自动记忆卡片），加高避免截断
      height: 900,
      settingsState: { workdir: "/work/wave-agent", nav: "personalization" },
      configurationData: {
        ...userPreferences,
        preferenceSources: {
          language: "user",
          contextLength: "user",
          autoMemoryEnabled: "user",
          autoMemoryFrequency: "user",
        },
      },
    });
    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "user",
      content: "# 用户级规则\n\n- 回答使用中文\n- 修改文件前先读一遍\n",
    });

    await expect(
      webviewPage.getByRole("heading", { name: "个性化" }),
    ).toBeVisible();
    await expect(
      webviewPage.getByRole("tab", { name: "用户级" }),
    ).toBeVisible();
    await expect(webviewPage.getByLabel("用户级 AGENTS.md 内容")).toHaveValue(
      /回答使用中文/,
    );
    await expect(webviewPage.getByLabel("开启自动记忆")).toBeChecked();
    await expect(webviewPage.getByLabel("触发记忆提取会话轮次")).toHaveValue(
      "1",
    );
    await expect(
      webviewPage.locator(".settings-row", { hasText: "开启自动记忆" }),
    ).toBeInViewport();

    await elementScreenshotWebp(
      webviewPage.locator(".settings-page"),
      "../../docs/public/screenshots/spec-settings-personalization.webp",
    );
  });
});
