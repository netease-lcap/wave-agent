import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import * as sessionService from "../../src/services/session.js";
import type {
  Message,
  CompressBlock,
  TextBlock,
} from "../../src/types/index.js";

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

describe("MessageManager Context-Safe Rewind", () => {
  let messageManager: MessageManager;
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    messageManager = new MessageManager({
      callbacks: {},
      workdir,
    });
  });

  it("should only load messages from the target session after rewind (preventing context overflow)", async () => {
    const session1Id = "session1";
    const session2Id = "session2";

    // Session 1: Original messages
    const session1Messages = [
      { role: "user", blocks: [{ type: "text", content: "user1" }] },
      { role: "assistant", blocks: [{ type: "text", content: "assistant1" }] },
    ];

    // Session 2: Starts with a summary of Session 1, then new messages
    const session2Messages = [
      {
        role: "assistant",
        blocks: [{ type: "compress", content: "summary of session 1" }],
      },
      { role: "user", blocks: [{ type: "text", content: "user2" }] },
      { role: "assistant", blocks: [{ type: "text", content: "assistant2" }] },
    ];

    // Mock loadFullMessageThread to return the concatenated thread (for the UI to show)
    // Note: loadFullMessageThread removes the 'compress' block when joining
    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages: [
        session1Messages[0],
        session1Messages[1],
        session2Messages[1], // user2
        session2Messages[2], // assistant2
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

    // Initialize current state as Session 2
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

    // SCENARIO: Rewind to "user2" in Session 2 (index 2 in the full thread)
    // Full thread index 2 corresponds to session2Messages[1]
    // We need to ensure the targetIndexInSession is calculated correctly.
    // In Session 2, messages are [compress, user2, assistant2].
    // index 2 in full thread [user1, assistant1, user2, assistant2] should map to session2Messages[1] (user2).
    // The logic in truncateHistory:
    // sid=session1: remainingIndex=2, effectiveMessages.length=2. remainingIndex < 2 is false. remainingIndex becomes 0.
    // sid=session2: remainingIndex=0, effectiveMessages.length=2. remainingIndex < 2 is true.
    // targetIndexInSession = hasCompressBlock (true) && sid !== sessionIds[0] (true) ? 0 + 1 : 0 = 1.
    // newMessagesInSession = session2Messages.slice(0, 1) = [compress].
    // Wait, if we want to KEEP user2, we should rewind to index 3 or change the logic.
    // Usually "rewind to X" means X is the LAST message.
    // But truncateHistory(index) does messages.slice(0, index), so index is EXCLUDED.
    // To keep user2 (index 2 in full thread), we need to call truncateHistory(3).
    await messageManager.truncateHistory(3);

    // VERIFICATION:
    // 1. Session ID remains session2
    expect(messageManager.getSessionId()).toBe(session2Id);

    // 2. Messages in memory should ONLY be from Session 2 (truncated)
    // This includes the 'compress' block (summary) + 'user2'
    const currentMessages = messageManager.getMessages();
    expect(currentMessages.length).toBe(2);
    expect(currentMessages[0].blocks[0].type).toBe("compress");
    expect((currentMessages[0].blocks[0] as CompressBlock).content).toBe(
      "summary of session 1",
    );
    expect((currentMessages[1].blocks[0] as TextBlock).content).toBe("user2");

    // 3. Ancestor messages (user1, assistant1) are NOT in the active message list
    const hasAncestor = currentMessages.some((m) =>
      m.blocks.some(
        (b) =>
          b.type === "text" &&
          (b.content === "user1" || b.content === "assistant1"),
      ),
    );
    expect(hasAncestor).toBe(false);
  });

  it("should restore ancestor session and its summary when rewinding to an earlier session", async () => {
    const session1Id = "session1";
    const session2Id = "session2";

    // Session 1: Already has a summary from a previous compression
    const session1Messages = [
      {
        role: "assistant",
        blocks: [{ type: "compress", content: "summary of root" }],
      },
      { role: "user", blocks: [{ type: "text", content: "user1" }] },
    ];

    const session2Messages = [
      {
        role: "assistant",
        blocks: [{ type: "compress", content: "summary of session 1" }],
      },
      { role: "user", blocks: [{ type: "text", content: "user2" }] },
    ];

    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages: [
        session1Messages[1], // user1
        session2Messages[1], // user2
      ] as Message[],
      sessionIds: [session1Id, session2Id],
    });

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

    // SCENARIO: Rewind to "user1" in Session 1 (index 0 in the full thread)
    // To keep user1 (index 0), we call truncateHistory(1)
    // In Session 1, messages are [compress, user1].
    // index 0 in full thread [user1, user2] should map to session1Messages[1] (user1).
    // The logic in truncateHistory:
    // sid=session1: remainingIndex=0, effectiveMessages.length=1. remainingIndex < 1 is true.
    // targetIndexInSession = hasCompressBlock (true) && sid !== sessionIds[0] (false) ? 0 + 1 : 0 = 0.
    // Wait, sid === sessionIds[0] is true for the first session.
    // So targetIndexInSession = 0.
    // newMessagesInSession = session1Messages.slice(0, 0) = [].
    // To keep user1, we need targetIndexInSession = 2.
    // If we call truncateHistory(1):
    // index=1. remainingIndex=1.
    // sid=session1: remainingIndex=1, effectiveMessages.length=1. remainingIndex < 1 is false. remainingIndex becomes 0.
    // sid=session2: remainingIndex=0, effectiveMessages.length=1. remainingIndex < 1 is true.
    // targetSessionId = session2.
    // So to keep user1, we must call truncateHistory(1) but the logic for targetIndexInSession needs to be correct.
    // Actually, if index=1, it means we keep 1 message from the full thread.
    // That 1 message is user1.
    // user1 is at session1Messages[1].
    // So we need targetIndexInSession = 2.

    // Let's adjust the test to call truncateHistory(1) and expect 2 messages if we fix the logic,
    // or just understand the current logic.
    // Current logic: targetIndexInSession = hasCompressBlock && sid !== sessionIds[0] ? remainingIndex + 1 : remainingIndex;
    // For sid=session1, sid === sessionIds[0], so targetIndexInSession = remainingIndex.
    // If remainingIndex = 1, targetIndexInSession = 1. session1Messages.slice(0, 1) = [compress].
    // Still missing user1.

    // The fix should be: if it's the first session, we don't skip anything, but we still need to account for the compress block if it exists.
    // If session1Messages[0] is compress, then user1 is at index 1.
    // So if we want to keep 1 message from the "effective" thread, we need to keep 2 messages from the session file.

    await messageManager.truncateHistory(1);

    // VERIFICATION:
    // 1. Session ID is restored to session1
    expect(messageManager.getSessionId()).toBe(session1Id);

    // 2. Messages in memory should be from Session 1 (truncated)
    // This includes the 'compress' block (summary of root) + 'user1'
    const currentMessages = messageManager.getMessages();
    expect(currentMessages.length).toBe(2);
    expect(currentMessages[0].blocks[0].type).toBe("compress");
    expect((currentMessages[0].blocks[0] as CompressBlock).content).toBe(
      "summary of root",
    );
    expect((currentMessages[1].blocks[0] as TextBlock).content).toBe("user1");
  });
});
