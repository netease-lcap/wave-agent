import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../../src/agent.js";
import * as aiService from "../../src/services/aiService.js";
import { MessageManager } from "../../src/managers/messageManager.js";

// Mock aiService
vi.mock("../../src/services/aiService.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/aiService.js")>();
  return {
    ...actual,
    callAgent: vi.fn(),
  };
});

// Mock fs
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn().mockResolvedValue(""),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi
        .fn()
        .mockResolvedValue({ isFile: () => true, isDirectory: () => false }),
    },
  };
});

describe("Recovery Message Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should automatically trigger recovery when finish_reason is 'length'", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
    });

    const messageManager = (
      agent as unknown as { messageManager: MessageManager }
    ).messageManager;

    // Mock first call to return finish_reason: 'length'
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "Part 1 of the response...",
      finish_reason: "length",
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });

    // Mock second call to return finish_reason: 'stop'
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "Part 2 of the response.",
      finish_reason: "stop",
      usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
    });

    // Start the AI message
    await agent.sendMessage("Tell me a long story.");

    // Verify callAgent was called twice
    expect(aiService.callAgent).toHaveBeenCalledTimes(2);

    // Verify the second call included the recovery message
    const secondCallArgs = vi.mocked(aiService.callAgent).mock.calls[1][0];
    const lastMessage =
      secondCallArgs.messages[secondCallArgs.messages.length - 1];

    // The last message in the second call should be the recovery message
    // Note: convertMessagesForAPI converts Message[] to ChatCompletionMessageParam[]
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toEqual([
      {
        type: "text",
        text: "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.",
      },
    ]);

    // Verify MessageManager contains the recovery message with isMeta: true
    const allMessages = messageManager.getMessages();
    const recoveryMessage = allMessages.find((m) => m.isMeta === true);
    expect(recoveryMessage).toBeDefined();
    expect(recoveryMessage?.role).toBe("user");
    expect(recoveryMessage?.blocks[0].type).toBe("text");
    expect(
      (recoveryMessage?.blocks[0] as { type: "text"; content: string }).content,
    ).toContain("Output token limit hit");
  });
});
