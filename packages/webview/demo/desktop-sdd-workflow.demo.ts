import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
  type Message,
  type Task,
} from "wave-agent-sdk";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Desktop SDD workflow (tutorials.md 三、SDD开发案例): the full
// spec → plan → coding flow captured inside the desktop layout, using the
// desktop panel capabilities — spec file previewed in the file panel, the
// plan shown in the plan panel, and spec edits reviewed in the diff panel.
const DIR_A = "/Users/dev/projects/wave-agent";
const SPEC_FILE = "docs/specs/crm/customer-management.md";
const SPEC_FULL_PATH = `${DIR_A}/${SPEC_FILE}`;

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
  await injector.simulateExtensionMessage("setInitialState", {
    ...baseConfig,
    messages,
  });
  await webviewPage.waitForSelector('[data-testid="message-input"]', {
    state: "visible",
  });
}

// The spec file written by the agent (mirrors the Write tool content).
const SPEC_CONTENT = `---
name: 客户管理系统
description: 客户档案、跟进记录、合同管理与数据看板的统一规格说明
order: 1
---

# 客户管理系统功能规格

## 用户故事

- P1 客户档案管理：作为销售，我希望维护客户档案（标签手动维护），以便集中管理客户信息
- P2 跟进记录：作为销售，我希望记录跟进时间线，以便掌握客户沟通进展
- P2 合同管理：作为销售，我希望管理合同信息，以便跟踪合同状态
- P2 数据看板：作为管理者，我希望查看销售漏斗，以便了解转化情况

## 验收场景

- SC-01 客户档案：支持新建、编辑、删除客户，字段包含名称、等级、标签、归属销售
- SC-02 客户档案：标签支持手动维护，按客户分组展示
- SC-03 跟进记录：记录跟进时间线，支持下次跟进提醒
- SC-04 合同管理：合同关联客户，到期自动提醒
- SC-05 数据看板：销售漏斗按阶段统计转化率
- SC-06 数据看板：转化统计按天、周、月聚合`;

// The CRM technical plan shown in the plan panel (ExitPlanMode content).
const PLAN_CONTENT = `# 客户管理系统（CRM）技术方案

## 1. 项目背景与目标

本系统面向销售团队核心业务场景，旨在解决客户信息分散、跟进过程不可追溯、合同与客户数据割裂等问题。通过统一客户档案、跟进记录、合同管理与数据看板，建立以客户为中心的运营闭环，提升销售转化率与管理效率。

## 2. 需求范围

- 客户档案：客户分级、联系人管理、行为标签
- 跟进记录：跟进时间线、下次跟进提醒
- 合同管理：合同关联、到期提醒
- 数据看板：销售漏斗、转化统计
- 系统管理：组织架构、角色权限、审计日志

## 3. 技术选型

- 前端框架：React 18 + TypeScript + Vite
- 后端框架：Node.js 22 + Fastify
- 数据库：PostgreSQL 16
- 认证授权：JWT + RBAC 角色权限模型

## 4. 系统架构设计

- 前端：客户档案、跟进记录、合同管理、数据看板四个业务模块
- 后端：模块化单体（认证、客户、跟进、合同、报表五域）
- 数据流：终端 → API 网关 → 业务服务 → 关系数据库
- 缓存：Redis 承载会话与热点数据（看板统计、客户列表）

## 5. 数据模型设计

- customers：客户主数据（id、name、level、owner_id、tags、created_at）
- customer_contacts：联系人（id、customer_id、name、phone、email）
- follow_ups：跟进记录（id、customer_id、owner_id、type、content、next_follow_at）
- contracts：合同（id、customer_id、amount、status、start_date、end_date）

## 6. 接口设计

- GET /api/customers：客户列表（支持分级、标签筛选与分页）
- POST /api/customers：新建客户（自动触发分级计算）
- POST /api/follow-ups：新增跟进记录（联动下次提醒）
- GET /api/dashboard/sales-funnel：销售漏斗统计

## 7. 安全设计

- 认证：JWT 短时效 + Refresh Token 轮换；RBAC 按角色校验接口权限
- 数据安全：客户数据按归属人行级权限过滤，敏感字段加密存储
- 审计：导出、删除、权限变更等关键操作写入审计日志

## 8. 分阶段实施计划

- 阶段一（第 1-2 周）：工程骨架 + 认证与 RBAC + 客户档案 CRUD
- 阶段二（第 3-4 周）：跟进时间线与下次提醒
- 阶段三（第 5 周）：合同管理与到期提醒
- 阶段四（第 6 周）：数据看板与统计报表
- 阶段五（第 7 周）：联调、性能优化与上线

## 9. 测试与验收

- 单元测试：分级计算、提醒触发等核心业务规则覆盖率不低于 80%
- 验收标准：对照规格说明的 12 个验收场景逐条通过，核心页面响应小于 500ms

## 10. 风险与应对

- 客户数据迁移与清洗成本高：提供导入模板与工具，上线前完成字段映射评审
- 标签规则频繁变化：规则配置化，由管理员后台维护，避免发版
- 分级口径理解不一致：分级规则在规格中明确约定，并纳入验收场景`;

test.describe("Desktop SDD workflow screenshots", () => {
  test("1. 规格编写 + 文件面板预览 spec + 规格确认弹窗", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    const messages: Message[] = [
      {
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
      },
      {
        id: "msg_sdd_spec",
        role: "assistant",
        timestamp: "2025-07-10T09:00:02.000Z",
        blocks: [
          {
            type: "text",
            content:
              "好的，我先编写功能规格说明 `docs/specs/crm/customer-management.md`。\n\n**核心模块：**\n- 客户档案：分级管理、联系人、标签\n- 跟进记录：时间线、下次跟进提醒\n- 合同管理：合同关联、到期提醒\n- 数据看板：销售漏斗、转化统计\n\n规格共 4 个用户故事、6 个验收场景，稍后请你确认。",
          },
        ],
      },
      {
        id: "msg_sdd_write",
        role: "assistant",
        timestamp: "2025-07-10T09:00:03.000Z",
        blocks: [
          {
            type: "tool",
            name: WRITE_TOOL_NAME,
            stage: "end",
            compactParams:
              "docs/specs/crm/customer-management.md 24 lines, 610 chars",
            parameters: JSON.stringify({
              file_path: SPEC_FILE,
              content: SPEC_CONTENT,
            }),
            result: "File created (24 lines, 610 characters)",
            shortResult: "File created (24 lines, 610 characters)",
          },
        ],
      },
    ];
    await setup(webviewPage, injector, messages);
    await webviewPage.waitForSelector(".write-preview-box");

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

    // 点击 Write 工具卡的文件路径 → 文件面板打开预览 spec 文件
    await webviewPage.locator(".write-tool-path").click();
    await expect(webviewPage.getByTestId("file-pane")).toBeVisible();
    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: SPEC_FULL_PATH,
        host: "local",
        content: SPEC_CONTENT,
        loading: false,
      },
    });
    await expect(
      webviewPage.getByTestId("file-pane").getByText("客户管理系统功能规格"),
    ).toBeVisible();

    // 规格编写完成后通过「问题待回答」弹窗请你决策
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-confirm-spec",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "问题待回答",
      toolInput: {
        questions: [
          {
            header: "规格确认",
            question:
              "功能规格《客户管理系统》已完成（4 个用户故事、6 个验收场景），请选择后续流程（如需调整规格，选「其他」并输入修改意见）：",
            options: [
              {
                label: "直接实现",
                description: "跳过技术方案，直接开始编码",
              },
              {
                label: "制定技术方案",
                description: "制定技术选型、架构设计与实现步骤后请你批准",
              },
            ],
          },
        ],
      },
    });
    const specDialog = webviewPage.locator(".confirmation-dialog");
    await specDialog.waitFor({ state: "visible" });
    await webviewPage.waitForTimeout(300);

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-sdd-workflow-spec.webp",
    );
  });

  test("2. 技术方案：plan 面板预览 + 计划执行确认弹窗", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
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
            content: "规格确认了，进入技术方案模式制定技术方案吧。",
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
            content:
              "技术方案已制定完成，已在右侧计划面板中打开，请审阅后批准。",
          },
        ],
      },
    ];
    await setup(webviewPage, injector, messages);

    // ExitPlanMode：方案全文路由到计划面板（自动打开），确认框保持紧凑——
    // 计划面板与确认弹窗并存，正是「plan 用 plan 面板预览」的桌面端形态
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-plan-approve",
      confirmationType: "计划执行确认",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      planContent: PLAN_CONTENT,
    });
    const planDialog = webviewPage.locator(".confirmation-dialog");
    await planDialog.waitFor({ state: "visible" });
    await expect(webviewPage.getByTestId("plan-pane")).toBeVisible();
    await expect(
      webviewPage.getByText("客户管理系统（CRM）技术方案"),
    ).toBeVisible();
    await expect(planDialog).toContainText("批准并继续");
    await expect(planDialog).not.toContainText("技术选型");
    await webviewPage.waitForTimeout(300);

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-sdd-plan-preview.webp",
    );
  });

  test("3. 编码阶段：完整任务列表进度", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    const messages: Message[] = [
      {
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
      },
      {
        id: "msg_sdd_code_user",
        role: "user",
        timestamp: "2025-07-10T09:00:18.000Z",
        blocks: [
          {
            type: "text",
            content: "规格和技术方案都确认了，开始实现吧。",
          },
        ],
      },
      {
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
      },
    ];
    await setup(webviewPage, injector, messages);

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
        subject: "制定技术方案",
        description: "技术选型、架构设计与实现步骤",
        status: "completed",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "3",
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
    await webviewPage.waitForTimeout(300);

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-sdd-tasklist-progress.webp",
    );
  });

  test("4. 迭代需求：更新规格 + 差异面板预览修改 + 规格确认弹窗", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    const messages: Message[] = [
      {
        id: "msg_sdd_iterate_user",
        role: "user",
        timestamp: "2025-07-10T10:00:00.000Z",
        blocks: [
          {
            type: "text",
            content:
              "我们已有客户管理系统（CRM）的规格说明 `docs/specs/crm/customer-management.md`（4 个用户故事、6 个验收场景）。现在想新增一个客户自动分级的功能：根据跟进频率和合同金额自动计算客户等级；另外把客户档案的标签从手动维护改成根据行为自动生成。",
          },
        ],
      },
      {
        id: "msg_sdd_iterate_spec",
        role: "assistant",
        timestamp: "2025-07-10T10:00:02.000Z",
        blocks: [
          {
            type: "text",
            content:
              "好的，我更新既有规格 `docs/specs/crm/customer-management.md`。\n\n**本次变更：**\n- 新增用户故事：客户自动分级（按跟进频率、合同金额自动计算客户等级）\n- 修改用户故事：客户档案标签由手动维护改为行为自动生成\n\n更新后共 5 个用户故事、8 个验收场景，修改已展示在右侧差异面板，稍后请你确认。",
          },
        ],
      },
      {
        id: "msg_sdd_iterate_edit",
        role: "assistant",
        timestamp: "2025-07-10T10:00:03.000Z",
        blocks: [
          {
            type: "tool",
            name: EDIT_TOOL_NAME,
            stage: "end",
            compactParams: "docs/specs/crm/customer-management.md",
            parameters: JSON.stringify({
              file_path: SPEC_FILE,
              old_string:
                "## 用户故事\n\n- P1 客户档案管理：作为销售，我希望维护客户档案（标签手动维护），以便集中管理客户信息\n- P2 跟进记录：作为销售，我希望记录跟进时间线，以便掌握客户沟通进展\n- P2 合同管理：作为销售，我希望管理合同信息，以便跟踪合同状态\n- P2 数据看板：作为管理者，我希望查看销售漏斗，以便了解转化情况",
              new_string:
                "## 用户故事\n\n- P1 客户档案管理：作为销售，我希望维护客户档案（标签按客户行为自动生成），以便集中管理客户信息\n- P1 客户自动分级：作为销售，我希望系统按跟进频率和合同金额自动计算客户等级，以便优先服务高价值客户\n- P2 跟进记录：作为销售，我希望记录跟进时间线，以便掌握客户沟通进展\n- P2 合同管理：作为销售，我希望管理合同信息，以便跟踪合同状态\n- P2 数据看板：作为管理者，我希望查看销售漏斗，以便了解转化情况",
            }),
            result: "Text replaced successfully",
          },
        ],
      },
    ];
    await setup(webviewPage, injector, messages);
    await expect(
      webviewPage.locator(".tool-container", {
        hasText: "customer-management.md",
      }),
    ).toBeVisible();

    // 任务列表：规格更新进行中
    await injector.simulateExtensionMessage("updateTasks", {
      tasks: [
        {
          id: "1",
          subject: "更新功能规格",
          description:
            "更新客户管理系统的功能规格说明（新增客户自动分级、调整标签规则）",
          status: "in_progress",
          blocks: [],
          blockedBy: [],
          metadata: {},
        },
      ],
    });
    await expect(webviewPage.getByTestId("task-list")).toBeVisible();

    // 打开差异面板，注入 spec 文件修改 diff
    await webviewPage.getByTestId("panel-toggle-btn").click();
    await expect(webviewPage.getByTestId("panel-toggle-menu")).toBeVisible();
    await webviewPage.getByTestId("panel-toggle-item-diff").click();
    await webviewPage.keyboard.press("Escape");
    await expect(webviewPage.getByTestId("diff-pane")).toBeVisible();
    await injector.simulateExtensionMessage("desktopWorkspaceDiff", {
      result: {
        kind: "ok",
        files: [
          {
            path: SPEC_FULL_PATH,
            status: "modified",
            additions: 2,
            deletions: 1,
            truncated: false,
            binary: false,
            hunks: [
              "@@ -3,6 +3,7 @@ ## 用户故事",
              "- P1 客户档案管理：作为销售，我希望维护客户档案（标签手动维护），以便集中管理客户信息",
              "+ P1 客户档案管理：作为销售，我希望维护客户档案（标签按客户行为自动生成），以便集中管理客户信息",
              "+ P1 客户自动分级：作为销售，我希望系统按跟进频率和合同金额自动计算客户等级，以便优先服务高价值客户",
            ].join("\n"),
          },
        ],
      },
    });
    await expect(
      webviewPage.getByTestId("diff-pane").getByText("customer-management.md"),
    ).toBeVisible();

    // 更新完成后通过「问题待回答」弹窗请你决策
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-iterate-confirm",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "问题待回答",
      toolInput: {
        questions: [
          {
            header: "规格确认",
            question:
              "已更新《客户管理系统》规格：新增「客户自动分级」用户故事、修改「标签自动生成」描述（现共 5 个用户故事、8 个验收场景），请选择后续流程（如需调整规格，选「其他」并输入修改意见）：",
            options: [
              {
                label: "直接实现",
                description: "跳过技术方案，直接开始编码",
              },
              {
                label: "制定技术方案",
                description: "制定技术选型、架构设计与实现步骤后请你批准",
              },
            ],
          },
        ],
      },
    });
    const specDialog = webviewPage.locator(".confirmation-dialog");
    await specDialog.waitFor({ state: "visible" });
    await webviewPage.waitForTimeout(300);

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-sdd-iterate-update.webp",
    );
  });

  test("5. 迭代需求：确认后重新汇入实现流程", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    const messages: Message[] = [
      {
        id: "msg_sdd_iterate_user",
        role: "user",
        timestamp: "2025-07-10T10:00:00.000Z",
        blocks: [
          {
            type: "text",
            content:
              "我们已有客户管理系统（CRM）的规格说明 `docs/specs/crm/customer-management.md`（4 个用户故事、6 个验收场景）。现在想新增一个客户自动分级的功能：根据跟进频率和合同金额自动计算客户等级；另外把客户档案的标签从手动维护改成根据行为自动生成。",
          },
        ],
      },
      {
        id: "msg_sdd_iterate_confirm_user",
        role: "user",
        timestamp: "2025-07-10T10:00:08.000Z",
        blocks: [
          {
            type: "text",
            content: "直接实现，开始吧。",
          },
        ],
      },
      {
        id: "msg_sdd_iterate_coding",
        role: "assistant",
        timestamp: "2025-07-10T10:00:20.000Z",
        blocks: [
          {
            type: "text",
            content:
              "规格已确认。按更新后的规格开始实现：先做客户自动分级（等级计算规则 + 分级结果展示），再把客户档案的标签改为行为自动生成。",
          },
        ],
      },
    ];
    await setup(webviewPage, injector, messages);

    const stageTasks: Task[] = [
      {
        id: "1",
        subject: "更新功能规格",
        description:
          "更新客户管理系统的功能规格说明（新增客户自动分级、调整标签规则）",
        status: "completed",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "2",
        subject: "实现变更",
        description: "按更新后的规格实现客户自动分级与标签自动生成",
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
    await webviewPage.waitForTimeout(300);

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-sdd-iterate-continue.webp",
    );
  });
});
