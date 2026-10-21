import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

/**
 * 输入卡片底栏的模型选择器（spec ui/model-selection.md「输入卡片底栏切换模型」）。
 * 清单与当前模型由宿主下发，页面挂载即拉；截图取「下拉展开」态。
 */
const MODELS = [
  { name: "claude-sonnet-4-5", supportsVision: true },
  { name: "gpt-4o", supportsVision: true },
  { name: "deepseek-v3.2", supportsVision: false },
  { name: "glm-5.2", supportsVision: false },
];

test.describe("Product Spec: 输入卡片底栏模型选择器", () => {
  test("should capture model picker screenshot", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
      session: {
        id: "s-model-1",
        sessionType: "main",
        workdir: "/Users/dev/projects/wave",
        lastActiveAt: Date.now(),
      },
    });

    await injector.updateMessages([
      MockDataGenerator.createUserMessage(
        "帮我分析 PaymentService 的并发问题，看看有没有竞态条件",
      ),
      MockDataGenerator.createAssistantMessage(
        "我已经分析了 PaymentService 的代码，发现 `processPayment` 方法中存在竞态条件。当前的悲观锁实现会导致高并发下性能下降，建议改用乐观锁...",
      ),
    ]);
    await injector.endStreaming();

    // 挂载即向宿主拉清单（底栏要显示当前模型，不等用户敲命令）。
    await injector.waitForMessage("getConfiguredModels");
    await injector.simulateExtensionMessage("configuredModels", {
      models: MODELS,
      currentModel: "claude-sonnet-4-5",
    });

    const trigger = webviewPage.getByTestId("model-picker-trigger");
    await expect(trigger).toContainText("claude-sonnet-4-5");
    await trigger.click();

    await webviewPage.waitForSelector(".model-picker-item", {
      state: "visible",
      timeout: 5000,
    });
    await expect(webviewPage.locator(".model-picker-item")).toHaveCount(4);
    // 当前项带勾选，能读图的模型带「视觉」标识。
    await expect(
      webviewPage.getByTestId("model-picker-item-claude-sonnet-4-5"),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      webviewPage.getByTestId("model-picker-item-claude-sonnet-4-5"),
    ).toContainText("视觉");
    await expect(
      webviewPage.getByTestId("model-picker-item-deepseek-v3.2"),
    ).not.toContainText("视觉");

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-model-picker.webp",
    );
  });

  test("should switch model by clicking an item", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    await injector.simulateExtensionMessage("setInitialState", {
      messages: [MockDataGenerator.createUserMessage("你好")],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
      session: {
        id: "s-model-2",
        sessionType: "main",
        workdir: "/Users/dev/projects/wave",
        lastActiveAt: Date.now(),
      },
    });
    await injector.endStreaming();

    await injector.waitForMessage("getConfiguredModels");
    await injector.simulateExtensionMessage("configuredModels", {
      models: MODELS.slice(0, 2),
      currentModel: "claude-sonnet-4-5",
    });

    const trigger = webviewPage.getByTestId("model-picker-trigger");
    await trigger.click();
    await webviewPage.getByTestId("model-picker-item-gpt-4o").click();

    // 选中即生效：按钮回显新模型，`setModel` 发给宿主。
    await expect(trigger).toContainText("gpt-4o");
    await expect(webviewPage.locator(".model-picker-menu")).toHaveCount(0);
    await webviewPage.waitForFunction(() => {
      const msgs = window.getTestMessages ? window.getTestMessages() : [];
      const msg = msgs.find((m) => m.command === "setModel");
      return msg && msg.model === "gpt-4o";
    });
  });
});
