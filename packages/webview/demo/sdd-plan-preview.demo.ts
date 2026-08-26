import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { EXIT_PLAN_MODE_TOOL_NAME, type Message } from "wave-agent-sdk";
import { screenshotWebp } from "../e2e/utils/screenshot.js";
import fs from "fs";
import path from "path";

const PLAN_CONTENT = `## 客户管理系统技术方案

**技术选型**：React 18 + TypeScript + Vite；Node.js + Fastify + PostgreSQL；JWT + RBAC 认证

**架构设计**：客户档案 / 跟进记录 / 合同管理 / 数据看板四模块；customers、follow_ups、contracts 三张核心表

**实现步骤**：工程骨架 → 客户档案 CRUD → 跟进时间线 → 合同与到期提醒 → 数据看板`;

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
      .tab.inactive { color: var(--vscode-tab-inactiveForeground, #969696); }
      .plan-body { padding: 16px; }
      #plan-preview h1 { font-size: 1.4em; }
    </style>
</head>
<body>
    <div class="tab-strip">
      <div class="tab active">计划预览</div>
      <div class="tab inactive">对话</div>
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
      "客户管理系统技术方案",
    );
    await expect(planPage.locator("#plan-preview")).toContainText("技术选型");
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
