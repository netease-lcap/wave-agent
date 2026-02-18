import { Mocked } from "vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ReversionManager } from "../../src/managers/reversionManager.js";
import fs from "fs/promises";
import { Message } from "../../src/types/messaging.js";
import * as sessionService from "../../src/services/session.js";

vi.mock("fs/promises");
vi.mock("../../src/managers/reversionManager.js");
vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadFullMessageThread: vi.fn(),
    loadSessionFromJsonl: vi.fn(),
  };
});

describe("MessageManager History Truncation Integration", () => {
  let messageManager: MessageManager;
  let mockReversionManager: Mocked<ReversionManager>;
  const callbacks = {
    onMessagesChange: vi.fn(),
    onSessionIdChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    messageManager = new MessageManager({
      callbacks,
      workdir: "/test/workdir",
    });
    mockReversionManager = {
      revertTo: vi.fn().mockResolvedValue(1),
    } as unknown as Mocked<ReversionManager>;
  });

  it("should truncate history and call reversion manager", async () => {
    const messages = [
      {
        id: "msg1",
        role: "user",
        blocks: [{ type: "text", content: "u1" }],
      },
      {
        id: "msg2",
        role: "assistant",
        blocks: [{ type: "text", content: "a1" }],
      },
      {
        id: "msg3",
        role: "user",
        blocks: [{ type: "text", content: "u2" }],
      },
    ];
    messageManager.setMessages(messages as Message[]);

    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages: messages as Message[],
      sessionIds: [messageManager.getSessionId()],
    });
    vi.mocked(sessionService.loadSessionFromJsonl).mockResolvedValue({
      id: messageManager.getSessionId(),
      messages: messages as Message[],
      metadata: {
        workdir: "/test/workdir",
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    } as sessionService.SessionData);

    // Truncate from index 1 (removes msg2 and msg3)
    await messageManager.truncateHistory(1, mockReversionManager);

    expect(messageManager.getMessages()).toHaveLength(1);
    expect(messageManager.getMessages()[0].id).toBe("msg1");
    expect(mockReversionManager.revertTo).toHaveBeenCalledWith(
      ["msg2", "msg3"],
      expect.any(Array),
    );
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it("should throw error for invalid index", async () => {
    const messages = [
      {
        id: "msg1",
        role: "user",
        blocks: [{ type: "text", content: "u1" }],
      },
    ];
    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValue({
      messages: messages as Message[],
      sessionIds: [messageManager.getSessionId()],
    });

    await expect(messageManager.truncateHistory(-1)).rejects.toThrow(
      "Invalid message index",
    );
    await expect(messageManager.truncateHistory(10)).rejects.toThrow(
      "Invalid message index",
    );
  });
});
