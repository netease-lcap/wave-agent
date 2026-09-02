import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { AGENT_TOOL_NAME, type Message } from "wave-agent-sdk";
import {
  screenshotWebp,
  elementScreenshotWebp,
} from "../e2e/utils/screenshot.js";

// Desktop 2.6 任务管理 / 2.7 多Agent与并发 / 2.8 SubAgent / 2.11 工作流
// screenshots — all captured inside the desktop layout.
const DIR_A = "/Users/dev/projects/wave-agent";

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

/** Single-pane desktop layout; optionally seeds messages via setInitialState. */
async function setup(
  webviewPage: Parameters<typeof screenshotWebp>[0],
  injector: MessageInjector,
  messages: unknown[] = [],
) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
    host: "local",
    hosts: ["local"],
  });
  await injector.waitForChatAppReady();
  await seedSidebarSessions(injector, DIR_A, [
    { sessionId: "s-ta-1", title: "后台调研支付网关兼容性", running: true },
    {
      sessionId: "s-ta-2",
      title: "审查提现流程边界条件",
      waitingConfirmation: true,
    },
    {
      sessionId: "s-ta-3",
      title: "重构支付模块并发处理",
      hasWorktree: true,
    },
  ]);
  await injector.simulateExtensionMessage("setInitialState", {
    ...baseConfig,
    messages,
  });
  await webviewPage.waitForSelector('[data-testid="message-input"]', {
    state: "visible",
  });
}

test.describe("Desktop 任务/多Agent/工作流 screenshots", () => {
  test("2.6 2) 后台任务通知", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    const messages: Message[] = [
      MockDataGenerator.createUserMessage(
        "在后台调研支付网关的兼容性，同时并行审查提现流程的边界条件，我们先继续重构其他模块。",
        "msg_user_bg",
      ),
      {
        id: "msg_bg_running",
        role: "assistant",
        timestamp: "2025-07-09T10:32:00.000Z",
        blocks: [
          {
            type: "tool",
            name: AGENT_TOOL_NAME,
            stage: "end",
            success: true,
            compactParams: "general-purpose: 调研支付网关的兼容性（后台运行）",
            parameters: JSON.stringify({
              subagent_type: "general-purpose",
              description: "调研支付网关的兼容性",
              prompt: "...",
              run_in_background: true,
            }),
            shortResult:
              "Agent started in background: task-agent-003 → /tmp/task-agent-003.log",
          },
        ],
      },
      {
        id: "msg_bg_notify",
        role: "user",
        isMeta: true,
        timestamp: "2025-07-09T10:35:00.000Z",
        blocks: [
          {
            type: "task_notification",
            taskId: "task-agent-003",
            taskType: "agent",
            status: "completed",
            summary:
              "后台调研完成：支付网关兼容性分析报告已生成，支持 Stripe / PayPal / 支付宝三种网关，建议优先接入 Stripe。",
          },
        ],
      },
      {
        id: "msg_bg_report",
        role: "assistant",
        timestamp: "2025-07-09T10:35:01.000Z",
        blocks: [
          {
            type: "text",
            content:
              "后台调研已完成：支持 Stripe / PayPal / 支付宝三种网关，建议优先接入 Stripe。",
          },
        ],
      },
    ];
    await setup(webviewPage, injector, messages);
    await webviewPage.waitForSelector(".tool-container");
    await expect(webviewPage.getByText("后台调研已完成")).toBeVisible();
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-background-notification.webp",
    );
  });

  test("2.6 4) 后台任务管理对话框", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 720 });
    await setup(webviewPage, injector);

    await injector.simulateExtensionMessage("showDialog", {
      dialogType: "tasks",
    });
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [
        {
          id: "bt-1",
          type: "shell",
          status: "running",
          startTime: Date.now() - 45000,
          command: "npm run build",
          description: "构建 monorepo",
          runtime: 45000,
          outputPath: "/tmp/wave-task-bt-1.log",
        },
        {
          id: "bt-2",
          type: "subagent",
          status: "completed",
          startTime: Date.now() - 120000,
          endTime: Date.now() - 80000,
          description: "探索 packages/webview 结构",
          runtime: 40000,
          exitCode: 0,
          outputPath: "/tmp/wave-task-bt-2.log",
        },
        {
          id: "bt-3",
          type: "shell",
          status: "failed",
          startTime: Date.now() - 200000,
          endTime: Date.now() - 195000,
          command: "npm test",
          description: "运行测试套件",
          runtime: 5000,
          exitCode: 1,
          outputPath: "/tmp/wave-task-bt-3.log",
        },
      ],
    });
    await expect(
      webviewPage.getByTestId("background-task-manager"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-background-tasks.webp",
    );
  });

  test("2.7 2) 并发使用子代理", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    const messages: Message[] = [
      MockDataGenerator.createUserMessage(
        "请同时做三件事：1) 梳理支付模块的代码结构；2) 审查分布式事务中的竞态条件；3) 盘点测试覆盖缺口。",
        "msg_user_conc",
      ),
      {
        id: "msg_conc",
        role: "assistant",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [
          {
            type: "tool",
            name: AGENT_TOOL_NAME,
            stage: "running",
            compactParams: "Explore: 梳理支付模块的代码结构",
            parameters: JSON.stringify({
              subagent_type: "Explore",
              description: "梳理支付模块的代码结构",
              prompt: "...",
            }),
            shortResult: "...Read, Grep (2 tools | 3,421 tokens)",
          },
          {
            type: "tool",
            name: AGENT_TOOL_NAME,
            stage: "running",
            compactParams: "general-purpose: 审查分布式事务中的竞态条件",
            parameters: JSON.stringify({
              subagent_type: "general-purpose",
              description: "审查分布式事务中的竞态条件",
              prompt: "...",
            }),
            shortResult: "...Read, Bash (3 tools | 5,120 tokens)",
          },
          {
            type: "tool",
            name: AGENT_TOOL_NAME,
            stage: "running",
            compactParams: "plan: 盘点测试覆盖缺口",
            parameters: JSON.stringify({
              subagent_type: "plan",
              description: "盘点测试覆盖缺口",
              prompt: "...",
            }),
            shortResult: "...Glob, Grep (2 tools | 2,048 tokens)",
          },
        ],
      },
    ];
    await setup(webviewPage, injector, messages);
    await webviewPage.waitForSelector(".tool-container");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-subagent-concurrency.webp",
    );
  });

  test("2.7 3) 并排多对话", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
      host: "local",
      hosts: ["local"],
    });
    await injector.waitForChatAppReady();

    // Two side-by-side panes, driven by the host-authoritative desktopPanes.
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [
        { paneId: "pane-a", sessionId: "sess-a" },
        { paneId: "pane-b", sessionId: "sess-b" },
      ],
      focusedPaneId: "pane-a",
    });
    // Wait for both pane ChatApps to mount their message listeners before
    // pushing per-pane snapshots — otherwise the first setInitialState is
    // dropped (listener not yet attached) and the pane stays on the welcome
    // page, breaking the two-conversation screenshot.
    await expect(webviewPage.getByTestId("desktop-pane-pane-a")).toBeVisible();
    await expect(webviewPage.getByTestId("desktop-pane-pane-b")).toBeVisible();
    // Initialize each pane (paneId-routed payloads).
    await injector.simulateExtensionMessage("setInitialState", {
      ...baseConfig,
      paneId: "pane-a",
      messages: [
        MockDataGenerator.createUserMessage(
          "帮我修复登录页的样式问题",
          "msg_a1",
        ),
        MockDataGenerator.createAssistantMessage(
          "我先看一下登录页组件的样式文件，找出对齐问题的原因。",
          "msg_a2",
        ),
      ],
    });
    await injector.simulateExtensionMessage("setInitialState", {
      ...baseConfig,
      paneId: "pane-b",
      messages: [
        MockDataGenerator.createUserMessage(
          "梳理一下支付模块的代码结构",
          "msg_b1",
        ),
        MockDataGenerator.createAssistantMessage(
          "好的，我通过 Explore 子代理梳理支付模块的目录与接口定义。",
          "msg_b2",
        ),
      ],
    });
    await expect(
      webviewPage.locator('[data-testid="message-input"]'),
    ).toHaveCount(2);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-split-panes.webp",
    );
  });

  test("2.8 2) 自动委派子代理", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    const messages: Message[] = [
      MockDataGenerator.createUserMessage(
        "帮我查一下项目里所有支付相关的 API 定义在哪",
        "msg_user_subagent",
      ),
      {
        id: "msg_subagent",
        role: "assistant",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [
          {
            type: "tool",
            name: AGENT_TOOL_NAME,
            stage: "running",
            compactParams: "Explore: 查找所有支付相关 API 定义",
            parameters: JSON.stringify({
              subagent_type: "Explore",
              description: "查找所有支付相关 API 定义",
              prompt: "...",
            }),
            shortResult: "...Read, Grep (2 tools | 3,421 tokens)",
          },
        ],
      },
    ];
    await setup(webviewPage, injector, messages);
    await webviewPage.waitForSelector(".tool-container");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-subagent.webp",
    );
  });

  test("2.11 2) 工作流管理", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 720 });
    await setup(webviewPage, injector);

    await injector.simulateExtensionMessage("showDialog", {
      dialogType: "workflows",
    });
    await injector.simulateExtensionMessage("updateWorkflowRuns", {
      runs: [
        {
          runId: "run-abc12345-def67890",
          meta: {
            name: "audit-and-fix",
            description: "审查并修复测试与类型错误",
            phases: [
              { title: "Scan", detail: "grep 测试日志查找重试" },
              { title: "Fix", detail: "每个 flaky 测试派一个代理" },
            ],
          },
          status: "running",
          scriptPath: "/workflows/find-flaky-tests.mjs",
          startTime: Date.now() - 120000,
          phases: [
            {
              title: "Scan",
              agentCount: 4,
              tokens: 18500,
              elapsed: 45000,
              startTime: Date.now() - 120000,
            },
            {
              title: "Fix",
              agentCount: 3,
              tokens: 31200,
              elapsed: 75000,
              startTime: Date.now() - 75000,
            },
          ],
          totalAgents: 7,
          totalTokens: 49700,
        },
        {
          runId: "run-98765432-fedcba10",
          meta: {
            name: "migrate-config",
            description: "迁移配置到新格式",
          },
          status: "completed",
          scriptPath: "/workflows/migrate.mjs",
          startTime: Date.now() - 600000,
          endTime: Date.now() - 480000,
          phases: [
            {
              title: "Discover",
              agentCount: 2,
              tokens: 8400,
              elapsed: 60000,
              startTime: Date.now() - 600000,
            },
            {
              title: "Transform",
              agentCount: 5,
              tokens: 22600,
              elapsed: 60000,
              startTime: Date.now() - 540000,
            },
          ],
          totalAgents: 7,
          totalTokens: 31000,
        },
      ],
    });
    await expect(webviewPage.getByTestId("workflow-manager")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-workflow-manager.webp",
    );
  });
});
