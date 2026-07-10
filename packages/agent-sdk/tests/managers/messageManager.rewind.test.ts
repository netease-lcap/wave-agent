import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import * as sessionService from "../../src/services/session.js";
import type { Message, TextBlock } from "../../src/types/index.js";
import { Container } from "../../src/utils/container.js";

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
    loadSessionFromJsonl: vi.fn(),
    loadFullMessageThread: vi.fn(),
  };
});

describe("MessageManager Single-Session Rewind", () => {
  let messageManager: MessageManager;
  const workdir = "/test/workdir";
  const container = new Container();

  beforeEach(() => {
    vi.clearAllMocks();
    messageManager = new MessageManager(container, {
      callbacks: {},
      workdir,
    });
  });

  it("should keep same session ID after compaction (no parent session)", async () => {
    const originalSessionId = messageManager.getSessionId();
    messageManager.addUserMessage({ content: "msg1" });
    messageManager.addAssistantMessage("msg2");

    await messageManager.compactMessagesAndUpdateSession("compacted content");

    // Session ID stays the same — compaction appends to the same file
    expect(messageManager.getSessionId()).toBe(originalSessionId);
    // getRootSessionId returns the same ID (no separate root concept)
    expect(messageManager.getRootSessionId()).toBe(originalSessionId);
  });

  it("should call loadFullMessageThread when getFullMessageThread is called", async () => {
    const mockThread = {
      messages: [
        { role: "user", blocks: [{ type: "text", content: "msg1" }] },
      ] as Message[],
      sessionIds: ["session1"],
    };
    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue(
      mockThread,
    );

    const result = await messageManager.getFullMessageThread();
    expect(sessionService.loadFullMessageThread).toHaveBeenCalledWith(
      messageManager.getSessionId(),
      workdir,
    );
    expect(result).toEqual(mockThread);
  });

  it("should truncate history within a single session", async () => {
    const messages = [
      {
        id: "msg1",
        role: "user",
        blocks: [{ type: "text", content: "user1" }],
      },
      {
        id: "msg2",
        role: "assistant",
        blocks: [{ type: "text", content: "assistant1" }],
      },
      {
        id: "msg3",
        role: "user",
        blocks: [{ type: "text", content: "user2" }],
      },
    ];

    // Mock loadFullMessageThread to return current session's messages
    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages: messages as Message[],
      sessionIds: [messageManager.getSessionId()],
    });

    // Set messages in memory
    messageManager.setMessages(messages as Message[]);

    // Truncate to index 1 (keep only msg1)
    await messageManager.truncateHistory(1);

    // Verify messages in memory are truncated
    const currentMessages = messageManager.getMessages();
    expect(currentMessages.length).toBe(1);
    expect((currentMessages[0].blocks[0] as TextBlock).content).toBe("user1");
  });

  it("should truncate history after compaction boundary", async () => {
    // Simulate a session that has been compacted: [compact, user1, assistant1, user2]
    const messages = [
      {
        id: "msg0",
        role: "assistant",
        blocks: [{ type: "compact", content: "summary" }],
      },
      {
        id: "msg1",
        role: "user",
        blocks: [{ type: "text", content: "user1" }],
      },
      {
        id: "msg2",
        role: "assistant",
        blocks: [{ type: "text", content: "assistant1" }],
      },
      {
        id: "msg3",
        role: "user",
        blocks: [{ type: "text", content: "user2" }],
      },
    ];

    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages: messages as Message[],
      sessionIds: [messageManager.getSessionId()],
    });

    messageManager.setMessages(messages as Message[]);

    // Truncate to index 2 (keep compact + user1)
    await messageManager.truncateHistory(2);

    const currentMessages = messageManager.getMessages();
    expect(currentMessages.length).toBe(2);
    expect(currentMessages[0].blocks[0].type).toBe("compact");
    expect((currentMessages[1].blocks[0] as TextBlock).content).toBe("user1");
  });
});
