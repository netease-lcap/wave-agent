import { test } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { type Message } from "wave-agent-sdk";
import {
  screenshotWebp,
  elementScreenshotWebp,
} from "../e2e/utils/screenshot.js";

/**
 * IDE 上下文提及（spec `ui/ide-context-mentions.md`）的文档站配图。
 *
 * 三张图覆盖「选 → 发 → 看」：`@` 下拉里的两个固定条目、用户气泡里的标签、
 * 点开后的全文弹窗。宿主侧读取（真终端 / 真诊断）不在这里验——那不是截图能
 * 证明的东西，真机断言在 `packages/vscode/tests-e2e/specs/ideContext.spec.cjs`
 * 与 `packages/jetbrains/.../IdeContextRealIdeTest.kt`。
 */
test.describe("IDE Context Mentions Screenshots", () => {
  test("capture @Terminal / @Problems from the dropdown to the preview", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    // 侧栏宽度：与 docs 其他截图一致。
    await webviewPage.setViewportSize({ width: 400, height: 800 });
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
    });

    // 1. `@` 下拉：Terminal / Problems 排在文件建议之前
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.press("Control+A");
    await webviewPage.keyboard.press("Backspace");
    await webviewPage.keyboard.type("@");

    const requestId = await webviewPage.evaluate(() => {
      return new Promise<string>((resolve) => {
        const check = () => {
          const messages = window.getTestMessages
            ? window.getTestMessages()
            : [];
          const requests = messages.filter(
            (message) => message.command === "requestFileSuggestions",
          );
          if (requests.length > 0) {
            resolve(requests[requests.length - 1].requestId as string);
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });
    });

    await injector.simulateExtensionMessage("fileSuggestionsResponse", {
      requestId,
      filterText: "",
      suggestions: [
        {
          path: "src/services/payment/PaymentService.ts",
          relativePath: "src/services/payment/PaymentService.ts",
          name: "PaymentService.ts",
          extension: "ts",
          icon: "codicon-file-code",
          isDirectory: false,
        },
        {
          path: "src/utils/eventBus.ts",
          relativePath: "src/utils/eventBus.ts",
          name: "eventBus.ts",
          extension: "ts",
          icon: "codicon-file-code",
          isDirectory: false,
        },
        {
          path: "package.json",
          relativePath: "package.json",
          name: "package.json",
          extension: "json",
          icon: "codicon-json",
          isDirectory: false,
        },
      ],
    });

    await webviewPage.waitForSelector(".suggestion-item", {
      state: "visible",
      timeout: 5000,
    });
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/ide-context-suggestions.webp",
    );

    // 2. 用户气泡里的两个标签
    await webviewPage.keyboard.press("Escape");
    await webviewPage.keyboard.press("Control+A");
    await webviewPage.keyboard.press("Backspace");

    const blocks = [
      "看一下这个构建输出和这两条报错，一起改掉",
      "[@ide:terminal]终端输出",
      "$ pnpm -F wave-webview build",
      "",
      "> wave-webview@1.4.0 build",
      "> node esbuild.config.mjs",
      "",
      "  dist/chat.js  1.24 MB  ⚡ Done in 214ms",
      "[/@ide]",
      "",
      "[@ide:problems]当前文件的问题（src/services/payment/PaymentService.ts）共 2 条：1 个错误 / 1 个警告",
      "  42:18  error    Type 'string' is not assignable to type 'number'. (ts)",
      "  57:7   warning  'retryCount' is declared but its value is never read. (ts)",
      "[/@ide]",
    ].join("\n");

    await injector.updateMessages([
      {
        id: "msg_demo_ide_context",
        role: "user",
        timestamp: "2026-10-22T10:30:00.000Z",
        blocks: [{ type: "text", content: blocks }],
      } as unknown as Message,
    ]);

    await webviewPage.waitForSelector('[data-path="ide:terminal"]', {
      state: "visible",
      timeout: 5000,
    });
    await elementScreenshotWebp(
      webviewPage.locator(".message.user").last(),
      "../../docs/public/screenshots/ide-context-tags.webp",
    );

    // 3. 点开终端标签：全文弹窗（内容就是 agent 收到的那段）
    await webviewPage
      .locator('[data-testid="messages-container"] [data-path="ide:terminal"]')
      .click();
    await webviewPage.waitForSelector(".ide-context-preview", {
      state: "visible",
      timeout: 5000,
    });
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/ide-context-preview.webp",
    );

    await webviewPage.locator(".ide-context-preview-close").click();
    await webviewPage.waitForSelector(".ide-context-preview", {
      state: "hidden",
      timeout: 5000,
    });
  });
});
