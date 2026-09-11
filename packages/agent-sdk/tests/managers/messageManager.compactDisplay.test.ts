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

describe("MessageManager compaction display stream", () => {
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

  it("initializeFromSession keeps the full transcript in displayMessages while folding the context", () => {
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

    // API context folds at the last compact boundary (restart semantics)...
    const context = messageManager.getMessages();
    expect(context.map((m) => m.id)).toEqual(["c1", "u2", "a2"]);

    // ...while the UI display stream keeps the full transcript, pre-compaction
    // history included.
    const display = messageManager.getDisplayMessages();
    expect(display.map((m) => m.id)).toEqual(["u1", "a1", "c1", "u2", "a2"]);
  });

  it("compaction then new messages keep the pre-compaction history in displayMessages", async () => {
    messageManager.addUserMessage({ content: "q1" });
    messageManager.addAssistantMessage("a1");
    messageManager.addUserMessage({ content: "q2" });
    messageManager.addAssistantMessage("a2");

    await messageManager.compactMessagesAndUpdateSession("summary");

    // A new round after compaction must not clobber the display stream with
    // the folded context ([compact, ...last rounds]).
    messageManager.addUserMessage({ content: "q3" });
    messageManager.addAssistantMessage("a3");

    const display = messageManager.getDisplayMessages();
    expect(
      display.map((m) => (m.blocks[0] as { content: string }).content),
    ).toEqual(["q1", "a1", "q2", "a2", "summary", "q3", "a3"]);
  });

  it("compaction then tool block updates sync the display stream without dropping history", async () => {
    messageManager.addUserMessage({ content: "q1" });
    messageManager.addAssistantMessage("a1");
    messageManager.addUserMessage({ content: "q2" });
    messageManager.addAssistantMessage("a2");

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

    const display = messageManager.getDisplayMessages();
    expect(
      display.map((m) => (m.blocks[0] as { content: string }).content),
    ).toEqual(["q1", "a1", "q2", "a2", "summary"]);
    // The updated message (not the trailing compact block) carries the tool
    // block in the display stream too.
    const updated = display.find((m) => m.id === lastAssistantId)!;
    expect(
      updated.blocks.some((b) => b.type === "tool" && b.name === "Write"),
    ).toBe(true);
  });

  it("clearMessages after compaction empties the display stream", async () => {
    messageManager.addUserMessage({ content: "q1" });
    messageManager.addAssistantMessage("a1");
    await messageManager.compactMessagesAndUpdateSession("summary");
    messageManager.clearMessages();
    expect(messageManager.getDisplayMessages()).toEqual([]);
  });
});
