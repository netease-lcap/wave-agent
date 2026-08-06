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

  it("should allow rewinding past the compact boundary to a pre-compact message", async () => {
    // Full thread as stored on disk: pre-compact messages are still present
    const messages = [
      {
        id: "msg1",
        role: "user",
        blocks: [{ type: "text", content: "old_user1" }],
      },
      {
        id: "msg2",
        role: "assistant",
        blocks: [{ type: "text", content: "old_assistant1" }],
      },
      {
        id: "msg3",
        role: "user",
        blocks: [{ type: "text", content: "old_user2" }],
      },
      {
        id: "msg4",
        role: "assistant",
        blocks: [{ type: "compact", content: "summary" }],
      },
      {
        id: "msg5",
        role: "user",
        blocks: [{ type: "text", content: "new_user" }],
      },
    ];

    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages: messages as Message[],
      sessionIds: [messageManager.getSessionId()],
    });

    messageManager.setMessages(messages as Message[]);

    // Rewind to old_user2 (index 2): drops it, the compact summary, and everything after
    await messageManager.truncateHistory(2);

    const currentMessages = messageManager.getMessages();
    expect(currentMessages.length).toBe(2);
    expect((currentMessages[0].blocks[0] as TextBlock).content).toBe(
      "old_user1",
    );
    expect((currentMessages[1].blocks[0] as TextBlock).content).toBe(
      "old_assistant1",
    );
  });

  it("should fold in-memory messages at the last compact boundary when rewinding past it", async () => {
    // Full thread as stored on disk after multiple compactions:
    // u1 a1 u2 a2 u3 a3 c1 u2 a2 u3 a3 u4 a4 c2 u3 a3 u4 a4 u5 a5
    const messages = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "one" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [{ type: "text", content: "hi1" }],
      },
      { id: "u2", role: "user", blocks: [{ type: "text", content: "two" }] },
      {
        id: "a2",
        role: "assistant",
        blocks: [{ type: "text", content: "hi2" }],
      },
      { id: "u3", role: "user", blocks: [{ type: "text", content: "three" }] },
      {
        id: "a3",
        role: "assistant",
        blocks: [{ type: "text", content: "hi3" }],
      },
      {
        id: "c1",
        role: "assistant",
        blocks: [{ type: "compact", content: "summary 1" }],
      },
      { id: "u2b", role: "user", blocks: [{ type: "text", content: "two" }] },
      {
        id: "a2b",
        role: "assistant",
        blocks: [{ type: "text", content: "hi2" }],
      },
      { id: "u3b", role: "user", blocks: [{ type: "text", content: "three" }] },
      {
        id: "a3b",
        role: "assistant",
        blocks: [{ type: "text", content: "hi3" }],
      },
      { id: "u4", role: "user", blocks: [{ type: "text", content: "four" }] },
      {
        id: "a4",
        role: "assistant",
        blocks: [{ type: "text", content: "hi4" }],
      },
      {
        id: "c2",
        role: "assistant",
        blocks: [{ type: "compact", content: "summary 2" }],
      },
      { id: "u3c", role: "user", blocks: [{ type: "text", content: "three" }] },
      {
        id: "a3c",
        role: "assistant",
        blocks: [{ type: "text", content: "hi3" }],
      },
      { id: "u4b", role: "user", blocks: [{ type: "text", content: "four" }] },
      {
        id: "a4b",
        role: "assistant",
        blocks: [{ type: "text", content: "hi4" }],
      },
      { id: "u5", role: "user", blocks: [{ type: "text", content: "five" }] },
      {
        id: "a5",
        role: "assistant",
        blocks: [{ type: "text", content: "hi5" }],
      },
    ] as Message[];

    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages,
      sessionIds: [messageManager.getSessionId()],
    });

    // Rewind to u5 (index 18): drops u5 + a5, file keeps everything before it
    await messageManager.truncateHistory(18);

    // In-memory messages are folded at the last compact boundary (c2),
    // matching compact/resume behavior — what the LLM/UI sees
    const currentMessages = messageManager.getMessages();
    expect(currentMessages.map((m) => m.id)).toEqual([
      "c2",
      "u3c",
      "a3c",
      "u4b",
      "a4b",
    ]);

    // The session file keeps the full truncated history (incl. pre-compact
    // duplicates) so checkpoints can still rewind before the compact boundary
    const { writeFile } = await import("fs/promises");
    expect(writeFile).toHaveBeenCalledTimes(1);
    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    const writtenIds = writtenContent
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { id: string }).id);
    expect(writtenIds).toEqual(messages.slice(0, 18).map((m) => m.id));
  });

  it("should not fold in-memory messages when no compact block exists", async () => {
    const messages = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "one" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [{ type: "text", content: "hi" }],
      },
      { id: "u2", role: "user", blocks: [{ type: "text", content: "two" }] },
    ] as Message[];

    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages,
      sessionIds: [messageManager.getSessionId()],
    });

    await messageManager.truncateHistory(2);

    expect(messageManager.getMessages().map((m) => m.id)).toEqual(["u1", "a1"]);
  });
});
