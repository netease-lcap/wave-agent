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

/**
 * 「全局设置」「个性化」选项卡的 IDE 侧画面（vsce.md 画廊「配置管理」）：两者由
 * 共享 webview 渲染，桌面端只是多一个「桌面端设置」区块（IDE 侧不渲染）。
 * 全局设置只截「基础设置」区块——整页视角已由上面的「服务端配置」用例覆盖。
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
    // 服务端未下发：区块显示空态说明（加载态文案不该进截图），本用例只截
    // 「基础设置」区块，但页面整体仍保持自洽。
    const request = await waitForSentCommand(webviewPage, "getManagedSettings");
    await simulateHostMessage(webviewPage, {
      command: "managedSettingsResponse",
      requestId: request.requestId,
      managedSettings: null,
    });

    await expect(
      webviewPage.getByRole("heading", { name: "全局设置" }),
    ).toBeVisible();
    await expect(webviewPage.getByLabel("AI 回复语言")).toHaveValue("zh-CN");
    await expect(webviewPage.getByLabel("上下文长度")).toHaveValue("200");

    await elementScreenshotWebp(
      webviewPage
        .locator(".settings-section")
        .filter({ hasText: "基础设置" }),
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
