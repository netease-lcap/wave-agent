import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import * as sessionService from "../../src/services/session.js";
import type { Message, TextBlock } from "../../src/types/index.js";

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

describe("MessageManager Cross-Session Rewind", () => {
  let messageManager: MessageManager;
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    messageManager = new MessageManager({
      callbacks: {},
      workdir,
    });
  });

  it("should establish parentSessionId link after compression", () => {
    const oldSessionId = messageManager.getSessionId();
    messageManager.addUserMessage({ content: "msg1" });
    messageManager.compressMessagesAndUpdateSession("compressed content");

    expect(messageManager.getParentSessionId()).toBe(oldSessionId);
    expect(messageManager.getSessionId()).not.toBe(oldSessionId);
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

  it("should handle truncateHistory across session boundaries", async () => {
    const session1Id = "session1";
    const session2Id = "session2";

    const session1Messages = [
      { role: "user", blocks: [{ type: "text", content: "user1" }] },
      { role: "assistant", blocks: [{ type: "text", content: "assistant1" }] },
    ];
    const session2Messages = [
      { role: "assistant", blocks: [{ type: "compress", content: "summary" }] },
      { role: "user", blocks: [{ type: "text", content: "user2" }] },
    ];

    // Mock loadFullMessageThread to return concatenated messages (with compress block removed)
    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages: [
        session1Messages[0],
        session1Messages[1],
        session2Messages[1], // user2
      ] as Message[],
      sessionIds: [session1Id, session2Id],
    });

    // Mock loadSessionFromJsonl for both sessions
    vi.mocked(sessionService.loadSessionFromJsonl).mockImplementation(
      async (id) => {
        if (id === session1Id)
          return {
            id: session1Id,
            messages: session1Messages,
          } as unknown as sessionService.SessionData;
        if (id === session2Id)
          return {
            id: session2Id,
            messages: session2Messages,
            parentSessionId: session1Id,
          } as unknown as sessionService.SessionData;
        return null;
      },
    );

    // Set current session to session2
    messageManager.initializeFromSession({
      id: session2Id,
      messages: session2Messages,
      parentSessionId: session1Id,
      metadata: {
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
        workdir,
      },
    } as unknown as sessionService.SessionData);

    // Truncate to index 1 (assistant1 in session1)
    await messageManager.truncateHistory(1);

    // Verify session ID was restored to session1
    expect(messageManager.getSessionId()).toBe(session1Id);

    // Verify messages in memory are truncated
    const currentMessages = messageManager.getMessages();
    expect(currentMessages.length).toBe(1);
    expect((currentMessages[0].blocks[0] as TextBlock).content).toBe("user1");
  });
});
