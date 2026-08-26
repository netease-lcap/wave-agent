import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  WRITE_TOOL_NAME,
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
    // 编写规格文件的 Write 工具卡：消息列表展示写入的文件内容预览
    const writeSpecMsg: Message = {
      id: "msg_sdd_write_spec",
      role: "assistant",
      timestamp: "2025-07-10T09:00:03.000Z",
      blocks: [
        {
          type: "tool",
          name: WRITE_TOOL_NAME,
          stage: "end",
          compactParams:
            "docs/specs/crm/customer-management.md 19 lines, 380 chars",
          parameters: JSON.stringify({
            file_path: "docs/specs/crm/customer-management.md",
            content: `---
name: 客户管理系统
description: 客户档案、跟进记录、合同管理与数据看板的统一规格说明
order: 1
---

# 客户管理系统功能规格

## 用户场景与测试

- P1 客户档案管理：作为销售，我希望维护客户档案，以便集中管理客户信息
- P1 跟进记录：作为销售，我希望记录跟进时间线，以便掌握客户沟通进展
- P2 合同管理：作为销售，我希望管理合同信息，以便跟踪合同状态
- P2 数据看板：作为管理者，我希望查看销售漏斗，以便了解转化情况`,
          }),
          result: "File created (19 lines, 380 characters)",
          shortResult: "File created (19 lines, 380 characters)",
        },
      ],
    };
    await injector.updateMessages([userMessage, specReply, writeSpecMsg]);
    await expect(webviewPage.locator(".write-preview-box")).toBeVisible();

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
                  "功能规格《客户管理系统》已完成（4 个用户故事、12 个验收场景），请选择后续流程：",
                options: [
                  {
                    label: "直接实现",
                    description: "跳过技术方案，直接开始编码",
                  },
                  {
                    label: "制定技术方案",
                    description: "制定技术选型、架构设计与实现步骤后请你批准",
                  },
                  {
                    label: "其他",
                    description: "规格需要调整，按反馈修改后重新决策",
                  },
                ],
              },
            ],
          }),
        },
      ],
    };
    await injector.updateMessages([
      userMessage,
      specReply,
      writeSpecMsg,
      confirmMsg,
    ]);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-confirm-spec",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "问题待回答",
      toolInput: {
        questions: [
          {
            header: "规格确认",
            question:
              "功能规格《客户管理系统》已完成（4 个用户故事、12 个验收场景），请选择后续流程：",
            options: [
              {
                label: "直接实现",
                description: "跳过技术方案，直接开始编码",
              },
              {
                label: "制定技术方案",
                description: "制定技术选型、架构设计与实现步骤后请你批准",
              },
              {
                label: "其他",
                description: "规格需要调整，按反馈修改后重新决策",
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

    // ---- Stage 3: plan approval (ExitPlanMode) ----

    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-plan-approve",
      confirmationType: "计划执行确认",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      planContent: `# 客户管理系统（CRM）技术方案

## 1. 项目背景与目标

本系统面向销售团队核心业务场景，旨在解决客户信息分散、跟进过程不可追溯、合同与客户数据割裂等问题。通过统一客户档案、跟进记录、合同管理与数据看板，建立以客户为中心的运营闭环，提升销售转化率与管理效率。

## 2. 需求范围

- 客户档案：客户分级、联系人管理、行为标签
- 跟进记录：跟进时间线、下次跟进提醒
- 合同管理：合同关联、到期提醒
- 数据看板：销售漏斗、转化统计
- 系统管理：组织架构、角色权限、审计日志

## 3. 技术选型

- 前端框架：React 18 + TypeScript + Vite。选择理由：类型安全、组件生态成熟；对比 Vue 3，React Hooks 更适合复杂状态管理，Vite 冷启动与热更新显著快于 Webpack。
- 后端框架：Node.js 22 + Fastify。选择理由：与前端统一 TypeScript 技术栈，性能约为 Express 的 2 倍；对比 NestJS，Fastify 更轻量，按需引入校验与插件。
- 数据库：PostgreSQL 16。选择理由：强事务保障合同与跟进数据一致性，JSONB 支持灵活标签存储，内置全文检索与窗口函数；对比 MySQL，更适合复杂报表查询。
- 认证授权：JWT + RBAC 角色权限模型。选择理由：无状态、易水平扩展；RBAC 满足销售、主管、管理员分级权限控制。

## 4. 系统架构设计

- 前端：客户档案、跟进记录、合同管理、数据看板四个业务模块，叠加通用组件层（表格、表单、权限指令）
- 后端：模块化单体（认证、客户、跟进、合同、报表五域），按域拆分代码，便于后续演进微服务
- 数据流：终端 → API 网关 → 业务服务 → 关系数据库；写操作走事务提交，读操作经查询优化与缓存加速
- 缓存：Redis 承载会话与热点数据（看板统计、客户列表），失效策略按业务容忍度分级

## 5. 数据模型设计

- customers：客户主数据（id、name、level、owner_id、tags、created_at）
- customer_contacts：联系人（id、customer_id、name、phone、email）
- follow_ups：跟进记录（id、customer_id、owner_id、type、content、next_follow_at）
- contracts：合同（id、customer_id、amount、status、start_date、end_date）
- users、roles、permissions：组织架构与权限体系

## 6. 接口设计

- GET /api/customers：客户列表（支持分级、标签筛选与分页）
- POST /api/customers：新建客户（自动触发分级计算）
- POST /api/follow-ups：新增跟进记录（联动下次提醒）
- GET /api/dashboard/sales-funnel：销售漏斗统计
- 统一响应格式 { code, message, data }，错误码分段定义

## 7. 安全设计

- 认证：JWT 短时效 + Refresh Token 轮换；RBAC 按角色校验接口权限
- 数据安全：客户数据按归属人行级权限过滤，敏感字段加密存储
- 传输安全：全链路 HTTPS，接口限流与防暴力破解
- 审计：导出、删除、权限变更等关键操作写入审计日志

## 8. 分阶段实施计划

- 阶段一（第 1-2 周）：工程骨架 + 认证与 RBAC + 客户档案 CRUD
- 阶段二（第 3-4 周）：跟进时间线与下次提醒
- 阶段三（第 5 周）：合同管理与到期提醒
- 阶段四（第 6 周）：数据看板与统计报表
- 阶段五（第 7 周）：联调、性能优化与上线

## 9. 测试与验收

- 单元测试：分级计算、提醒触发等核心业务规则覆盖率不低于 80%
- 接口测试：全部 RESTful 接口自动化用例
- 验收标准：对照规格说明的 12 个验收场景逐条通过，核心页面响应小于 500ms

## 10. 风险与应对

- 客户数据迁移与清洗成本高：提供导入模板与工具，上线前完成字段映射评审
- 标签规则频繁变化：规则配置化，由管理员后台维护，避免发版
- 分级口径理解不一致：分级规则在规格中明确约定，并纳入验收场景`,
    });
    const planApproveDialog = webviewPage.locator(".confirmation-dialog");
    await planApproveDialog.waitFor({ state: "visible" });
    await elementScreenshotWebp(
      planApproveDialog,
      "../../docs/public/screenshots/spec-sdd-plan-approve.webp",
    );
    await webviewPage.keyboard.press("Escape");
    await planApproveDialog.waitFor({ state: "detached" });

    // ---- Stage 4: coding stage with full task progress ----
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
          content: "规格和技术方案都确认了，开始实现吧。",
        },
      ],
    };
    await injector.updateMessages([
      userMessage,
      specReply,
      writeSpecMsg,
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
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-sdd-tasklist-progress.webp",
    );
  });
});
