import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import type { Message } from "wave-agent-sdk";

// 220 messages (> VIRTUAL_SCROLL_THRESHOLD=200 → virtualized branch),
// ending on an assistant message (isUserMessage=false).
const longMessages: Message[] = [];
for (let i = 0; i < 110; i++) {
  longMessages.push(
    MockDataGenerator.createUserMessage(`user message ${i}`, `u-${i}`),
    MockDataGenerator.createAssistantMessage(`assistant reply ${i}`, `a-${i}`),
  );
}
const shortMessages = longMessages.slice(0, 20);

test.describe("session switch into long chat scrolls to bottom", () => {
  test("switch after user scrolled up in the previous session", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      configurationData: {
        apiKey: "sk-ant-api03-test",
        baseURL: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
      },
      permissionMode: "default",
    });

    // Phase 1: a short session loads and lands at the bottom.
    await injector.simulateExtensionMessage("updateCurrentSession", {
      session: { id: "sess-short" },
    });
    await injector.updateMessages(shortMessages);
    await webviewPage.waitForTimeout(400);

    // The user scrolls up in the current session (reading history) — this
    // must NOT leak into the next session's load.
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer")!;
      c.scrollTop = 100;
      c.dispatchEvent(new Event("scroll"));
    });
    await webviewPage.waitForTimeout(100);

    // Phase 2: user clicks the long session -> session id changes, then
    // SET_MESSAGES replaces the list. Must land at the bottom.
    await injector.simulateExtensionMessage("updateCurrentSession", {
      session: { id: "sess-long" },
    });
    await injector.updateMessages(longMessages);
    await webviewPage.waitForTimeout(1200);

    const phase2 = await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer")!;
      return {
        scrollTop: c.scrollTop,
        scrollHeight: c.scrollHeight,
        clientHeight: c.clientHeight,
      };
    });
    const gap = phase2.scrollHeight - phase2.scrollTop - phase2.clientHeight;
    expect(gap).toBeLessThan(2);
  });
});
