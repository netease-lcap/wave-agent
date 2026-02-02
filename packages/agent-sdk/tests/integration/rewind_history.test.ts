import { Mocked } from "vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ReversionManager } from "../../src/managers/reversionManager.js";
import fs from "fs/promises";
import { Message } from "../../src/types/messaging.js";

vi.mock("fs/promises");
vi.mock("../../src/managers/reversionManager.js");

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
        role: "user",
        blocks: [{ type: "text", content: "u1" }],
        additionalFields: { id: "msg1" },
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "a1" }],
        additionalFields: { id: "msg2" },
      },
      {
        role: "user",
        blocks: [{ type: "text", content: "u2" }],
        additionalFields: { id: "msg3" },
      },
    ];
    messageManager.setMessages(messages as Message[]);

    // Truncate from index 1 (removes msg2 and msg3)
    await messageManager.truncateHistory(1, mockReversionManager);

    expect(messageManager.getMessages()).toHaveLength(1);
    expect(messageManager.getMessages()[0].additionalFields?.id).toBe("msg1");
    expect(mockReversionManager.revertTo).toHaveBeenCalledWith([
      "msg2",
      "msg3",
    ]);
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it("should throw error for invalid index", async () => {
    await expect(messageManager.truncateHistory(-1)).rejects.toThrow(
      "Invalid message index",
    );
    await expect(messageManager.truncateHistory(10)).rejects.toThrow(
      "Invalid message index",
    );
  });
});
