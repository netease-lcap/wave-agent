import { describe, it, expect, vi } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import type { MessageManagerCallbacks } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";

describe("MessageManager - discardAssistantMessage (streaming fallback)", () => {
  const container = new Container();

  function createManager(callbacks: MessageManagerCallbacks = {}) {
    return new MessageManager(container, { callbacks, workdir: "/test" });
  }

  it("drops the message from the context and display streams and notifies hosts", () => {
    const onAssistantMessageDiscarded = vi.fn();
    const messageManager = createManager({ onAssistantMessageDiscarded });

    messageManager.addUserMessage({ content: "hello" });
    const messageId = messageManager.addAssistantMessage();
    messageManager.updateCurrentMessageContent("half an ans");

    expect(messageManager.getMessages()).toHaveLength(2);

    expect(messageManager.discardAssistantMessage(messageId)).toBe(true);
    expect(messageManager.getMessages()).toHaveLength(1);
    expect(messageManager.getDisplayMessages()).toHaveLength(1);
    expect(messageManager.getMessages()[0].role).toBe("user");
    expect(onAssistantMessageDiscarded).toHaveBeenCalledWith(messageId);
  });

  it("returns undefined ids and unknown ids untouched", () => {
    const messageManager = createManager();
    messageManager.addAssistantMessage();

    expect(messageManager.discardAssistantMessage(undefined)).toBe(false);
    expect(messageManager.discardAssistantMessage("does-not-exist")).toBe(
      false,
    );
    expect(messageManager.getMessages()).toHaveLength(1);
  });

  it("refuses to drop a message that is already persisted", async () => {
    const onAssistantMessageDiscarded = vi.fn();
    const messageManager = createManager({
      onAssistantMessageDiscarded,
    });

    // The assistant message is flushed to the session file, so its index is
    // below savedMessageCount — dropping it would make saveSession()'s
    // slice(savedMessageCount) skip the next live message.
    messageManager.addUserMessage({ content: "hello" });
    const messageId = messageManager.addAssistantMessage();
    messageManager.setSessionId("session-under-test");
    await messageManager.saveSession();

    expect(messageManager.discardAssistantMessage(messageId)).toBe(false);
    expect(messageManager.getMessages()).toHaveLength(2);
    expect(onAssistantMessageDiscarded).not.toHaveBeenCalled();
  });
});
