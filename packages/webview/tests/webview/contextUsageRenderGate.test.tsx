import { describe, it, expect, vi, afterEach } from "vitest";
import { renderChatApp, sendHostMessage, fixtures } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

/** A non-welcome conversation (has messages) so the indicator is eligible to render. */
function startedConversation(id: string) {
  return {
    session: {
      id,
      sessionType: "main" as const,
      workdir: "/tmp/test",
      createdAt: new Date(),
      lastActiveAt: new Date(),
      latestTotalTokens: 0,
    },
    messages: [MockDataGenerator.createUserMessage("hello", `msg-${id}`)],
  };
}

describe("context usage indicator render gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing while the host has not pushed any usage (spec 场景 4)", () => {
    renderChatApp();
    sendHostMessage(fixtures.setInitialState(startedConversation("session-a")));

    // 环 / 数字 / 气泡 / aria-label 一并消失，工具栏不留占位。
    expect(document.querySelector(".compress-context-button")).toBeNull();
    expect(document.querySelector(".compress-context-pct")).toBeNull();
  });

  it("renders nothing at 0% (spec 场景 1 例外：0 与「未知」同语义)", () => {
    renderChatApp();
    sendHostMessage(fixtures.setInitialState(startedConversation("session-a")));
    sendHostMessage(fixtures.contextUsage(0));

    expect(document.querySelector(".compress-context-button")).toBeNull();
  });
});
