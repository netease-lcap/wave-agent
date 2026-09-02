import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { WRITE_TOOL_NAME, type Message } from "wave-agent-sdk";
import {
  screenshotWebp,
  elementScreenshotWebp,
} from "../e2e/utils/screenshot.js";

// Desktop 4.1 SDD / 5.2 插件 screenshots — captured inside the desktop layout.
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
  await injector.simulateExtensionMessage("setInitialState", {
    ...baseConfig,
    messages,
  });
  await webviewPage.waitForSelector('[data-testid="message-input"]', {
    state: "visible",
  });
}

test.describe("Desktop SDD / 插件 screenshots", () => {
  test("4.1 SDD 规格编写流程", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
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
              "好的，我先编写功能规格说明 `docs/specs/crm/customer-management.md`。\n\n**核心模块：**\n- 客户档案：分级管理、联系人、标签\n- 跟进记录：时间线、下次跟进提醒\n- 合同管理：合同关联、到期提醒\n- 数据看板：销售漏斗、转化统计\n\n规格共 4 个用户故事、12 个验收场景，稍后请你确认。",
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
      },
    ];
    await setup(webviewPage, injector, messages);
    await webviewPage.waitForSelector(".write-preview-box");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-sdd-workflow.webp",
    );
  });

  test("5.2 1) 安装插件（探索新插件）", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 720 });
    await setup(webviewPage, injector);

    await injector.simulateExtensionMessage("showDialog", {
      dialogType: "plugin",
    });
    await expect(
      webviewPage.getByText("插件管理", { exact: true }),
    ).toBeVisible();

    await injector.simulateExtensionMessage("listPluginsResponse", {
      plugins: [
        {
          id: "git-workflow@wave-plugins-official",
          name: "Git Workflow",
          description:
            "集成 Git 工作流，支持智能提交信息生成、PR 审查和冲突解决",
          marketplace: "wave-plugins-official",
          installed: false,
          version: "2.3.1",
        },
        {
          id: "kubernetes-helper@wave-plugins-official",
          name: "Kubernetes Helper",
          description: "简化 K8s 集群管理，提供 Pod 诊断、日志查询和资源监控",
          marketplace: "wave-plugins-official",
          installed: false,
          version: "1.8.0",
        },
        {
          id: "database-explorer@wave-community",
          name: "Database Explorer",
          description:
            "连接多种数据库（PostgreSQL、MySQL、MongoDB），支持智能查询和 schema 可视化",
          marketplace: "wave-community",
          installed: false,
          version: "0.9.5",
        },
      ],
    });
    await webviewPage.waitForSelector(".plugin-item");
    await expect(webviewPage.getByText("Git Workflow")).toBeVisible();

    // Click a plugin to show the install detail (scope selection).
    await webviewPage.getByText("Git Workflow").click();
    await expect(webviewPage.getByText("选择安装作用域")).toBeVisible();
    await expect(webviewPage.getByText("为你安装 (user)")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-plugin-explore.webp",
    );
  });

  test("5.2 2) 启用 / 禁用插件", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 720 });
    await setup(webviewPage, injector);

    await injector.simulateExtensionMessage("showDialog", {
      dialogType: "plugin",
    });
    await expect(
      webviewPage.getByText("插件管理", { exact: true }),
    ).toBeVisible();

    await injector.simulateExtensionMessage("listPluginsResponse", {
      plugins: [
        {
          id: "code-reviewer@wave-plugins-official",
          name: "Code Reviewer",
          description:
            "AI 驱动的代码审查工具，自动检测安全漏洞、性能问题和最佳实践违规",
          marketplace: "wave-plugins-official",
          installed: true,
          enabled: true,
          version: "3.1.2",
          scope: "user",
        },
        {
          id: "api-docs-generator@wave-community",
          name: "API Docs Generator",
          description: "从代码自动生成 OpenAPI 文档，支持实时预览和交互式测试",
          marketplace: "wave-community",
          installed: true,
          enabled: false,
          version: "1.4.0",
          scope: "project",
        },
        {
          id: "document-skills@wave-plugins-official",
          name: "Document Skills",
          description:
            "专业的文档处理技能包：DOCX 创建与修订、PDF 处理、演示文稿与表格分析",
          marketplace: "wave-plugins-official",
          installed: true,
          enabled: true,
          version: "2.1.0",
          scope: "user",
        },
      ],
    });
    // Switch to the installed tab and screenshot the enable/disable state.
    await webviewPage.getByText("已安装插件", { exact: true }).click();
    await webviewPage.waitForSelector('.plugin-item:has-text("Code Reviewer")');
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-plugin-installed.webp",
    );
  });
});
