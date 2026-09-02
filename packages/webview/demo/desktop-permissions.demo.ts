import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import {
  EDIT_TOOL_NAME,
  BASH_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  type Message,
} from "wave-agent-sdk";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Desktop 2.5 权限与安全 screenshots — confirmation dialogs / permission-mode
// menu / interactive questions, all captured inside the desktop layout.
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

async function setup(
  webviewPage: Parameters<typeof screenshotWebp>[0],
  injector: MessageInjector,
) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
    host: "local",
    hosts: ["local"],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", baseConfig);
  // Seed the sidebar session tree (same message the desktop host pushes) so
  // screenshots don't show an empty conversation list.
  await injector.simulateExtensionMessage("desktopSessionTree", {
    groups: [
      {
        host: "local",
        workdir: DIR_A,
        sessions: [
          {
            sessionId: "s-perm-running",
            title: "SQL 参数化改造 PaymentService",
            lastActiveAt: 1782000100000,
            hasWorktree: false,
            running: true,
          },
          {
            sessionId: "s-perm-waiting",
            title: "高并发重构方案评审",
            lastActiveAt: 1782000200000,
            hasWorktree: false,
            running: false,
            waitingConfirmation: true,
          },
          {
            sessionId: "s-perm-done",
            title: "修复支付回调幂等",
            lastActiveAt: 1781990000000,
            hasWorktree: false,
            running: false,
          },
        ],
      },
    ],
  });
  // Wait until the pane is fully mounted so follow-up messages are not lost
  // to the mount race (e.g. showConfirmation).
  await webviewPage.waitForSelector('[data-testid="message-input"]', {
    state: "visible",
  });
}

/** Seed a short conversation so dialogs render over real-looking context. */
async function seedMessages(
  webviewPage: Parameters<typeof screenshotWebp>[0],
  injector: MessageInjector,
  msgs: Message[],
  waitForText: string,
) {
  await injector.updateMessages(msgs);
  await expect(webviewPage.getByText(waitForText)).toBeVisible();
}

/** Show a confirmation dialog and screenshot the whole desktop layout. */
async function captureConfirmation(
  webviewPage: Parameters<typeof screenshotWebp>[0],
  injector: MessageInjector,
  payload: Record<string, unknown>,
  file: string,
) {
  await injector.simulateExtensionMessage("showConfirmation", payload);
  await webviewPage.waitForSelector(".confirmation-dialog");
  await screenshotWebp(webviewPage, file);
  await webviewPage.keyboard.press("Escape");
  await webviewPage.waitForSelector(".confirmation-dialog", {
    state: "detached",
  });
}

test.describe("Desktop 2.5 权限与安全 screenshots", () => {
  test("1) 权限模式管理（下拉菜单展开）", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(webviewPage, injector);

    await injector.simulateExtensionMessage("updatePermissionMode", {
      mode: "default",
    });
    const modeSelect = webviewPage.locator(".permission-mode-select");
    await expect(modeSelect).toHaveClass(/mode-default/);
    await modeSelect.click();
    await expect(webviewPage.locator(".permission-mode-menu")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-permission-mode.webp",
    );
  });

  test("2) 代码修改确认", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(webviewPage, injector);
    await seedMessages(
      webviewPage,
      injector,
      [
        MockDataGenerator.createUserMessage(
          "PaymentService 的 SQL 是字符串拼接的，有注入风险，帮我参数化改造一下",
          "msg-edit-u1",
        ),
        MockDataGenerator.createAssistantMessageWithTool(
          "好的，我来把 PaymentService 里的动态 SQL 改成参数化查询。",
          EDIT_TOOL_NAME,
          JSON.stringify({
            file_path: "/src/services/payment/PaymentService.ts",
            old_string:
              'const result = await this.db.query("SELECT * FROM payments WHERE id = ?", tx.id);',
            new_string:
              'const result = await this.db.query("SELECT * FROM payments WHERE id = $1", [tx.id]);',
          }),
        ),
      ],
      "有注入风险",
    );
    await captureConfirmation(
      webviewPage,
      injector,
      {
        confirmationId: "edit-confirm-001",
        confirmationType: "代码修改确认",
        toolName: EDIT_TOOL_NAME,
        toolInput: {
          file_path: "/src/services/payment/PaymentService.ts",
          old_string:
            'const result = await this.db.query("SELECT * FROM payments WHERE id = ?", tx.id);',
          new_string:
            'const result = await this.db.query("SELECT * FROM payments WHERE id = $1", [tx.id]);',
        },
      },
      "../../docs/public/screenshots/desktop-edit-confirm.webp",
    );
  });

  test("3) 命令执行确认", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(webviewPage, injector);
    const bashMsgs = [
      MockDataGenerator.createUserMessage(
        "帮我跑一下支付服务的测试，要带覆盖率报告",
        "msg-bash-u1",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "我来运行支付服务测试套件并生成覆盖率报告。",
        BASH_TOOL_NAME,
        JSON.stringify({
          command: "pnpm -F @nebula/payment-service test -- --coverage",
          description: "运行支付服务测试套件并生成覆盖率报告",
        }),
      ),
    ];
    // generator 的 BASH 默认摘要 "npm install" 与本次命令不符 → 换成与命令一致的摘要
    const bashTool = bashMsgs[1].blocks.find((b) => b.type === "tool");
    if (bashTool && bashTool.type === "tool") {
      bashTool.compactParams = "pnpm test -- --coverage";
    }
    await seedMessages(
      webviewPage,
      injector,
      bashMsgs,
      "我来运行支付服务测试套件",
    );
    await captureConfirmation(
      webviewPage,
      injector,
      {
        confirmationId: "bash-confirm-001",
        confirmationType: "Bash 命令执行确认",
        toolName: BASH_TOOL_NAME,
        toolInput: {
          command: "pnpm -F @nebula/payment-service test -- --coverage",
          description: "运行支付服务测试套件并生成覆盖率报告",
        },
      },
      "../../docs/public/screenshots/desktop-bash-confirm.webp",
    );
  });

  test("4) MCP 工具确认", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(webviewPage, injector);
    const mcpMsgs = [
      MockDataGenerator.createUserMessage(
        "乐观锁改造的方案评审过了，帮我在 Jira 上建一个高优先级 issue 跟踪",
        "msg-mcp-u1",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "需求已整理，正在 Jira 创建 issue。",
        "mcp__jira__create_issue",
        JSON.stringify({
          title: "PaymentService 乐观锁支持",
          description: "为支付服务引入乐观锁机制，处理并发更新冲突",
          priority: "high",
          tags: ["payment", "concurrency", "refactor"],
        }),
      ),
    ];
    // 非 Bash/Read/Write 工具，generator 默认摘要 = 工具名 → 与标题重复；换友好摘要
    const mcpTool = mcpMsgs[1].blocks.find((b) => b.type === "tool");
    if (mcpTool && mcpTool.type === "tool") {
      mcpTool.compactParams = "Jira · 创建 issue";
    }
    await seedMessages(
      webviewPage,
      injector,
      mcpMsgs,
      "需求已整理，正在 Jira 创建 issue",
    );
    await captureConfirmation(
      webviewPage,
      injector,
      {
        confirmationId: "mcp-confirm-001",
        confirmationType: "MCP 工具确认",
        toolName: "mcp__jira__create_issue",
        toolInput: {
          title: "PaymentService 乐观锁支持",
          description: "为支付服务引入乐观锁机制，处理并发更新冲突",
          priority: "high",
          tags: ["payment", "concurrency", "refactor"],
        },
      },
      "../../docs/public/screenshots/desktop-mcp-confirm.webp",
    );
  });

  test("5) 计划执行确认", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(webviewPage, injector);
    await seedMessages(
      webviewPage,
      injector,
      [
        MockDataGenerator.createUserMessage(
          "高并发下支付服务扛不住了，先别急着改代码，给我一个完整的重构方案",
          "msg-plan-u1",
        ),
        MockDataGenerator.createAssistantMessage(
          "我分析了当前实现，计划分三阶段推进（乐观锁 → 缓存层 → 异步化），确认后开始实施：",
          "msg-plan-a1",
        ),
      ],
      "确认后开始实施",
    );
    await captureConfirmation(
      webviewPage,
      injector,
      {
        confirmationId: "plan-confirm-001",
        confirmationType: "计划执行确认",
        toolName: EXIT_PLAN_MODE_TOOL_NAME,
        planContent: `## PaymentService 高并发重构计划

### 第一阶段：乐观锁引入
- 在 PaymentRepository 中添加 version 字段
- 实现 withOptimisticLock 中间件
- 处理乐观锁冲突重试逻辑

### 第二阶段：缓存层接入
- 引入 Redis 作为热数据缓存
- 实现缓存失效策略（TTL + 主动失效）
- 添加缓存命中率监控

### 第三阶段：异步化改造
- 将审计日志改为异步写入
- 接入消息队列处理非核心流程
- 性能基准测试与对比`,
      },
      "../../docs/public/screenshots/desktop-plan-confirm.webp",
    );
  });

  test("6) 进入计划模式确认", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(webviewPage, injector);
    await seedMessages(
      webviewPage,
      injector,
      [
        MockDataGenerator.createUserMessage(
          "接下来进入计划模式吧，先梳理重构方案，不要直接改代码",
          "msg-epm-u1",
        ),
        MockDataGenerator.createAssistantMessage(
          "好的，我先切换到计划模式，只做方案调研与规划。",
          "msg-epm-a1",
        ),
      ],
      "切换到计划模式",
    );
    await captureConfirmation(
      webviewPage,
      injector,
      {
        confirmationId: "enter-plan-mode-001",
        confirmationType: "进入计划模式确认",
        toolName: ENTER_PLAN_MODE_TOOL_NAME,
        toolInput: {},
        hidePersistentOption: true,
      },
      "../../docs/public/screenshots/desktop-enter-plan-mode.webp",
    );
  });

  test("7) 交互式提问", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(webviewPage, injector);
    await seedMessages(
      webviewPage,
      injector,
      [
        MockDataGenerator.createUserMessage(
          "订单量上来了，缓存方案你帮我拿个主意",
          "msg-ask-u1",
        ),
        MockDataGenerator.createAssistantMessage(
          "两种缓存方案各有取舍，想先跟你确认一下偏好再动手：",
          "msg-ask-a1",
        ),
      ],
      "确认一下偏好",
    );
    await captureConfirmation(
      webviewPage,
      injector,
      {
        confirmationId: "ask-user-123",
        toolName: ASK_USER_QUESTION_TOOL_NAME,
        confirmationType: "问题待回答",
        toolInput: {
          questions: [
            {
              header: "缓存方案",
              question: "支付服务应该采用哪种缓存策略？",
              options: [
                {
                  label: "Redis Cluster",
                  description: "分布式缓存，高可用，支持自动故障转移",
                },
                {
                  label: "Redis Sentinel",
                  description: "主从架构，自动故障转移，适合中等规模",
                },
              ],
            },
          ],
        },
      },
      "../../docs/public/screenshots/desktop-ask-user.webp",
    );
  });

  test("8) 安全区域配置案例（自动接受修改）", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(webviewPage, injector);

    // 配置案例：permissions.additionalDirectories 将 /data/exports 纳入安全区域，
    // 配合「自动接受修改」模式，安全区域内的文件操作自动执行、无需确认。
    await injector.simulateExtensionMessage("updatePermissionMode", {
      mode: "acceptEdits",
    });
    const modeSelect = webviewPage.locator(".permission-mode-select");
    await expect(modeSelect).toHaveClass(/mode-acceptEdits/);

    await injector.updateMessages([
      MockDataGenerator.createUserMessage(
        "把 /data/exports 下的 export.ts 的导出格式改成 ESM 风格",
        "msg-safe-u1",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "该文件位于安全区域（settings.json 的 permissions.additionalDirectories 已配置 /data/exports），修改自动接受，无需逐次确认。",
        EDIT_TOOL_NAME,
        JSON.stringify({
          file_path: "/data/exports/config/export.ts",
          old_string: "module.exports = { run, report }",
          new_string: "export { run, report }",
        }),
        "文件已修改（安全区域内自动接受）",
      ),
    ]);
    await expect(
      webviewPage.getByText("/data/exports/config/export.ts"),
    ).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-safe-zone.webp",
    );
  });
});
