import { test, expect } from "../utils/webviewTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { BASH_TOOL_NAME, type Message } from "wave-agent-sdk";
import { screenshotWebp } from "../utils/screenshot.js";

test.describe("Tool Error Scrollable Demo", () => {
  test("should show scrollable tool error", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 400, height: 800 });

    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
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

    const longError = [
      "src/services/paymentService.ts(47,18): error TS2339: Property 'transactionId' does not exist on type 'PaymentIntent'.",
      "src/services/paymentService.ts(58,9): error TS2322: Type 'Promise<Refund>' is not assignable to type 'Refund'.",
      "src/services/sagaOrchestrator.ts(88,23): error TS2345: Argument of type 'string' is not assignable to parameter of type 'SagaStepDefinition'.",
      "src/services/sagaOrchestrator.ts(104,12): error TS7006: Parameter 'compensation' implicitly has an 'any' type.",
      "src/repositories/paymentRepository.ts(112,5): error TS2532: Object is possibly 'undefined'.",
      "src/repositories/paymentRepository.ts(140,11): error TS2451: Cannot redeclare block-scoped variable 'tx'.",
      "src/repositories/ledgerRepository.ts(66,27): error TS2339: Property 'entries' does not exist on type 'Ledger'.",
      "src/utils/retry.ts(23,14): error TS2554: Expected 2 arguments, but got 1.",
      "src/utils/retry.ts(31,3): error TS2322: Type 'number' is not assignable to type 'string'.",
      "src/utils/idempotency.ts(15,42): error TS2304: Cannot find name 'crypto'.",
      "src/index.ts(3,10): error TS2305: Module '\"./services/paymentService\"' has no exported member 'PaymentService'.",
      "",
      "error Command failed with exit code 2.",
      "pnpm: command failed",
    ].join("\n");
    const messageWithLongError = {
      id: "msg_long_error",
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: BASH_TOOL_NAME,
          stage: "end",
          compactParams: "pnpm -F @nebula/payment-service build",
          parameters: JSON.stringify({
            command: "pnpm -F @nebula/payment-service build",
          }),
          error: longError,
          success: false,
        },
      ],
    };

    const userMessage = {
      id: "msg_user_tool_error",
      role: "user",
      timestamp: "2025-07-09T10:29:00.000Z",
      blocks: [
        { type: "text", content: "帮我构建一下 payment-service 这个包" },
      ],
    };

    await injector.updateMessages([
      userMessage as unknown as Message,
      messageWithLongError as unknown as Message,
    ]);
    await webviewPage.waitForSelector(".tool-error");

    // Check if the error is displayed and has max-height
    const errorLocator = webviewPage.locator(".tool-error");
    const maxHeight = await errorLocator.evaluate(
      (el) => window.getComputedStyle(el).maxHeight,
    );
    const overflowY = await errorLocator.evaluate(
      (el) => window.getComputedStyle(el).overflowY,
    );

    expect(maxHeight).toBe("200px");
    expect(overflowY).toBe("auto");

    // Take a screenshot of the long error with scrollbar
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/tool-error-scrollable.webp",
    );
  });

  test("should show scrollable error block", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 400, height: 800 });

    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
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

    const longError = [
      "Error: Command failed: pnpm run package",
      "    at checkExecSyncError (node:child_process:890:11)",
      "    at execSync (node:child_process:962:15)",
      "    at packageExtension (/home/dev/projects/nebula/scripts/package.ts:42:5)",
      "    at main (/home/dev/projects/nebula/scripts/package.ts:78:3)",
      "    at Object.<anonymous> (/home/dev/projects/nebula/scripts/package.ts:81:1)",
      "    at Module._compile (node:internal/modules/cjs/loader:1198:14)",
      "    at Module._extensions..js (node:internal/modules/cjs/loader:1252:10)",
      "    at Module.load (node:internal/modules/cjs/loader:1076:32)",
      "    at Module._load (node:internal/modules/cjs/loader:911:12)",
      "",
      "npm ERR! code ELIFECYCLE",
      "npm ERR! errno 1",
      "npm ERR! nebula-platform@1.2.0 package: `node scripts/package.ts`",
      "npm ERR! Exit status 1",
      "npm ERR! ",
      "npm ERR! Failed at the nebula-platform@1.2.0 package script.",
      "npm ERR! This is probably not a problem with npm. There is likely additional logging output above.",
    ].join("\n");
    const messageWithLongError = {
      id: "msg_long_error_block",
      role: "assistant",
      blocks: [
        {
          type: "error",
          content: longError,
        },
      ],
    };

    const userMessage = {
      id: "msg_user_error_block",
      role: "user",
      timestamp: "2025-07-09T10:29:00.000Z",
      blocks: [{ type: "text", content: "运行下打包命令看看" }],
    };

    await injector.updateMessages([
      userMessage as unknown as Message,
      messageWithLongError as unknown as Message,
    ]);
    await webviewPage.waitForSelector(".message-content.error");

    // Check if the error is displayed and has max-height
    const errorLocator = webviewPage.locator(".message-content.error");
    const maxHeight = await errorLocator.evaluate(
      (el) => window.getComputedStyle(el).maxHeight,
    );
    const overflowY = await errorLocator.evaluate(
      (el) => window.getComputedStyle(el).overflowY,
    );

    expect(maxHeight).toBe("200px");
    expect(overflowY).toBe("auto");

    // Take a screenshot of the long error block with scrollbar
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/error-block-scrollable.webp",
    );
  });
});
