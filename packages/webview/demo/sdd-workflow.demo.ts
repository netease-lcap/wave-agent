import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  type Message,
  type Task,
} from "wave-agent-sdk";
import {
  screenshotWebp,
  elementScreenshotWebp,
} from "../e2e/utils/screenshot.js";

test.describe("SDD Workflow Screenshots", () => {
  test("capture spec-first workflow stages with mock data", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 400, height: 800 });

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

    // ---- Stage 1: specification writing ----
    const userMessage: Message = {
      id: "msg_sdd_user",
      role: "user",
      timestamp: "2025-07-10T09:00:00.000Z",
      blocks: [
        {
          type: "text",
          content:
            "我们想做一个客户管理系统（CRM），核心是客户档案、跟进记录、合同管理和数据看板，帮我按规格优先的流程来推进。",
        },
      ],
    };
    const specReply: Message = {
      id: "msg_sdd_spec",
      role: "assistant",
      timestamp: "2025-07-10T09:00:02.000Z",
      blocks: [
        {
          type: "text",
          content:
            "好的，我先编写功能规格说明 `docs/specs/crm/customer-management.md`。\n\n**核心模块：**\n- 客户档案：分级管理、联系人、标签\n- 跟进记录：时间线、下次跟进提醒\n- 合同管理：合同关联、到期提醒\n- 数据看板：销售漏斗、转化统计\n\n规格共 4 个用户故事、12 个验收场景，稍后请你确认。",
        },
      ],
    };
    await injector.updateMessages([userMessage, specReply]);

    // 任务列表：规格编写进行中
    await injector.simulateExtensionMessage("updateTasks", {
      tasks: [
        {
          id: "1",
          subject: "编写功能规格",
          description: "编写客户管理系统的功能规格说明",
          status: "in_progress",
          blocks: [],
          blockedBy: [],
          metadata: {},
        },
      ],
    });
    await expect(webviewPage.getByTestId("task-list")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-sdd-workflow-spec.webp",
    );

    // ---- Stage 2: spec confirmation via AskUserQuestion ----
    const confirmMsg: Message = {
      id: "msg_sdd_confirm",
      role: "assistant",
      timestamp: "2025-07-10T09:00:05.000Z",
      blocks: [
        {
          type: "tool",
          name: ASK_USER_QUESTION_TOOL_NAME,
          stage: "running",
          parameters: JSON.stringify({
            questions: [
              {
                header: "规格确认",
                question:
                  "功能规格《客户管理系统》已完成（4 个用户故事、12 个验收场景），是否确认？",
                options: [
                  {
                    label: "确认通过",
                    description: "规格确认通过，继续后续阶段",
                  },
                  {
                    label: "需要修改",
                    description: "按你的反馈更新规格后重新确认",
                  },
                ],
              },
            ],
          }),
        },
      ],
    };
    await injector.updateMessages([userMessage, specReply, confirmMsg]);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-confirm-spec",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "问题待回答",
      toolInput: {
        questions: [
          {
            header: "规格确认",
            question:
              "功能规格《客户管理系统》已完成（4 个用户故事、12 个验收场景），是否确认？",
            options: [
              { label: "确认通过", description: "规格确认通过，继续后续阶段" },
              {
                label: "需要修改",
                description: "按你的反馈更新规格后重新确认",
              },
            ],
          },
        ],
      },
    });
    const specDialog = webviewPage.locator(".confirmation-dialog");
    await specDialog.waitFor({ state: "visible" });
    await elementScreenshotWebp(
      specDialog,
      "../../docs/public/screenshots/spec-sdd-confirm-spec.webp",
    );
    await webviewPage.keyboard.press("Escape");
    await specDialog.waitFor({ state: "detached" });

    // ---- Stage 3: optional prototype question ----
    const protoMsg: Message = {
      id: "msg_sdd_proto",
      role: "assistant",
      timestamp: "2025-07-10T09:00:08.000Z",
      blocks: [
        {
          type: "tool",
          name: ASK_USER_QUESTION_TOOL_NAME,
          stage: "running",
          parameters: JSON.stringify({
            questions: [
              {
                header: "原型阶段",
                question:
                  "规格已确认。是否需要先制作交互原型？原型仅实现前端界面，数据使用 mock。",
                options: [
                  {
                    label: "制作原型",
                    description: "先产出可交互前端原型（mock 数据）",
                  },
                  {
                    label: "跳过",
                    description: "不制作原型，直接进入下一阶段",
                  },
                ],
              },
            ],
          }),
        },
      ],
    };
    await injector.updateMessages([userMessage, specReply, protoMsg]);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-confirm-prototype",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "问题待回答",
      toolInput: {
        questions: [
          {
            header: "原型阶段",
            question:
              "规格已确认。是否需要先制作交互原型？原型仅实现前端界面，数据使用 mock。",
            options: [
              {
                label: "制作原型",
                description: "先产出可交互前端原型（mock 数据）",
              },
              { label: "跳过", description: "不制作原型，直接进入下一阶段" },
            ],
          },
        ],
      },
    });
    const protoDialog = webviewPage.locator(".confirmation-dialog");
    await protoDialog.waitFor({ state: "visible" });
    await elementScreenshotWebp(
      protoDialog,
      "../../docs/public/screenshots/spec-sdd-confirm-prototype.webp",
    );
    await webviewPage.keyboard.press("Escape");
    await protoDialog.waitFor({ state: "detached" });

    // ---- Stage 4: optional plan question ----
    const planMsg: Message = {
      id: "msg_sdd_plan",
      role: "assistant",
      timestamp: "2025-07-10T09:00:11.000Z",
      blocks: [
        {
          type: "tool",
          name: ASK_USER_QUESTION_TOOL_NAME,
          stage: "running",
          parameters: JSON.stringify({
            questions: [
              {
                header: "技术方案",
                question: "原型已完成。是否进入 plan 模式制定技术方案？",
                options: [
                  {
                    label: "进入 plan 模式",
                    description: "制定技术选型、架构设计与实现步骤后请你批准",
                  },
                  {
                    label: "跳过",
                    description: "不制定技术方案，直接开始编码",
                  },
                ],
              },
            ],
          }),
        },
      ],
    };
    await injector.updateMessages([userMessage, specReply, planMsg]);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-confirm-plan",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "问题待回答",
      toolInput: {
        questions: [
          {
            header: "技术方案",
            question: "原型已完成。是否进入 plan 模式制定技术方案？",
            options: [
              {
                label: "进入 plan 模式",
                description: "制定技术选型、架构设计与实现步骤后请你批准",
              },
              { label: "跳过", description: "不制定技术方案，直接开始编码" },
            ],
          },
        ],
      },
    });
    const planDialog = webviewPage.locator(".confirmation-dialog");
    await planDialog.waitFor({ state: "visible" });
    await elementScreenshotWebp(
      planDialog,
      "../../docs/public/screenshots/spec-sdd-confirm-plan.webp",
    );
    await webviewPage.keyboard.press("Escape");
    await planDialog.waitFor({ state: "detached" });

    // ---- Stage 5: plan approval (ExitPlanMode) ----
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-plan-approve",
      confirmationType: "计划执行确认",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      planContent: `## 客户管理系统技术方案

**技术选型**：React 18 + TypeScript + Vite；Node.js + Fastify + PostgreSQL；JWT + RBAC 认证

**架构设计**：客户档案 / 跟进记录 / 合同管理 / 数据看板四模块；customers、follow_ups、contracts 三张核心表

**实现步骤**：工程骨架 → 客户档案 CRUD → 跟进时间线 → 合同与到期提醒 → 数据看板`,
    });
    const planApproveDialog = webviewPage.locator(".confirmation-dialog");
    await planApproveDialog.waitFor({ state: "visible" });
    await elementScreenshotWebp(
      planApproveDialog,
      "../../docs/public/screenshots/spec-sdd-plan-approve.webp",
    );
    await webviewPage.keyboard.press("Escape");
    await planApproveDialog.waitFor({ state: "detached" });

    // ---- Stage 6: coding stage with full task progress ----
    const codingReply: Message = {
      id: "msg_sdd_coding",
      role: "assistant",
      timestamp: "2025-07-10T09:00:20.000Z",
      blocks: [
        {
          type: "text",
          content:
            "技术方案已批准，开始编码。先搭建前后端工程骨架，然后按模块依次实现：客户档案 → 跟进记录 → 合同管理 → 数据看板。",
        },
      ],
    };
    const codeUserMessage: Message = {
      id: "msg_sdd_code_user",
      role: "user",
      timestamp: "2025-07-10T09:00:18.000Z",
      blocks: [
        {
          type: "text",
          content: "规格、原型和技术方案都确认了，开始实现吧。",
        },
      ],
    };
    await injector.updateMessages([
      userMessage,
      specReply,
      codeUserMessage,
      codingReply,
    ]);
    const stageTasks: Task[] = [
      {
        id: "1",
        subject: "编写功能规格",
        description: "编写客户管理系统的功能规格说明",
        status: "completed",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "2",
        subject: "制作交互原型",
        description: "仅前端界面 + mock 数据",
        status: "completed",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "3",
        subject: "制定技术方案",
        description: "技术选型、架构设计与实现步骤",
        status: "completed",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "4",
        subject: "实现功能",
        description: "按规格与方案实现客户管理系统",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ];
    await injector.simulateExtensionMessage("updateTasks", {
      tasks: stageTasks,
    });
    await expect(webviewPage.getByTestId("task-list")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-sdd-tasklist-progress.webp",
    );
  });
});
