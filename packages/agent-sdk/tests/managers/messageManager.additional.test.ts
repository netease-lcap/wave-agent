import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import * as sessionService from "../../src/services/session.js";
import { Container } from "../../src/utils/container.js";
import { TextBlock } from "../../src/types/index.js";

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
}));

vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue(undefined),
    appendMessages: vi.fn().mockResolvedValue(undefined),
    loadFullMessageThread: vi.fn().mockImplementation(async (sessionId) => ({
      messages: [],
      sessionIds: [sessionId],
    })),
    loadSessionFromJsonl: vi.fn().mockImplementation(async (sessionId) => ({
      id: sessionId,
      messages: [],
      metadata: {
        workdir: "/test/workdir",
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    })),
  };
});

vi.mock("../../src/services/memory.js", () => ({
  getCombinedMemoryContent: vi.fn().mockResolvedValue("base memory"),
}));

describe("MessageManager additional coverage", () => {
  let messageManager: MessageManager;
  const workdir = "/test/workdir";
  const container = new Container();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const mockMemoryService = {
      getCombinedMemoryContent: vi.fn().mockResolvedValue("base memory"),
    };
    container.register(
      "MemoryService",
      mockMemoryService as unknown as Record<string, unknown>,
    );
    messageManager = new MessageManager(container, {
      callbacks: {},
      workdir,
    });
  });

  it("should add a user message and return its ID", () => {
    const id = messageManager.addUserMessage({ content: "Hello" });
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.startsWith("msg-")).toBe(true);

    const messages = messageManager.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe(id);
    expect(messages[0].role).toBe("user");
    expect((messages[0].blocks[0] as TextBlock).content).toBe("Hello");
  });

  it("should update an existing user message by ID", () => {
    const id = messageManager.addUserMessage({
      content: "Original content",
    });

    messageManager.updateUserMessage(id, {
      content: "Updated content",
    });

    const messages = messageManager.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe(id);
    expect((messages[0].blocks[0] as TextBlock).content).toBe(
      "Updated content",
    );
  });

  it("should only update the specified user message", () => {
    const id1 = messageManager.addUserMessage({ content: "Message 1" });
    const id2 = messageManager.addUserMessage({ content: "Message 2" });

    messageManager.updateUserMessage(id1, { content: "Updated Message 1" });

    const messages = messageManager.getMessages();
    expect(messages.length).toBe(2);

    const msg1 = messages.find((m) => m.id === id1);
    const msg2 = messages.find((m) => m.id === id2);

    expect((msg1!.blocks[0] as TextBlock).content).toBe("Updated Message 1");
    expect((msg2!.blocks[0] as TextBlock).content).toBe("Message 2");
  });

  it("should not update if ID does not match", () => {
    messageManager.addUserMessage({ content: "Message 1" });
    messageManager.updateUserMessage("non-existent-id", { content: "Updated" });

    const messages = messageManager.getMessages();
    expect((messages[0].blocks[0] as TextBlock).content).toBe("Message 1");
  });

  it("should handle saveSession with no new messages", async () => {
    await messageManager.saveSession();
    expect(sessionService.appendMessages).not.toHaveBeenCalled();
  });

  it("should handle saveSession error", async () => {
    vi.mocked(sessionService.createSession).mockRejectedValueOnce(
      new Error("Create failed"),
    );
    messageManager.addUserMessage({ content: "hello" });
    await messageManager.saveSession();
    // Should not throw
  });

  it("should skip saveSession when all unsaved messages are meta (lazy materialization)", async () => {
    messageManager.addUserMessage({
      content: "<system-reminder>SessionStart hook context</system-reminder>",
      isMeta: true,
    });

    await messageManager.saveSession();

    // Session file is not materialized yet (savedMessageCount === 0) and all
    // unsaved messages are meta -> nothing should be persisted.
    expect(sessionService.createSession).not.toHaveBeenCalled();
    expect(sessionService.appendMessages).not.toHaveBeenCalled();
  });

  it("should flush buffered meta messages together with the first real message", async () => {
    messageManager.addUserMessage({
      content: "<system-reminder>SessionStart hook context</system-reminder>",
      isMeta: true,
    });

    // Meta-only save is skipped: no file created, count not advanced.
    await messageManager.saveSession();
    expect(sessionService.createSession).not.toHaveBeenCalled();
    expect(sessionService.appendMessages).not.toHaveBeenCalled();

    messageManager.addUserMessage({ content: "Hello" });

    await messageManager.saveSession();
    expect(sessionService.createSession).toHaveBeenCalledTimes(1);
    expect(sessionService.appendMessages).toHaveBeenCalledTimes(1);

    // The meta message stays in memory and is flushed together with the
    // first real user message.
    const newMessages = vi.mocked(sessionService.appendMessages).mock
      .calls[0][1];
    expect(newMessages).toHaveLength(2);
    expect(newMessages[0].isMeta).toBe(true);
    expect(newMessages[1].isMeta).toBeFalsy();
  });

  it("should append meta messages normally once the session is materialized", async () => {
    messageManager.addUserMessage({ content: "Hello" });
    await messageManager.saveSession();
    expect(sessionService.appendMessages).toHaveBeenCalledTimes(1);

    // After the first real message the session file exists; later meta
    // messages (e.g. plan-mode reminders) append like any other message.
    messageManager.addUserMessage({
      content: "<system-reminder>Plan mode reminder</system-reminder>",
      isMeta: true,
    });

    await messageManager.saveSession();
    expect(sessionService.appendMessages).toHaveBeenCalledTimes(2);

    const newMessages = vi.mocked(sessionService.appendMessages).mock
      .calls[1][1];
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].isMeta).toBe(true);
  });

  it("should handle mergeAssistantAdditionalFields", () => {
    messageManager.addAssistantMessage("hello");
    messageManager.mergeAssistantAdditionalFields({
      key: "value",
      other: undefined,
    });

    const messages = messageManager.getMessages();
    expect(messages[0].additionalFields).toEqual({ key: "value" });

    // Merge more
    messageManager.mergeAssistantAdditionalFields({ key2: "value2" });
    expect(messageManager.getMessages()[0].additionalFields).toEqual({
      key: "value",
      key2: "value2",
    });

    // Empty merge
    messageManager.mergeAssistantAdditionalFields({});
    expect(messageManager.getMessages()[0].additionalFields).toEqual({
      key: "value",
      key2: "value2",
    });
  });

  it("should handle addInfoBlock", () => {
    messageManager.addAssistantMessage("hello");
    messageManager.addInfoBlock("some info");
    const messages = messageManager.getMessages();
    expect(messages[0].blocks).toContainEqual(
      expect.objectContaining({ type: "info", content: "some info" }),
    );
  });

  it("should handle addFileHistoryBlock", () => {
    messageManager.addAssistantMessage("hello");
    messageManager.addFileHistoryBlock([
      {
        path: "test.ts",
        content: "content",
        timestamp: "now",
      } as unknown as Parameters<MessageManager["addFileHistoryBlock"]>[0][0],
    ]);
    const messages = messageManager.getMessages();
    expect(messages[0].blocks).toContainEqual(
      expect.objectContaining({ type: "file_history" }),
    );
  });

  it("should handle updateCurrentMessageReasoning", () => {
    messageManager.addAssistantMessage("hello");
    messageManager.updateCurrentMessageReasoning("thinking...");
    messageManager.updateCurrentMessageReasoning("thinking... more");

    const messages = messageManager.getMessages();
    const reasoningBlock = messages[0].blocks.find(
      (b) => b.type === "reasoning",
    ) as { content: string };
    expect(reasoningBlock.content).toBe("thinking... more");
  });

  it("should handle truncateHistory", async () => {
    messageManager.addUserMessage({ content: "msg1" });
    messageManager.addAssistantMessage("msg2");
    messageManager.addUserMessage({ content: "msg3" });

    const messages = messageManager.getMessages();
    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValueOnce({
      messages,
      sessionIds: [messageManager.getSessionId()],
    });
    vi.mocked(sessionService.loadSessionFromJsonl).mockResolvedValue({
      id: messageManager.getSessionId(),
      messages,
      metadata: {
        workdir: "/test/workdir",
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    });

    await messageManager.truncateHistory(1);
    expect(messageManager.getMessages().length).toBe(1);
    expect(messageManager.getMessages()[0].blocks[0].type).toBe("text");
    expect(
      (messageManager.getMessages()[0].blocks[0] as { content: string })
        .content,
    ).toBe("msg1");
  });
});
