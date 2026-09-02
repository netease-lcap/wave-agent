import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

/**
 * Desktop settings full-page manage views (技能 / 子代理 / 钩子 / MCP 服务):
 * opens the settings page from the account card and screenshots each 4-tab
 * manage view with host data injected. The shared webview bundle must be
 * rebuilt first (node esbuild.config.mjs) or these shots capture the old UI.
 */
const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/web-dashboard";

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

/** Single-pane desktop layout with one conversation in progress. */
async function setupSinglePane(injector: MessageInjector) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A, DIR_B],
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
}

test.describe("Desktop settings manage views screenshots", () => {
  test("skills / subagents / hooks / mcp settings views", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1000, height: 720 });
    await setupSinglePane(injector);

    // 账户卡片：注入登录态与用量信息，使卡片「更多」菜单可用
    await injector.simulateExtensionMessage("desktopAccountInfo", {
      isAuthenticated: true,
      user: { id: "user-1", email: "alice@example.com" },
      plan: { monthlyQuota: 100, months: 12, used: 240 },
      apiQuota: { limit: null, used: 1153.14 },
      update: undefined,
    });
    await expect(webviewPage.getByTestId("account-card")).toBeVisible();

    // 打开设置页：账户卡片「更多」→「设置」→ 全页设置
    await webviewPage.getByTestId("account-card-more").click();
    await webviewPage.getByTestId("more-menu-settings").click();
    await expect(
      webviewPage.getByRole("heading", { name: "全局设置" }),
    ).toBeVisible();

    // ── 0. 项目设置：SDD 内置插件开关 ──
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
    // 等待开关 0.2s 过渡完成，避免截图停在过渡起始态（视觉关闭）
    await webviewPage.waitForTimeout(500);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-project.webp",
    );

    // ── 1. 技能：4 个来源 Tab，切到「项目技能」展示项目分组卡片 ──
    await webviewPage.getByRole("button", { name: "技能" }).click();
    await expect(webviewPage.getByText("插件技能")).toBeVisible();
    await injector.simulateExtensionMessage("skillMetadataResponse", {
      skills: [
        {
          name: "deep-research",
          description: "深度研究：并行检索并交叉验证信息源，产出带引用的报告",
          type: "builtin",
          skillPath: "/builtin/skills/deep-research.md",
          allowedTools: ["WebFetch", "Grep"],
          userInvocable: true,
        },
        {
          name: "sdd:specify",
          description: "根据自然语言描述创建或更新功能规格说明",
          type: "builtin",
          skillPath: "/plugins/sdd/skills/specify.md",
          pluginName: "sdd",
          userInvocable: true,
        },
        {
          name: "deploy",
          description: "部署检查技能：验证构建产物与发布清单",
          type: "project",
          skillPath: `${DIR_A}/.wave/skills/deploy/SKILL.md`,
          userInvocable: true,
        },
        {
          name: "code-review",
          description: "项目级代码评审技能",
          type: "project",
          skillPath: `${DIR_A}/.wave/skills/code-review/SKILL.md`,
          userInvocable: true,
        },
      ],
    });
    await webviewPage.getByText("项目技能", { exact: true }).click();
    // 单项目模型：平铺展示（无项目分组卡片名），/技能名 样式
    await expect(
      webviewPage.getByText("/deploy", { exact: true }),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-skills.webp",
    );

    // ── 2. 子代理：4 个来源 Tab，默认「插件子代理」列表 ──
    await webviewPage.getByRole("button", { name: "子代理" }).click();
    await expect(webviewPage.getByText("插件子代理")).toBeVisible();
    await injector.simulateExtensionMessage("subagentConfigurationsResponse", {
      configurations: [
        {
          name: "Explore",
          description:
            "Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns, search code for keywords, or answer questions about the codebase.",
          model: "glm-5.2",
          tools: ["Glob", "Grep", "Read", "Bash", "LSP"],
          filePath: "/builtin/subagents/explore.md",
          scope: "builtin",
          priority: 0,
        },
        {
          name: "code-review",
          description: "代码评审助手，检查潜在缺陷、类型错误与改进点",
          model: "deepseek-v4-flash",
          tools: ["Bash", "Read", "Grep"],
          filePath: "~/.wave/agents/code-review.md",
          scope: "user",
          priority: 0,
        },
        {
          name: "sdd:specify",
          description: "根据自然语言描述创建或更新功能规格说明",
          model: "glm-5.2",
          tools: ["Read", "Write"],
          filePath: "/plugins/sdd/agents/specify.md",
          scope: "plugin",
          priority: 0,
          pluginRoot: "/plugins/sdd",
        },
      ],
    });
    await expect(webviewPage.getByText("sdd:specify")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-subagents.webp",
    );

    // ── 3. 钩子：3 个来源 Tab，默认「用户级钩子」列表 + 事件摘要 ──
    await webviewPage.getByRole("button", { name: "钩子" }).click();
    await expect(webviewPage.getByText("用户级钩子")).toBeVisible();
    await injector.simulateExtensionMessage("hooksResponse", {
      hooks: {
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
      },
      configPath: "~/.wave/settings.json",
    });
    await expect(webviewPage.getByText("PreToolUse:Write")).toBeVisible();
    await expect(webviewPage.getByText("工具执行前").first()).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-hooks.webp",
    );

    // ── 4. MCP 服务：3 个来源 Tab，默认「用户级 MCP」连接状态 ──
    await webviewPage.getByRole("button", { name: "MCP 服务" }).click();
    await expect(
      webviewPage.getByRole("tab", { name: "用户级 MCP" }),
    ).toBeVisible();
    await injector.simulateExtensionMessage("mcpServersResponse", {
      servers: [
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
      ],
    });
    await injector.simulateExtensionMessage("mcpConfigPathsResponse", {
      userPath: "~/.wave/mcp.json",
      projectPath: null,
    });
    await expect(webviewPage.getByText("jira", { exact: true })).toBeVisible();
    await expect(webviewPage.getByText("8 tools")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-mcp.webp",
    );
  });
});
