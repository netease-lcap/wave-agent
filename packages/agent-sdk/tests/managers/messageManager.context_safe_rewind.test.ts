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

describe("MessageManager Context-Safe Rewind (Single Session)", () => {
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

  it("should only see active messages after compaction (pre-compaction messages not visible)", async () => {
    // After compaction, loadFullMessageThread returns only active messages:
    // [compact, user2, assistant2] — pre-compaction messages are NOT included
    const activeMessages = [
      {
        id: "msg0",
        role: "assistant",
        blocks: [{ type: "compact", content: "summary of old conversation" }],
      },
      {
        id: "msg1",
        role: "user",
        blocks: [{ type: "text", content: "user2" }],
      },
      {
        id: "msg2",
        role: "assistant",
        blocks: [{ type: "text", content: "assistant2" }],
      },
    ];

    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages: activeMessages as Message[],
      sessionIds: [messageManager.getSessionId()],
    });

    messageManager.setMessages(activeMessages as Message[]);

    // Truncate to index 2 (keep compact + user2)
    await messageManager.truncateHistory(2);

    const currentMessages = messageManager.getMessages();
    expect(currentMessages.length).toBe(2);
    expect(currentMessages[0].blocks[0].type).toBe("compact");
    expect((currentMessages[1].blocks[0] as TextBlock).content).toBe("user2");

    // Pre-compaction messages are NOT in the active set
    const hasOldMessage = currentMessages.some((m) =>
      m.blocks.some(
        (b) => b.type === "text" && (b as TextBlock).content.includes("user1"),
      ),
    );
    expect(hasOldMessage).toBe(false);
  });

  it("should preserve compact boundary when truncating after it", async () => {
    // Session with compact boundary at index 0
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

    // Truncate to index 3 (keep compact + user1 + assistant1)
    await messageManager.truncateHistory(3);

    const currentMessages = messageManager.getMessages();
    expect(currentMessages.length).toBe(3);
    expect(currentMessages[0].blocks[0].type).toBe("compact");
    expect((currentMessages[1].blocks[0] as TextBlock).content).toBe("user1");
    expect((currentMessages[2].blocks[0] as TextBlock).content).toBe(
      "assistant1",
    );
  });

  it("should allow truncating to just the compact boundary", async () => {
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
    ];

    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages: messages as Message[],
      sessionIds: [messageManager.getSessionId()],
    });

    messageManager.setMessages(messages as Message[]);

    // Truncate to index 1 (keep only compact)
    await messageManager.truncateHistory(1);

    const currentMessages = messageManager.getMessages();
    expect(currentMessages.length).toBe(1);
    expect(currentMessages[0].blocks[0].type).toBe("compact");
  });
});
