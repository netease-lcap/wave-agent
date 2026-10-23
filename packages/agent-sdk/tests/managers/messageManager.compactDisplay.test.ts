import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";
import { Message } from "../../src/types/index.js";

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

describe("MessageManager compaction list", () => {
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

  it("should handle compactMessagesAndUpdateSession and keep same session with last messages", async () => {
    const initialSessionId = messageManager.getSessionId();
    messageManager.addUserMessage({ content: "msg1" });
    messageManager.addAssistantMessage("msg2");
    messageManager.addUserMessage({ content: "msg3" });
    messageManager.addAssistantMessage("msg4");
    messageManager.addUserMessage({ content: "msg5" });

    await messageManager.compactMessagesAndUpdateSession("compacted content");

    const messages = messageManager.getMessages();
    expect(messages.length).toBe(4); // [compact] + msg3, msg4, msg5
    expect(messages[0].blocks[0].type).toBe("compact");
    expect((messages[0].blocks[0] as { content: string }).content).toBe(
      "compacted content",
    );
    expect((messages[1].blocks[0] as { content: string }).content).toBe("msg3");
    expect((messages[2].blocks[0] as { content: string }).content).toBe("msg4");
    expect((messages[3].blocks[0] as { content: string }).content).toBe("msg5");
    expect(messageManager.getSessionId()).toBe(initialSessionId);
  });

  it("compactMessagesAndUpdateSession hands the compact message to the callback", async () => {
    const onCompactBlockAdded = vi.fn();
    const manager = new MessageManager(container, {
      callbacks: { onCompactBlockAdded },
      workdir,
    });
    manager.addUserMessage({ content: "msg1" });
    manager.addAssistantMessage("msg2");

    await manager.compactMessagesAndUpdateSession("compacted content");

    // Hosts append this message to their webview list instead of pulling the
    // full list (spec: 压缩走增量通道).
    expect(onCompactBlockAdded).toHaveBeenCalledTimes(1);
    const [content, message] = onCompactBlockAdded.mock.calls[0] as [
      string,
      Message,
    ];
    expect(content).toBe("compacted content");
    expect(message).toEqual(
      expect.objectContaining({
        role: "assistant",
        blocks: [{ type: "compact", content: "compacted content" }],
      }),
    );
    // The same object is in the list after the fold — no second copy.
    expect(manager.getMessages()).toContain(message);
  });

  it("initializeFromSession rebuilds the list from the last compact boundary", () => {
    const makeMsg = (
      id: string,
      role: "user" | "assistant",
      content: string,
    ): Message => ({
      id,
      role,
      blocks: [{ type: "text", content }],
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const sessionData = {
      id: "sess-1",
      messages: [
        makeMsg("u1", "user", "old q"),
        makeMsg("a1", "assistant", "old a"),
        {
          id: "c1",
          role: "assistant",
          blocks: [{ type: "compact", content: "summary" }],
          timestamp: "2026-01-01T00:00:00.000Z",
        },
        makeMsg("u2", "user", "new q"),
        makeMsg("a2", "assistant", "new a"),
      ],
      metadata: {
        workdir: "/test/workdir",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
        latestTotalTokens: 0,
      },
    } as Parameters<MessageManager["initializeFromSession"]>[0];

    messageManager.initializeFromSession(sessionData);

    // List and context are the same array, and it starts at the last compact
    // boundary — a resumed session does not get its pre-compaction messages
    // back (spec ui/message-rendering-system.md「列表就是压缩后的上下文」).
    expect(messageManager.getMessages().map((m) => m.id)).toEqual([
      "c1",
      "u2",
      "a2",
    ]);

    // The transcript is untouched: the thread's lifetime totals still know the
    // whole conversation.
    const summary = messageManager.getThreadSummary();
    expect(summary.messageCount).toBe(5);
    expect(summary.firstUserText).toBe("old q");
  });

  it("compaction folds the list and later rounds append to the folded list", async () => {
    messageManager.addUserMessage({ content: "q1" });
    messageManager.addAssistantMessage("a1");
    messageManager.addUserMessage({ content: "q2" });
    messageManager.addAssistantMessage("a2");
    messageManager.addUserMessage({ content: "q3" });
    messageManager.addAssistantMessage("a3");

    await messageManager.compactMessagesAndUpdateSession("summary");

    // The fold is in the SDK's own list (last two API rounds are kept); the
    // hosts keep the pre-compaction messages on screen by appending — they
    // never replace the table here.
    messageManager.addUserMessage({ content: "q4" });
    messageManager.addAssistantMessage("a4");

    expect(
      messageManager
        .getMessages()
        .map((m) => (m.blocks[0] as { content: string }).content),
    ).toEqual(["summary", "q2", "a2", "q3", "a3", "q4", "a4"]);
  });

  it("tool block updates land on the folded list after compaction", async () => {
    messageManager.addUserMessage({ content: "q1" });
    messageManager.addAssistantMessage("a1");
    messageManager.addUserMessage({ content: "q2" });
    messageManager.addAssistantMessage("a2");
    messageManager.addUserMessage({ content: "q3" });
    messageManager.addAssistantMessage("a3");

    await messageManager.compactMessagesAndUpdateSession("summary");

    const lastAssistantId = [...messageManager.getMessages()]
      .reverse()
      .find(
        (m) =>
          m.role === "assistant" && !m.blocks.some((b) => b.type === "compact"),
      )!.id;
    messageManager.addToolBlockToMessage(lastAssistantId, {
      name: "Write",
      parameters: '{"path": "/tmp/a"}',
      stage: "start",
    } as Parameters<MessageManager["addToolBlockToMessage"]>[1]);

    const list = messageManager.getMessages();
    expect(
      list.map((m) => (m.blocks[0] as { content: string }).content),
    ).toEqual(["summary", "q2", "a2", "q3", "a3"]);
    // The updated message (not the summary block) carries the tool block.
    const updated = list.find((m) => m.id === lastAssistantId)!;
    expect(
      updated.blocks.some((b) => b.type === "tool" && b.name === "Write"),
    ).toBe(true);
  });

  it("clearMessages after compaction empties the list", async () => {
    messageManager.addUserMessage({ content: "q1" });
    messageManager.addAssistantMessage("a1");
    await messageManager.compactMessagesAndUpdateSession("summary");
    messageManager.clearMessages();
    expect(messageManager.getMessages()).toEqual([]);
  });
});
