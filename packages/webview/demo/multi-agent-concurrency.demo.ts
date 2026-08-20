import { test } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import {
  AGENT_TOOL_NAME,
  ENTER_WORKTREE_TOOL_NAME,
  type Message,
} from "wave-agent-sdk";
import { elementScreenshotWebp } from "../e2e/utils/screenshot.js";

test.describe("Product Specification Screenshots - Multi Agent Concurrency", () => {
  test("capture multi-agent concurrency features", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Simulate VS Code sidebar viewport
    await webviewPage.setViewportSize({ width: 400, height: 800 });

    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      configurationData: {
        apiKey: "sk-ant-api03-CXB9pH2k...mH8wQz",
        baseURL: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
        fastModel: "claude-haiku-4-20250514",
      },
      permissionMode: "default",
    });

    // 1. Subagent concurrency - one user message triggers 3 parallel Agent tool blocks
    const subagentConcurrencyMessages: Message[] = [
      MockDataGenerator.createUserMessage(
        "请同时做三件事：1) 梳理支付模块的代码结构；2) 审查分布式事务中的竞态条件；3) 盘点测试覆盖缺口。",
        "msg_user_subagent_concurrency",
      ),
      {
        id: "msg_demo_subagent_concurrency",
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
    await injector.updateMessages(subagentConcurrencyMessages);
    await webviewPage.waitForSelector(".tool-container");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/spec-subagent-concurrency.webp",
    );

    // 2. Worktree isolation - natural language triggers EnterWorktree tool
    const worktreeMessages: Message[] = [
      MockDataGenerator.createUserMessage(
        "把支付模块的重构放到独立的 worktree 里做，避免影响主线。",
        "msg_user_worktree",
      ),
      {
        id: "msg_demo_worktree",
        role: "assistant",
        timestamp: "2025-07-09T10:31:00.000Z",
        blocks: [
          {
            type: "tool",
            name: ENTER_WORKTREE_TOOL_NAME,
            stage: "end",
            compactParams: "pay-refactor",
            parameters: JSON.stringify({ name: "pay-refactor" }),
            result:
              "Created worktree at /home/dev/projects/nebula-platform/.wave/worktrees/pay-refactor on branch worktree-pay-refactor. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.",
          },
        ],
      },
    ];
    await injector.updateMessages(worktreeMessages);
    await webviewPage.waitForSelector(".tool-container");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/spec-worktree-enter.webp",
    );

    // 3. Background subagents - user prompt example + 2 parallel Agent tool blocks (running in background) + completion notifications
    const backgroundSubagentMessages: Message[] = [
      MockDataGenerator.createUserMessage(
        "在后台调研支付网关的兼容性，同时并行审查提现流程的边界条件，我们先继续重构其他模块。",
        "msg_user_background_subagent",
      ),
      {
        id: "msg_demo_background_subagent_running",
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
          {
            type: "tool",
            name: AGENT_TOOL_NAME,
            stage: "end",
            success: true,
            compactParams:
              "general-purpose: 审查提现流程的边界条件（后台运行）",
            parameters: JSON.stringify({
              subagent_type: "general-purpose",
              description: "审查提现流程的边界条件",
              prompt: "...",
              run_in_background: true,
            }),
            shortResult:
              "Agent started in background: task-agent-004 → /tmp/task-agent-004.log",
          },
        ],
      },
      {
        // Notification is a meta message: hidden from UI, visible to the model
        id: "msg_demo_background_subagent_notify",
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
          {
            type: "task_notification",
            taskId: "task-agent-004",
            taskType: "agent",
            status: "completed",
            summary:
              "后台审查完成：提现流程在金额为 0、余额不足、重复提交三类边界条件下存在缺陷，已生成修复建议。",
          },
        ],
      },
      {
        // Model's summary of the completed background tasks (what the user sees)
        id: "msg_demo_background_subagent_report",
        role: "assistant",
        timestamp: "2025-07-09T10:35:01.000Z",
        blocks: [
          {
            type: "text",
            content:
              "两个后台任务都已完成：\n1. 支付网关兼容性分析：支持 Stripe / PayPal / 支付宝三种网关，建议优先接入 Stripe。\n2. 提现流程边界审查：金额为 0、余额不足、重复提交三类场景存在缺陷，修复建议已生成。",
          },
        ],
      },
    ];
    await injector.updateMessages(backgroundSubagentMessages);
    await webviewPage.waitForSelector("text=两个后台任务都已完成");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/spec-background-subagent.webp",
    );
  });
});
