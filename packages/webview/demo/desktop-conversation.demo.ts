import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { UIStateVerifier } from "../e2e/utils/uiStateVerifier.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Desktop 2.1 对话 screenshots: 1) 基础对话 2) AI 思考过程 3) 消息队列
// 4) 历史提示词 5) 对话回滚 — captured inside the desktop layout (sidebar +
// session tree). The shared webview bundle must be rebuilt first
// (node esbuild.config.mjs).
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
async function setup(
  injector: MessageInjector,
  messages: unknown[] = [],
  isStreaming = false,
) {
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
    isStreaming,
  });
}

// Realistic Chinese dev-task queue messages (same shape as the SDK queue item).
const QUEUE = [
  {
    id: "mq-0",
    content: "顺便帮乐观锁中间件补一组单元测试，覆盖并发写入时的版本号冲突场景",
  },
  {
    id: "mq-1",
    content: "把 PaymentService 里的重复重试逻辑抽成一个通用的指数退避工具函数",
  },
  {
    id: "mq-2",
    content: "给订单状态机加上非法状态流转的日志告警，方便线上排查",
  },
  {
    id: "mq-3",
    content:
      "梳理一下这次改动涉及的数据库迁移，确认回滚脚本是否完整，并在 CI 里加一个迁移演练的 job，避免上线时才发现字段不兼容导致回滚困难的问题",
  },
  { id: "mq-4", content: "更新 README 里的本地启动说明，补上新增的环境变量" },
];

test.describe("Desktop 2.1 对话 screenshots", () => {
  test("1) 基础对话", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(injector, [
      MockDataGenerator.createUserMessage(
        "帮我写一个防抖函数，要求支持取消上一次调用",
      ),
      MockDataGenerator.createAssistantMessage(
        "好的，下面是一个支持取消上一次调用的防抖实现：\n\n```ts\nexport function debounce<T extends (...args: any[]) => void>(\n  fn: T,\n  wait = 300,\n) {\n  let timer: ReturnType<typeof setTimeout> | null = null;\n  return (...args: Parameters<T>) => {\n    if (timer) clearTimeout(timer);\n    timer = setTimeout(() => {\n      timer = null;\n      fn(...args);\n    }, wait);\n  };\n}\n```\n\n**要点**：\n\n- 每次调用都会清除上一次的定时器，保证只有最后一次调用生效\n- 支持 TypeScript 泛型，参数类型自动推断\n\n需要我补充带 `leading` / `trailing` 选项的版本吗？",
      ),
    ]);
    await injector.endStreaming();

    await expect(
      webviewPage.locator(".message.assistant .message-content"),
    ).toContainText("debounce");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-basic-conversation.webp",
    );
  });

  test("2) AI 思考过程", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(injector, [
      MockDataGenerator.createUserMessage(
        "为什么分布式事务里悲观锁在高并发下性能会下降？",
      ),
      {
        id: "msg_reasoning_1",
        role: "assistant",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [
          {
            type: "reasoning",
            content:
              "用户问的是悲观锁在高并发下的性能问题，需要从锁竞争、事务持有时间、死锁三个角度展开。\n\n1. 悲观锁在获取到锁之前会一直阻塞等待，高并发下大量请求排队，事务持有锁的时间越长，队列越长。\n2. 锁竞争会导致 CPU 上下文切换开销增加，同时数据库连接被长时间占用，连接池容易耗尽。\n3. 多个事务互相等待对方的锁时可能形成死锁，需要数据库检测并回滚。\n\n对比来看，乐观锁通过版本号校验避免阻塞等待，读多写少场景下吞吐更高。",
            stage: "end",
            startTime: 1752030000000,
            endTime: 1752030008000,
          },
          {
            type: "text",
            content:
              "核心原因在于**锁的持有时间与等待队列**：悲观锁（如 `SELECT ... FOR UPDATE`）在提交前一直持有锁，高并发下请求逐个排队，事务吞吐直线下降，同时数据库连接被长时间占用，容易出现连接池耗尽与死锁。",
          },
        ],
      },
    ]);
    await injector.endStreaming();

    // Reasoning finished on load → collapsed by default; expand to show the
    // full thinking trace with the 思考 (用时 Xs) header.
    const reasoningHeader = webviewPage.locator(".reasoning-header");
    await expect(reasoningHeader).toBeVisible();
    await expect(reasoningHeader).toContainText("思考 (用时 8s)");
    await reasoningHeader.click();
    await expect(webviewPage.locator(".reasoning-content")).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-reasoning-block.webp",
    );
  });

  test("3) 消息队列", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 720 });
    await setup(
      injector,
      [
        MockDataGenerator.createUserMessage(
          "帮我分析 PaymentService 的分布式事务实现，看看有没有竞态条件",
        ),
        MockDataGenerator.createAssistantMessage(
          "好的，我正在扫描支付服务代码，分析事务边界和并发控制机制...",
        ),
      ],
      true, // isStreaming
    );

    // While the AI is busy, the send button becomes the 停止 button; typing a
    // new message queues it (handled by the extension).
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type(
      "顺便帮乐观锁中间件补一组单元测试，覆盖并发写入时的版本号冲突场景",
    );
    await expect(webviewPage.getByTestId("send-btn")).toHaveCount(0);
    await expect(webviewPage.getByTestId("abort-btn")).toBeVisible();
    await webviewPage.fill('[data-testid="message-input"]', "");

    // Inject a multi-item queue, then expand it.
    await injector.updateQueue(QUEUE);
    const queuePanel = webviewPage.getByTestId("queued-message-list");
    await expect(queuePanel).toBeVisible();
    await expect(queuePanel).toContainText(`消息队列 (${QUEUE.length})`);
    await queuePanel.locator(".queued-message-list-header").click();
    await expect(webviewPage.getByTestId("queued-item-mq-4")).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-message-queue.webp",
    );
  });

  test("4) 历史提示词", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(injector);

    // Ctrl/Cmd+R opens the history-search popup, which posts requestHistory.
    // Playwright's keyboard.press is swallowed by headless Chromium for this
    // chord, so dispatch the keydown directly on the content-editable input.
    await webviewPage.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="message-input"]',
      ) as HTMLElement;
      el.focus();
      const ev = new KeyboardEvent("keydown", {
        key: "r",
        code: "KeyR",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
    });
    await injector.waitForMessage("requestHistory", 5000);
    await injector.simulateExtensionMessage("historyResponse", {
      history: [
        {
          prompt:
            "为乐观锁中间件补一组单元测试，覆盖并发写入时的版本号冲突场景",
          timestamp: "2025-07-09T10:30:00.000Z",
        },
        {
          prompt:
            "把 PaymentService 里的重复重试逻辑抽成通用的指数退避工具函数",
          timestamp: "2025-07-09T09:12:00.000Z",
        },
        {
          prompt:
            "梳理这次改动的数据库迁移，确认回滚脚本完整并在 CI 里加迁移演练",
          timestamp: "2025-07-08T18:45:00.000Z",
        },
        {
          prompt: "排查压测时偶发的连接池耗尽，看是不是慢查询没释放连接",
          timestamp: "2025-07-08T11:20:00.000Z",
        },
      ],
    });
    await expect(webviewPage.getByTestId("history-search-popup")).toBeVisible();
    await expect(webviewPage.locator(".history-search-item")).toHaveCount(4);

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-history-search.webp",
    );
  });

  test("5) 对话回滚", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setup(injector, [
      MockDataGenerator.createUserMessage(
        "帮我分析 PaymentService 的并发问题，看看有没有竞态条件",
      ),
      MockDataGenerator.createAssistantMessage(
        "我已经分析了 PaymentService 的代码，发现 `processPayment` 方法中存在竞态条件。当前的悲观锁实现会导致高并发下性能下降，建议改用乐观锁...",
      ),
      MockDataGenerator.createUserMessage(
        "好的，请为乐观锁实现编写单元测试，覆盖并发冲突场景",
      ),
      MockDataGenerator.createAssistantMessage(
        "已为乐观锁实现编写了 5 个单元测试，覆盖并发冲突、重试机制和超时场景...",
      ),
    ]);
    await injector.endStreaming();

    // Hover the first user message → the rewind action appears above it.
    const ui = new UIStateVerifier(webviewPage);
    const firstUserMessage = ui.userMessages.first();
    await firstUserMessage.hover();
    const rewindBtn = firstUserMessage.locator(".message-action-btn");
    await expect(rewindBtn).toBeVisible();
    await rewindBtn.hover();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-rewind-button.webp",
    );
  });
});
