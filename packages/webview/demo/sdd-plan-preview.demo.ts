import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { EXIT_PLAN_MODE_TOOL_NAME, type Message } from "wave-agent-sdk";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

const DIR_A = "/Users/dev/projects/wave-agent";

test.describe("SDD Plan Preview Screenshot", () => {
  test("capture plan pane + compact ExitPlanMode confirmation", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      configurationData: {
        apiKey: "sk-ant-api03-CXB9pH2k...mH8wQz",
        baseURL: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
        fastModel: "claude-haiku-4-20250514",
      },
      permissionMode: "default",
    });

    // SDD 流程推进到 plan 阶段：需求 → 规格确认 → 进入 plan 模式 → 方案产出
    const messages: Message[] = [
      {
        id: "msg_plan_user",
        role: "user",
        timestamp: "2025-07-10T09:00:00.000Z",
        blocks: [
          {
            type: "text",
            content:
              "我们想做一个客户管理系统（CRM），核心是客户档案、跟进记录、合同管理和数据看板，帮我按规格优先的流程来推进。",
          },
        ],
      },
      {
        id: "msg_plan_spec_ok",
        role: "user",
        timestamp: "2025-07-10T09:00:08.000Z",
        blocks: [
          {
            type: "text",
            content: "规格确认通过，进入 plan 模式制定技术方案吧。",
          },
        ],
      },
      {
        id: "msg_plan_ready",
        role: "assistant",
        timestamp: "2025-07-10T09:00:15.000Z",
        blocks: [
          {
            type: "text",
            content: "技术方案已制定完成，展示在右侧计划面板中，请审阅后批准。",
          },
        ],
      },
    ];
    await injector.updateMessages(messages);

    // ExitPlanMode：方案正文路由到右侧 Plan 面板，确认框保持紧凑（仅批准交互）
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-plan-preview-approve",
      confirmationType: "计划执行确认",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      planContent: `## 客户管理系统技术方案

**技术选型**：React 18 + TypeScript + Vite；Node.js + Fastify + PostgreSQL；JWT + RBAC 认证

**架构设计**：客户档案 / 跟进记录 / 合同管理 / 数据看板四模块；customers、follow_ups、contracts 三张核心表

**实现步骤**：工程骨架 → 客户档案 CRUD → 跟进时间线 → 合同与到期提醒 → 数据看板`,
    });

    // 计划面板自动打开，确认框弹出
    await expect(webviewPage.getByTestId("plan-pane")).toBeVisible();
    await expect(webviewPage.getByTestId("plan-pane-content")).toContainText(
      "客户管理系统技术方案",
    );
    const planDialog = webviewPage.locator(".confirmation-dialog");
    await planDialog.waitFor({ state: "visible" });
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-sdd-plan-preview.webp",
    );
    await webviewPage.keyboard.press("Escape");
    await planDialog.waitFor({ state: "detached" });
  });
});
