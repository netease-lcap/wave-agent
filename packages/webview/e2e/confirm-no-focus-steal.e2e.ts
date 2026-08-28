import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { BASH_TOOL_NAME, type Message } from "wave-agent-sdk";

/**
 * Confirmation dialog focus behavior (confirm-ui.md「确认弹窗不打断输入」):
 * the dialog must never move focus when it opens — the user may be typing in
 * the message input (same pane, sibling pane, another window). Keys pressed
 * outside the dialog keep their normal meaning; keys work on the dialog only
 * once the user clicks or Tabs into it.
 */
test.describe("Confirmation dialog does not steal focus", () => {
  async function openBashConfirmation(
    webviewPage: import("@playwright/test").Page,
    confirmationId: string,
  ) {
    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
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
    const msg: Message = {
      id: `msg_bash_${confirmationId}`,
      role: "assistant",
      timestamp: "2025-07-09T10:30:00.000Z",
      blocks: [
        {
          type: "tool",
          name: BASH_TOOL_NAME,
          stage: "running",
          parameters: JSON.stringify({ command: "npm install" }),
        },
      ],
    };
    await injector.updateMessages([msg]);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId,
      confirmationType: "Bash 命令执行确认",
      toolName: BASH_TOOL_NAME,
      toolInput: { command: "npm install" },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");
  }

  test("opening leaves the focus in the message input; Esc outside does not reject", async ({
    webviewPage,
  }) => {
    await openBashConfirmation(webviewPage, "no-steal");
    await webviewPage.click('[data-testid="message-input"]');
    await webviewPage.keyboard.type("hello");

    // The dialog opened earlier — the focus must still be in the input and
    // the typed characters must have landed there.
    const focused = await webviewPage.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.testid,
    );
    expect(focused).toBe("message-input");
    expect(
      await webviewPage.textContent('[data-testid="message-input"]'),
    ).toContain("hello");

    // Escape while typing keeps its abort-the-answer meaning; the pending
    // confirmation must survive.
    await webviewPage.keyboard.press("Escape");
    await expect(webviewPage.locator(".confirmation-dialog")).toBeVisible();
    await expect(webviewPage.locator(".confirmation-btn-apply")).toBeVisible();
  });

  test("Tab from the input walks into the dialog, Shift+Tab wraps to the close button", async ({
    webviewPage,
  }) => {
    await openBashConfirmation(webviewPage, "tab-in");
    await webviewPage.click('[data-testid="message-input"]');

    // Tab repeatedly until the focus enters the dialog (intermediate stops —
    // message-list controls — are legitimate Tab stops, so the first press
    // may not land there yet).
    let landed: { inside: boolean; cls: string } = { inside: false, cls: "" };
    for (let i = 0; i < 25 && !landed.inside; i++) {
      await webviewPage.keyboard.press("Tab");
      landed = await webviewPage.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return {
          inside: !!el?.closest(".confirmation-dialog"),
          cls: el?.className ?? "",
        };
      });
    }
    expect(landed.inside).toBe(true);

    // From the first focusable, Shift+Tab wraps to the last (close button) —
    // the in-dialog cycle. Enter the dialog at its first element first (the
    // action order follows the visual left-to-right layout, so resolve it
    // dynamically instead of assuming a specific action).
    await webviewPage.evaluate(() => {
      const dialog = document.querySelector(".confirmation-dialog");
      const first = dialog?.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    });
    await webviewPage.keyboard.press("Shift+Tab");
    const wrapped = await webviewPage.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        cls: el?.className ?? "",
        inside: !!el?.closest(".confirmation-dialog"),
      };
    });
    expect(wrapped.inside).toBe(true);
    expect(wrapped.cls).toContain("confirmation-close-btn");
  });

  test("Esc inside the dialog rejects it and focus returns to the input", async ({
    webviewPage,
  }) => {
    await openBashConfirmation(webviewPage, "esc-in");
    await webviewPage.click('[data-testid="message-input"]');

    // Enter the dialog with a click on the primary button area, then Esc.
    await webviewPage.locator(".confirmation-btn-apply").focus();
    await webviewPage.keyboard.press("Escape");
    await expect(webviewPage.locator(".confirmation-dialog")).toHaveCount(0);

    // Focus is restored to the message input.
    const focused = await webviewPage.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.testid,
    );
    expect(focused).toBe("message-input");
  });
});
