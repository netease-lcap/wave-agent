import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import {
  screenshotWebp,
  elementScreenshotWebp,
} from "../e2e/utils/screenshot.js";

test.describe("Product Spec: /btw side question", () => {
  test("should capture the /btw panel with a markdown answer", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    // Provide initial state for a logged-in user (auth gates the input area)
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
    });

    // Setup a conversation so the panel shows above a real chat
    const messages = [
      MockDataGenerator.createUserMessage("帮我看下 PaymentService 的并发问题"),
      MockDataGenerator.createAssistantMessage(
        "我已经分析了 PaymentService 的代码，发现 `processPayment` 方法中存在竞态条件，建议改用乐观锁...",
      ),
    ];
    await injector.updateMessages(messages);
    await injector.endStreaming();

    // Type /btw <question> and send it — no chat message is posted
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/btw 乐观锁的实现思路是什么？");
    await webviewPage.keyboard.press("Enter");

    // Wait for the askBtw RPC to be sent to the extension
    await webviewPage.waitForFunction(() => {
      const msgs = window.getTestMessages ? window.getTestMessages() : [];
      return msgs.some((m) => m.command === "askBtw");
    });

    // Inject the side answer (markdown)
    await injector.simulateExtensionMessage("btwResponse", {
      question: "乐观锁的实现思路是什么？",
      answer:
        "**乐观锁**的核心思路是：读取时不加锁，更新时通过版本号（`version`）或时间戳校验数据是否被他人修改。\n\n- 读取数据并记录版本号\n- 更新时 `SET version = version + 1 WHERE version = 旧值`\n- 受影响行数为 0 时说明已被修改，重试或放弃\n\n相比悲观锁，乐观锁在低冲突场景下吞吐更高，适合读多写少的业务。",
    });

    // Panel shows the answer, chat history stays untouched
    await expect(
      webviewPage.locator('[data-testid="btw-turn-question"]'),
    ).toContainText("乐观锁的实现思路是什么？");
    await expect(
      webviewPage.locator('[data-testid="btw-panel-answer"]'),
    ).toBeVisible();
    await expect(
      webviewPage.locator('[data-testid="btw-panel-answer"]'),
    ).toContainText("乐观锁");

    // Full screenshot showing the panel above the input
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-btw-panel.webp",
    );
  });

  test("should capture the bare /btw usage hint", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    // Initialize first — the loading sweep keeps the input area hidden until
    // setInitialState, and this scenario has no conversation messages to bring
    // it up.
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
    });
    // Type bare /btw and send it — shows usage, sends no RPC
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/btw");
    await webviewPage.keyboard.press("Enter");

    await expect(
      webviewPage.locator('[data-testid="btw-panel"]'),
    ).toBeVisible();
    await expect(
      webviewPage.locator('[data-testid="btw-panel-empty"]'),
    ).toContainText("用法：/btw <你的问题>");

    await elementScreenshotWebp(
      webviewPage.locator('[data-testid="btw-panel"]'),
      "../../docs/public/screenshots/spec-btw-usage.webp",
    );
  });

  test("should capture the /btw panel with a follow-up round", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
    });

    await injector.updateMessages([
      MockDataGenerator.createUserMessage("帮我看下 PaymentService 的并发问题"),
      MockDataGenerator.createAssistantMessage(
        "我已经分析了 PaymentService 的代码，发现 `processPayment` 方法中存在竞态条件，建议改用乐观锁...",
      ),
    ]);
    await injector.endStreaming();

    // Round 1 — asked from the main input (`/btw <question>`).
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/btw 乐观锁的实现思路是什么？");
    await webviewPage.keyboard.press("Enter");
    await webviewPage.waitForFunction(() => {
      const msgs = window.getTestMessages ? window.getTestMessages() : [];
      return msgs.some((m) => m.command === "askBtw");
    });
    await injector.simulateExtensionMessage("btwResponse", {
      question: "乐观锁的实现思路是什么？",
      answer:
        "**乐观锁**：读取不加锁，更新时用 `version` 校验数据有没有被改过（受影响行数为 0 就重试）。省掉悲观锁的阻塞成本，适合读多写少。",
    });
    await expect(
      webviewPage.locator('[data-testid="btw-panel-answer"]'),
    ).toContainText("乐观锁");

    // Round 2 — asked from the panel input, which is what makes it a side chat.
    await webviewPage.focus('[data-testid="btw-panel-input"]');
    await webviewPage.keyboard.type("那版本号和 CAS 该选哪个？");
    await webviewPage.keyboard.press("Enter");
    await webviewPage.waitForFunction(() => {
      const msgs = window.getTestMessages ? window.getTestMessages() : [];
      return msgs.filter((m) => m.command === "askBtw").length >= 2;
    });

    // The follow-up carries the finished round as history (no re-explaining).
    const followUp = await webviewPage.evaluate(() => {
      const msgs = window.getTestMessages ? window.getTestMessages() : [];
      const asks = msgs.filter((m) => m.command === "askBtw");
      return asks[asks.length - 1] as unknown as {
        requestId?: string;
        history?: unknown[];
      };
    });
    expect(followUp.history).toEqual([
      {
        question: "乐观锁的实现思路是什么？",
        answer: expect.stringContaining("乐观锁"),
      },
    ]);

    await injector.simulateExtensionMessage("btwResponse", {
      requestId: followUp.requestId,
      question: "那版本号和 CAS 该选哪个？",
      answer:
        "两者是同一件事的两种写法：**版本号**（业务表自带 `version` 字段，直观，跨表要定版本挂谁身上）和 **CAS**（只比对被改的值，省字段但有 ABA 问题）。表能加字段就选版本号，存量表改不动再退到 CAS。",
    });

    await expect(webviewPage.locator('[data-testid="btw-turn"]')).toHaveCount(
      2,
    );
    await expect(
      webviewPage.locator('[data-testid="btw-panel-input"]'),
    ).toHaveAttribute("placeholder", "继续提问，Enter 发送");

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-btw-followup.webp",
    );
  });
});
