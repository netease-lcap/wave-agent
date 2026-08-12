import { test, expect } from "../utils/webviewTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { UIStateVerifier } from "../utils/uiStateVerifier.js";
import { MockDataGenerator } from "../fixtures/mockData.js";
import { screenshotWebp } from "../utils/screenshot.js";

test.describe("Product Spec: Rewind", () => {
  test("should capture rewind button screenshot", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    const ui = new UIStateVerifier(webviewPage);

    // Setup a conversation
    const messages = [
      MockDataGenerator.createUserMessage(
        "帮我分析 PaymentService 的并发问题，看看有没有竞态条件",
      ),
      MockDataGenerator.createAssistantMessage(
        "我已经分析了 PaymentService 的代码，发现 `processPayment` 方法中存在竞态条件。当前的悲观锁实现会导致高并发下性能下降，建议改用乐观锁...",
      ),
      MockDataGenerator.createUserMessage(
        "好的，请为乐观锁实现编写单元测试，覆盖并发冲突场景",
      ),
    ];
    await injector.updateMessages(messages);
    await injector.endStreaming();

    // Hover over the first user message to show the rewind button, then hover the button to show tooltip
    const firstUserMessage = ui.userMessages.first();
    await firstUserMessage.hover();

    const rewindBtn = firstUserMessage.locator(".message-action-btn");
    await expect(rewindBtn).toBeVisible();
    await rewindBtn.hover();

    // Take screenshot of the message list showing the rewind button with tooltip
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-rewind-button.webp",
      {
        clip: (await ui.messagesContainer.boundingBox()) || undefined,
      },
    );
  });

  test("should capture /rewind popup screenshot", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Setup a conversation with several user messages
    const messages = [
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
        "已为乐观锁实现编写了 5 个单元测试，覆盖了并发冲突、重试机制和超时场景...",
      ),
      MockDataGenerator.createUserMessage(
        "测试全部通过了，现在帮我把改动提交到 git",
      ),
    ];
    await injector.updateMessages(messages);
    await injector.endStreaming();

    // Type /rewind and send it
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/rewind");
    await webviewPage.keyboard.press("Enter");

    // Wait for the listRewindCheckpoints request to be sent to the extension
    await webviewPage.waitForFunction(() => {
      const msgs = window.getTestMessages ? window.getTestMessages() : [];
      return msgs.some((m) => m.command === "listRewindCheckpoints");
    });

    // Inject the checkpoints response
    await injector.simulateExtensionMessage("rewindCheckpoints", {
      checkpoints: [
        {
          id: "cp-1",
          content: "帮我分析 PaymentService 的并发问题，看看有没有竞态条件",
        },
        {
          id: "cp-2",
          content: "好的，请为乐观锁实现编写单元测试，覆盖并发冲突场景",
        },
        { id: "cp-3", content: "测试全部通过了，现在帮我把改动提交到 git" },
      ],
    });

    // Wait for the popup to appear with items
    await webviewPage.waitForSelector(".rewind-popup-item", {
      state: "visible",
      timeout: 5000,
    });

    // Verify all 3 checkpoints are listed
    const items = webviewPage.locator(".rewind-popup-item");
    await expect(items).toHaveCount(3);

    // Verify the last item is selected by default
    const selected = webviewPage.locator(".rewind-popup-item.selected");
    await expect(selected).toContainText("测试全部通过了");

    // Screenshot the popup
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-rewind-popup.webp",
    );
  });
});
