import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

test.describe("Product Spec: /model 命令", () => {
  test("should capture model popup screenshot", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Setup a conversation
    const messages = [
      MockDataGenerator.createUserMessage(
        "帮我分析 PaymentService 的并发问题，看看有没有竞态条件",
      ),
      MockDataGenerator.createAssistantMessage(
        "我已经分析了 PaymentService 的代码，发现 `processPayment` 方法中存在竞态条件。当前的悲观锁实现会导致高并发下性能下降，建议改用乐观锁...",
      ),
    ];
    await injector.updateMessages(messages);
    await injector.endStreaming();

    // Type /model and send it
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/model");
    await webviewPage.keyboard.press("Enter");

    // Wait for the getConfiguredModels request to be sent to the host
    await injector.waitForMessage("getConfiguredModels");

    // Inject the configured models response
    await injector.simulateExtensionMessage("configuredModels", {
      models: ["claude-sonnet-4-5", "gpt-4o", "deepseek-v3.2", "glm-5.2"],
      currentModel: "claude-sonnet-4-5",
    });

    // Wait for the popup to appear with items
    await webviewPage.waitForSelector(".model-popup-item", {
      state: "visible",
      timeout: 5000,
    });

    // Verify all 4 models are listed
    const items = webviewPage.locator(".model-popup-item");
    await expect(items).toHaveCount(4);

    // Verify the current model is marked with a check icon
    const currentItem = items.filter({ hasText: "claude-sonnet-4-5" });
    await expect(currentItem.locator(".model-popup-item-check")).toBeVisible();

    // Verify the current model is highlighted by default
    const selected = webviewPage.locator(".model-popup-item.selected");
    await expect(selected).toContainText("claude-sonnet-4-5");

    // Screenshot the popup
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-model-popup.webp",
    );
  });

  test("should switch model with keyboard navigation", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    // Setup a minimal conversation
    const messages = [MockDataGenerator.createUserMessage("你好")];
    await injector.updateMessages(messages);
    await injector.endStreaming();

    // Open the /model popup
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/model");
    await webviewPage.keyboard.press("Enter");
    await injector.waitForMessage("getConfiguredModels");
    await injector.simulateExtensionMessage("configuredModels", {
      models: ["claude-sonnet-4-5", "gpt-4o"],
      currentModel: "claude-sonnet-4-5",
    });
    await webviewPage.waitForSelector(".model-popup-item", {
      state: "visible",
      timeout: 5000,
    });

    // Navigate down and select the second model
    await webviewPage.keyboard.press("ArrowDown");
    const selected = webviewPage.locator(".model-popup-item.selected");
    await expect(selected).toContainText("gpt-4o");
    await webviewPage.keyboard.press("Enter");

    // The popup closes and setModel is sent to the host with the picked model
    await expect(webviewPage.locator(".model-popup")).toBeHidden();
    await webviewPage.waitForFunction(() => {
      const msgs = window.getTestMessages ? window.getTestMessages() : [];
      const msg = msgs.find((m) => m.command === "setModel");
      return msg && msg.model === "gpt-4o";
    });
  });
});
