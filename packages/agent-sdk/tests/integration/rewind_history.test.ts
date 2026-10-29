import { Mocked } from "vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ReversionManager } from "../../src/managers/reversionManager.js";
import { Message } from "../../src/types/messaging.js";
import * as sessionService from "../../src/services/session.js";
import { Container } from "../../src/utils/container.js";
import { rewindCutOf } from "../helpers/transcriptScans.js";

vi.mock("fs/promises");
vi.mock("../../src/managers/reversionManager.js");
vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadFullMessageThread: vi.fn(),
    loadRewindCut: vi.fn(),
    loadSessionFromJsonl: vi.fn(),
    truncateSession: vi.fn().mockResolvedValue(undefined),
  };
});

describe("MessageManager History Truncation Integration", () => {
  let messageManager: MessageManager;
  let mockReversionManager: Mocked<ReversionManager>;
  const container = new Container();
  const callbacks = {
    onSessionIdChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    messageManager = new MessageManager(container, {
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

    vi.mocked(sessionService.loadRewindCut).mockImplementation(
      async (_sessionId, _workdir, index) =>
        rewindCutOf(messages as Message[], index),
    );
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
    // The messages being cut away are handed over directly: no id list plus a
    // whole-thread array to look them up in.
    expect(mockReversionManager.revertTo).toHaveBeenCalledWith([
      expect.objectContaining({ id: "msg2" }),
      expect.objectContaining({ id: "msg3" }),
    ]);
    // The session file keeps the first message; the rewrite delegates to the
    // session service, which filters the file's own lines (so reserved entries
    // such as the metadata header and the custom title survive).
    expect(sessionService.truncateSession).toHaveBeenCalledTimes(1);
    expect(sessionService.truncateSession).toHaveBeenCalledWith(
      messageManager.getSessionId(),
      1,
      "/test/workdir",
      "main",
    );
  });

  it("should throw error for invalid index", async () => {
    const messages = [
      {
        id: "msg1",
        role: "user",
        blocks: [{ type: "text", content: "u1" }],
      },
    ];
    vi.mocked(sessionService.loadRewindCut).mockImplementation(
      async (_sessionId, _workdir, index) =>
        rewindCutOf(messages as Message[], index),
    );

    await expect(messageManager.truncateHistory(-1)).rejects.toThrow(
      "Invalid message index",
    );
    await expect(messageManager.truncateHistory(10)).rejects.toThrow(
      "Invalid message index",
    );
  });
});
