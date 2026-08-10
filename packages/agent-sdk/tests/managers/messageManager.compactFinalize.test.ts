import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import type { MessageManagerCallbacks } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";
import type { TextBlock } from "../../src/types/index.js";

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

describe("MessageManager - Compaction finalizes streaming blocks", () => {
  const workdir = "/test/workdir";
  const container = new Container();

  beforeEach(() => {
    vi.clearAllMocks();
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue("base memory"),
    } as unknown as Record<string, unknown>);
  });

  function createManager(callbacks: MessageManagerCallbacks) {
    return new MessageManager(container, { callbacks, workdir });
  }

  it("compaction finalizes the preserved last assistant text block to 'end'", async () => {
    const messageManager = createManager({});
    messageManager.addUserMessage({ content: "Analyze the code" });
    messageManager.addAssistantMessage();
    messageManager.updateCurrentMessageContent("Analysis complete");

    // The turn that triggers auto-compaction has finished streaming; its text
    // block is still 'streaming' until finalizeStreamingBlocks runs. Any host
    // full-snapshot pull after compaction must already see 'end'.
    await messageManager.compactMessagesAndUpdateSession("summarized");

    const messages = messageManager.getMessages();
    expect(messages[0].blocks[0].type).toBe("compact");
    const last = messages[messages.length - 1];
    expect(last.role).toBe("assistant");
    const textBlock = last.blocks.find((b) => b.type === "text") as TextBlock;
    expect(textBlock.stage).toBe("end");
  });

  it("compaction finalizes the preserved last assistant reasoning block to 'end'", async () => {
    const messageManager = createManager({});
    messageManager.addUserMessage({ content: "Plan the work" });
    messageManager.addAssistantMessage();
    messageManager.updateCurrentMessageReasoning("Thinking...");

    await messageManager.compactMessagesAndUpdateSession("summarized");

    const messages = messageManager.getMessages();
    const last = messages[messages.length - 1];
    expect(last.role).toBe("assistant");
    const reasoningBlock = last.blocks.find((b) => b.type === "reasoning") as {
      stage?: string;
    };
    expect(reasoningBlock.stage).toBe("end");
  });

  it("keeps the last assistant block finalized even when a meta user message is appended after compaction (plan mode)", async () => {
    const messageManager = createManager({});
    messageManager.addUserMessage({ content: "Plan the migration" });
    messageManager.addAssistantMessage();
    messageManager.updateCurrentMessageContent("Here is the plan");

    await messageManager.compactMessagesAndUpdateSession("summarized");

    // aiManager re-adds the plan-mode reminder as a user meta message right
    // after compaction (aiManager.compactConversation), which makes the final
    // message non-assistant so finalizeStreamingBlocks no-ops. The preserved
    // assistant block must already be finalized by compaction itself.
    messageManager.addUserMessage({
      content: "<system-reminder>plan mode</system-reminder>",
      isMeta: true,
    });
    messageManager.finalizeStreamingBlocks();

    const messages = messageManager.getMessages();
    const assistants = messages.filter((m) => m.role === "assistant");
    const lastAssistant = assistants[assistants.length - 1];
    expect(lastAssistant).toBeDefined();
    const textBlock = lastAssistant!.blocks.find(
      (b) => b.type === "text",
    ) as TextBlock;
    expect(textBlock.stage).toBe("end");
  });

  it("fires the incremental end notification when compaction finalizes the last assistant block", async () => {
    const mockContentUpdated = vi.fn();
    const messageManager = createManager({
      onAssistantContentUpdated: mockContentUpdated,
    });
    messageManager.addUserMessage({ content: "Do the work" });
    messageManager.addAssistantMessage();
    messageManager.updateCurrentMessageContent("Done");

    await messageManager.compactMessagesAndUpdateSession("summarized");

    const messages = messageManager.getMessages();
    const last = messages[messages.length - 1];
    expect(mockContentUpdated).toHaveBeenCalledWith({
      messageId: last.id,
      chunk: "",
      stage: "end",
    });
  });
});
