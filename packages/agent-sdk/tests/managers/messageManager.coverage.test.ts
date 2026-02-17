import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import * as sessionService from "../../src/services/session.js";

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
  };
});

vi.mock("../../src/services/memory.js", () => ({
  getCombinedMemoryContent: vi.fn().mockResolvedValue("base memory"),
}));

describe("MessageManager Coverage Improvements", () => {
  let messageManager: MessageManager;
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    messageManager = new MessageManager({
      callbacks: {},
      workdir,
    });
  });

  it("should handle saveSession with no new messages", async () => {
    await messageManager.saveSession();
    expect(sessionService.appendMessages).not.toHaveBeenCalled();
  });

  it("should handle saveSession error", async () => {
    vi.mocked(sessionService.createSession).mockRejectedValueOnce(
      new Error("Create failed"),
    );
    messageManager.addUserMessage({ content: "hello" });
    await messageManager.saveSession();
    // Should not throw
  });

  it("should handle getCombinedMemory with memoryRuleManager", async () => {
    const mockMemoryRuleManager = {
      getActiveRules: vi
        .fn()
        .mockReturnValue([{ id: "rule1", content: "rule content" }]),
    };

    const mm = new MessageManager({
      callbacks: {},
      workdir,
      memoryRuleManager:
        mockMemoryRuleManager as unknown as MessageManager["memoryRuleManager"],
    });

    const content = await mm.getCombinedMemory();
    expect(content).toContain("base memory");
    expect(content).toContain("rule content");
  });

  it("should handle mergeAssistantAdditionalFields", () => {
    messageManager.addAssistantMessage("hello");
    messageManager.mergeAssistantAdditionalFields({
      key: "value",
      other: undefined,
    });

    const messages = messageManager.getMessages();
    expect(messages[0].additionalFields).toEqual({ key: "value" });

    // Merge more
    messageManager.mergeAssistantAdditionalFields({ key2: "value2" });
    expect(messageManager.getMessages()[0].additionalFields).toEqual({
      key: "value",
      key2: "value2",
    });

    // Empty merge
    messageManager.mergeAssistantAdditionalFields({});
    expect(messageManager.getMessages()[0].additionalFields).toEqual({
      key: "value",
      key2: "value2",
    });
  });

  it("should handle addInfoBlock", () => {
    messageManager.addAssistantMessage("hello");
    messageManager.addInfoBlock("some info");
    const messages = messageManager.getMessages();
    expect(messages[0].blocks).toContainEqual(
      expect.objectContaining({ type: "info", content: "some info" }),
    );
  });

  it("should handle compressMessagesAndUpdateSession and preserve rootSessionId and last 3 messages", () => {
    const initialRootSessionId = messageManager.getRootSessionId();
    messageManager.addUserMessage({ content: "msg1" });
    messageManager.addAssistantMessage("msg2");
    messageManager.addUserMessage({ content: "msg3" });
    messageManager.addAssistantMessage("msg4");
    messageManager.addUserMessage({ content: "msg5" });

    messageManager.compressMessagesAndUpdateSession("compressed content");

    const messages = messageManager.getMessages();
    expect(messages.length).toBe(4); // [compress] + msg3, msg4, msg5
    expect(messages[0].blocks[0].type).toBe("compress");
    expect((messages[0].blocks[0] as { content: string }).content).toBe(
      "compressed content",
    );
    expect((messages[1].blocks[0] as { content: string }).content).toBe("msg3");
    expect((messages[2].blocks[0] as { content: string }).content).toBe("msg4");
    expect((messages[3].blocks[0] as { content: string }).content).toBe("msg5");
    expect(messageManager.getRootSessionId()).toBe(initialRootSessionId);
    expect(messageManager.getSessionId()).not.toBe(initialRootSessionId);
  });

  it("should handle addFileHistoryBlock", () => {
    messageManager.addAssistantMessage("hello");
    messageManager.addFileHistoryBlock([
      {
        path: "test.ts",
        content: "content",
        timestamp: "now",
      } as unknown as Parameters<MessageManager["addFileHistoryBlock"]>[0][0],
    ]);
    const messages = messageManager.getMessages();
    expect(messages[0].blocks).toContainEqual(
      expect.objectContaining({ type: "file_history" }),
    );
  });

  it("should handle subagent blocks", () => {
    messageManager.addAssistantMessage("starting subagent");
    messageManager.addSubagentBlock(
      "sub1",
      "SubAgent",
      "session1",
      {} as unknown as Parameters<MessageManager["addSubagentBlock"]>[3],
      "active",
      { description: "desc", prompt: "prompt", subagent_type: "type" },
    );

    let messages = messageManager.getMessages();
    expect(messages[0].blocks).toContainEqual(
      expect.objectContaining({ type: "subagent", subagentId: "sub1" }),
    );

    messageManager.updateSubagentBlock("sub1", { status: "completed" });
    messages = messageManager.getMessages();
    const subagentBlock = messages[0].blocks.find(
      (b) => b.type === "subagent",
    ) as { status: string };
    expect(subagentBlock.status).toBe("completed");
  });

  it("should handle updateCurrentMessageReasoning", () => {
    messageManager.addAssistantMessage("hello");
    messageManager.updateCurrentMessageReasoning("thinking...");
    messageManager.updateCurrentMessageReasoning("thinking... more");

    const messages = messageManager.getMessages();
    const reasoningBlock = messages[0].blocks.find(
      (b) => b.type === "reasoning",
    ) as { content: string };
    expect(reasoningBlock.content).toBe("thinking... more");
  });

  it("should handle truncateHistory", async () => {
    messageManager.addUserMessage({ content: "msg1" });
    messageManager.addAssistantMessage("msg2");
    messageManager.addUserMessage({ content: "msg3" });

    await messageManager.truncateHistory(1);
    expect(messageManager.getMessages().length).toBe(1);
    expect(messageManager.getMessages()[0].blocks[0].type).toBe("text");
    expect(
      (messageManager.getMessages()[0].blocks[0] as { content: string })
        .content,
    ).toBe("msg1");
  });

  it("should handle extractPathsFromParams", () => {
    // This is private but called via updateFilesInContext which is called via setMessages
    const messages = [
      {
        role: "assistant",
        blocks: [
          {
            type: "tool",
            parameters: JSON.stringify({
              filePath: "path1.ts",
              target_file: "path2.ts",
              files: ["path3.ts", 123],
            }),
          },
        ],
      },
    ];

    messageManager.setMessages(
      messages as unknown as Parameters<MessageManager["setMessages"]>[0],
    );
    const files = messageManager.getFilesInContext();
    expect(files).toContain("path1.ts");
    expect(files).toContain("path2.ts");
    expect(files).toContain("path3.ts");
    expect(files).not.toContain(123);
  });
});
