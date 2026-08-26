import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { EXIT_PLAN_MODE_TOOL_NAME, type Message } from "wave-agent-sdk";
import { screenshotWebp } from "../e2e/utils/screenshot.js";
import fs from "fs";
import path from "path";

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
- 分级口径理解不一致：分级规则在规格中明确约定，并纳入验收场景`;

test.describe("SDD Plan Preview Tab Screenshot", () => {
  test("capture VS Code plan-preview tab + compact confirmation", async ({
    webviewPage,
    context,
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
            content:
              "技术方案已制定完成，已在新标签页的计划预览中打开，请审阅后批准。",
          },
        ],
      },
    ];
    await injector.updateMessages(messages);

    // ExitPlanMode：方案正文不进入对话 webview（由宿主另开的 plan-preview 面板承载），
    // 确认框保持紧凑，仅保留批准交互。
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-plan-preview-approve",
      confirmationType: "计划执行确认",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      planContent: PLAN_CONTENT,
    });
    const planDialog = webviewPage.locator(".confirmation-dialog");
    await planDialog.waitFor({ state: "visible" });
    // 紧凑确认框：批准按钮在，方案正文不在
    await expect(planDialog).toContainText("批准并继续");
    await expect(planDialog).not.toContainText("技术选型");

    // 计划预览「新标签页」：镜像 webviewManager.getPlanPreviewContent 渲染的
    // wavePlanPreview WebviewPanel（ViewColumn.Beside 打开）——同一份
    // chat.css + plan-preview.js，宿主 postMessage({command:"planPreview"}) 注入正文。
    const planPage = await context.newPage();
    await planPage.setViewportSize({ width: 560, height: 760 });
    const themeCss = fs.readFileSync(
      path.join(process.cwd(), "theme", "theme-base-dark.css"),
      "utf8",
    );
    const chatCss = fs.readFileSync(
      path.join(process.cwd(), "dist", "chat.css"),
      "utf8",
    );
    const planPreviewJs = fs.readFileSync(
      path.join(process.cwd(), "dist", "plan-preview.js"),
      "utf8",
    );
    await planPage.setContent(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>计划预览</title>
    <style>${themeCss}</style>
    <style>${chatCss}</style>
    <style>
      body { margin: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
      .tab-strip { display: flex; height: 35px; background: var(--vscode-editorGroupHeader-tabsBackground, #252526); border-bottom: 1px solid var(--vscode-tab-border, #454545); padding: 0 8px; }
      .tab { display: flex; align-items: center; padding: 0 14px; font-size: 13px; }
      .tab.active { background: var(--vscode-tab-activeBackground, #1e1e1e); color: var(--vscode-tab-activeForeground, #ffffff); border-top: 1px solid var(--vscode-tab-activeBorderTop, #007fd4); }
      .plan-body { padding: 16px; }
      #plan-preview h1 { font-size: 1.4em; }
    </style>
</head>
<body>
    <div class="tab-strip">
      <div class="tab active">计划预览</div>
    </div>
    <div class="plan-body"><div id="plan-preview" class="markdown-body"></div></div>
    <script>${planPreviewJs}</script>
</body>
</html>`);
    await planPage.evaluate((content) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "planPreview", content },
        }),
      );
    }, PLAN_CONTENT);
    await expect(planPage.locator("#plan-preview")).toContainText(
      "客户管理系统（CRM）技术方案",
    );
    await expect(planPage.locator("#plan-preview")).toContainText("技术选型");
    await expect(planPage.locator("#plan-preview")).toContainText("风险与应对");
    await screenshotWebp(
      planPage,
      "../../docs/public/screenshots/spec-sdd-plan-preview-tab.webp",
    );
    await planPage.close();

    // 对话 webview 中的紧凑确认框（批准交互）由 sdd-workflow.demo.ts 的
    // spec-sdd-plan-approve.webp 覆盖，这里仅验证后关闭。
    await webviewPage.keyboard.press("Escape");
    await planDialog.waitFor({ state: "detached" });
  });
});
