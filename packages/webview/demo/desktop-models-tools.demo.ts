import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import {
  AGENT_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  READ_TOOL_NAME,
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
  type Message,
} from "wave-agent-sdk";
import {
  screenshotWebp,
  elementScreenshotWebp,
} from "../e2e/utils/screenshot.js";

// Desktop 2.2 模型 / 2.3 上下文 / 2.4 代码理解与操作 / 2.9 技能 / 5.1 MCP
// screenshots — all captured inside the desktop layout (sidebar + session tree).
const DIR_A = "/Users/dev/projects/wave-agent";

const baseConfig = {
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
async function setup(injector: MessageInjector, messages: unknown[] = []) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
    host: "local",
    hosts: ["local"],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", {
    messages,
    ...baseConfig,
  });
}

test.describe("Desktop 模型/上下文/代码理解 screenshots", () => {
  test("2.2 2) /model 切换模型", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(injector);

    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/model");
    await webviewPage.keyboard.press("Enter");
    await injector.waitForMessage("getConfiguredModels");
    await injector.simulateExtensionMessage("configuredModels", {
      models: ["deepseek-v4-flash", "glm-5.2", "kimi-k3", "qwen3.8-max"],
      currentModel: "deepseek-v4-flash",
    });
    await webviewPage.waitForSelector(".model-popup-item", {
      state: "visible",
    });
    await expect(webviewPage.locator(".model-popup-item")).toHaveCount(4);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-model-popup.webp",
    );
  });

  test("2.3 1) 上下文使用率", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(injector, [
      MockDataGenerator.createUserMessage(
        "继续帮我分析 PaymentService 的分布式事务问题",
      ),
      MockDataGenerator.createAssistantMessage(
        "好的，继续分析事务边界。上一次已经确认 `processPayment` 存在竞态条件，建议引入版本号乐观锁。接下来我检查退款流程与重复回调场景...",
      ),
    ]);
    await injector.endStreaming();

    // Context-window usage indicator in the bottom-right of the input box.
    await injector.simulateExtensionMessage("contextUsage", { percent: 38 });
    await expect(
      webviewPage.locator(".compress-context-button"),
    ).toHaveAttribute("aria-label", "已使用 38%");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-context-usage.webp",
    );
  });

  test("2.4 2) 文件搜索与探索", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    const explorationMessages: Message[] = [
      {
        id: "msg_exploration",
        role: "assistant",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [
          {
            type: "tool",
            name: AGENT_TOOL_NAME,
            stage: "end",
            compactParams: "Explore: 查找所有支付相关 API 定义",
            parameters: JSON.stringify({
              subagent_type: "Explore",
              description: "查找所有支付相关 API 定义",
              prompt: "...",
            }),
            result: "子代理已扫描 42 个文件，识别出 12 个支付相关接口定义",
            shortResult: "子代理已扫描 42 个文件，识别出 12 个支付相关接口定义",
          },
          {
            type: "tool",
            name: GLOB_TOOL_NAME,
            stage: "end",
            compactParams: "src/services/**/*.ts in src",
            parameters: JSON.stringify({
              pattern: "src/services/**/*.ts",
              path: "src",
            }),
            result:
              "src/services/payment/PaymentService.ts\nsrc/services/payment/TransactionLogger.ts\nsrc/services/payment/RefundHandler.ts",
            shortResult: "Found 3 files",
          },
          {
            type: "tool",
            name: GREP_TOOL_NAME,
            stage: "end",
            compactParams: "interface.*Payment ts in src",
            parameters: JSON.stringify({
              pattern: "interface.*Payment",
              type: "ts",
              path: "src",
            }),
            result:
              "src/types/payment.ts:15:export interface PaymentRequest {\nsrc/types/payment.ts:32:export interface PaymentResult {\nsrc/services/payment/PaymentService.ts:28:export interface PaymentService {",
            shortResult: "Found 3 matching lines",
          },
          {
            type: "tool",
            name: READ_TOOL_NAME,
            stage: "end",
            parameters: JSON.stringify({
              file_path: "src/services/payment/PaymentService.ts",
            }),
            result:
              'import { Injectable } from "@nestjs/common";\nimport { PaymentRepository } from "./PaymentRepository";\n\n@Injectable()\nexport class PaymentService {\n  constructor(private readonly repo: PaymentRepository) {}',
            shortResult: "Read 156 lines",
          },
        ],
      },
    ];
    await setup(injector, [
      MockDataGenerator.createUserMessage(
        "梳理一下 src/services 下的支付服务代码结构和接口定义",
        "msg_user_exploration",
      ),
      ...explorationMessages,
    ]);
    await webviewPage.waitForSelector(".tool-container");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-exploration.webp",
    );
  });

  test("2.4 3) 文件操作工具", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    const fileOpMessages: Message[] = [
      {
        id: "msg_file_ops",
        role: "assistant",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [
          {
            type: "tool",
            name: WRITE_TOOL_NAME,
            stage: "end",
            compactParams:
              "src/middleware/optimisticLock.ts 18 lines, 512 chars",
            parameters: JSON.stringify({
              file_path: "src/middleware/optimisticLock.ts",
              content: `import { PaymentRepository } from '../repositories/PaymentRepository';

/**
 * 乐观锁中间件：基于版本号防止并发更新冲突。
 * 读取当前版本后执行业务逻辑，提交时校验版本一致性。
 */
export const withOptimisticLock = async <T>(
  repo: PaymentRepository,
  id: string,
  handler: (version: number) => Promise<T>
): Promise<T> => {
  const { version } = await repo.findById(id);
  const result = await handler(version);
  await repo.assertVersion(id, version);
  return result;
};`,
            }),
            result: "File created (18 lines, 512 characters)",
            shortResult: "File created (18 lines, 512 characters)",
          },
          {
            type: "tool",
            name: EDIT_TOOL_NAME,
            stage: "end",
            compactParams: "src/services/payment/PaymentService.ts",
            parameters: JSON.stringify({
              file_path: "src/services/payment/PaymentService.ts",
              old_string: "async processPayment(tx) {",
              new_string:
                "async processPayment(tx: PaymentTx): Promise<Result> {",
            }),
            result: "Text replaced successfully",
            shortResult: "Text replaced successfully",
          },
        ],
      },
    ];
    await setup(injector, [
      MockDataGenerator.createUserMessage(
        "新建一个乐观锁中间件，并给 processPayment 补上类型签名",
        "msg_user_file_ops",
      ),
      ...fileOpMessages,
    ]);
    await webviewPage.waitForSelector(".write-preview-box");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-file-ops.webp",
    );
  });

  test("2.4 5) LSP 代码智能", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    const lspBlocks = [
      {
        type: "tool",
        name: "LSP",
        stage: "end",
        compactParams:
          "goToDefinition (src/services/payment/PaymentService.ts:28:15)",
        parameters: JSON.stringify({
          operation: "goToDefinition",
          filePath: "src/services/payment/PaymentService.ts",
          line: 28,
          character: 15,
        }),
        result:
          "Found definition at src/repositories/PaymentRepository.ts:12:14",
      },
      {
        type: "tool",
        name: "LSP",
        stage: "end",
        compactParams:
          "findReferences (src/repositories/PaymentRepository.ts:12:14)",
        parameters: JSON.stringify({
          operation: "findReferences",
          filePath: "src/repositories/PaymentRepository.ts",
          line: 12,
          character: 14,
        }),
        result:
          "Found 8 references:\n- src/services/payment/PaymentService.ts:28:5\n- src/services/payment/RefundHandler.ts:45:12\n- src/services/payment/TransactionLogger.ts:67:8",
      },
      {
        type: "tool",
        name: "LSP",
        stage: "end",
        compactParams: "hover (src/services/payment/PaymentService.ts:28:15)",
        parameters: JSON.stringify({
          operation: "hover",
          filePath: "src/services/payment/PaymentService.ts",
          line: 28,
          character: 15,
        }),
        result:
          "class PaymentService\n\nHandles payment processing with distributed transaction support. Implements optimistic locking and automatic retry logic for concurrent operations.\n\n@Injectable()",
      },
      {
        type: "tool",
        name: "LSP",
        stage: "end",
        compactParams:
          "incomingCalls (src/repositories/PaymentRepository.ts:12:14)",
        parameters: JSON.stringify({
          operation: "incomingCalls",
          filePath: "src/repositories/PaymentRepository.ts",
          line: 12,
          character: 14,
        }),
        result:
          "Callers of findById:\n- PaymentService.processPayment (src/services/payment/PaymentService.ts:45)\n- RefundHandler.processRefund (src/services/payment/RefundHandler.ts:78)",
      },
    ];
    await setup(injector, [
      MockDataGenerator.createUserMessage(
        "分析 PaymentService 里 findById 的定义、引用和调用方",
        "msg_user_lsp",
      ),
      {
        id: "msg_lsp",
        role: "assistant",
        blocks: lspBlocks,
      },
    ]);
    await webviewPage.waitForSelector(".tool-container");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-lsp.webp",
    );
  });

  test("2.4 6) 视觉理解", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(injector, [
      {
        id: "msg_vision_user",
        role: "user",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [
          {
            type: "text",
            content: "请分析这个 UI 设计稿，帮我生成对应的 React 组件 [image1]",
          },
          {
            type: "image",
            imageUrls: [
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            ],
          },
        ],
      },
      MockDataGenerator.createAssistantMessage(
        "这是一个支付确认页面的设计稿。我可以识别出以下元素：\n\n1. **顶部导航栏** - 包含返回按钮和标题\n2. **金额展示区** - 大号字体显示支付金额\n3. **支付方式选择** - 支持银行卡和电子钱包\n4. **底部确认按钮** - 固定在底部\n\n我将基于这些元素生成对应的 React 组件...",
      ),
    ]);
    await webviewPage.waitForSelector(".message-image, [data-testid]", {
      state: "visible",
    });
    await expect(
      webviewPage.getByText("这是一个支付确认页面的设计稿"),
    ).toBeVisible();
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-vision.webp",
    );
  });

  test("2.9 1) 技能调用", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(injector, [
      MockDataGenerator.createUserMessage(
        "帮我调研一下主流支付网关的方案对比",
        "msg_user_skill",
      ),
      {
        id: "msg_skill",
        role: "assistant",
        blocks: [
          {
            type: "tool",
            name: "Skill",
            stage: "end",
            compactParams: "deep-research",
            parameters: JSON.stringify({ skill_name: "deep-research" }),
            result:
              "Research complete: analyzed 15 sources, generated comprehensive report at ./reports/payment-gateway-comparison.md",
            shortResult: "Invoked skill: deep-research",
          },
        ],
      },
    ]);
    await webviewPage.waitForSelector(".tool-container");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-skill.webp",
    );
  });

  test("5.1 2) MCP 工具调用", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(injector, [
      MockDataGenerator.createUserMessage(
        "帮我在 Jira 里查一下进行中的支付相关需求",
        "msg_user_mcp",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "正在通过 MCP 服务器查询 Jira 中的支付相关需求...",
        "mcp__jira__search_issues",
        JSON.stringify({
          jql: 'project = PAY AND status = "In Progress"',
          maxResults: 5,
        }),
        "Found 5 issues: PAY-142 (Optimistic Lock), PAY-138 (Retry Logic), PAY-135 (Webhook), PAY-129 (Refund Flow), PAY-121 (Multi-currency)",
      ),
    ]);
    await webviewPage.waitForSelector(".tool-container");
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/desktop-mcp-tool.webp",
    );
  });
});
