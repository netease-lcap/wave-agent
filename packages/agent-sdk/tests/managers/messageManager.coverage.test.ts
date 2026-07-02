import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import * as sessionService from "../../src/services/session.js";
import { Container } from "../../src/utils/container.js";
import { TextBlock, Message } from "../../src/types/index.js";

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

describe("MessageManager Coverage Improvements", () => {
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

  it("should add a user message and return its ID", () => {
    const id = messageManager.addUserMessage({ content: "Hello" });
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.startsWith("msg-")).toBe(true);

    const messages = messageManager.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe(id);
    expect(messages[0].role).toBe("user");
    expect((messages[0].blocks[0] as TextBlock).content).toBe("Hello");
  });

  it("should update an existing user message by ID", () => {
    const id = messageManager.addUserMessage({
      content: "Original content",
    });

    messageManager.updateUserMessage(id, {
      content: "Updated content",
    });

    const messages = messageManager.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe(id);
    expect((messages[0].blocks[0] as TextBlock).content).toBe(
      "Updated content",
    );
  });

  it("should only update the specified user message", () => {
    const id1 = messageManager.addUserMessage({ content: "Message 1" });
    const id2 = messageManager.addUserMessage({ content: "Message 2" });

    messageManager.updateUserMessage(id1, { content: "Updated Message 1" });

    const messages = messageManager.getMessages();
    expect(messages.length).toBe(2);

    const msg1 = messages.find((m) => m.id === id1);
    const msg2 = messages.find((m) => m.id === id2);

    expect((msg1?.blocks[0] as TextBlock).content).toBe("Updated Message 1");
    expect((msg2?.blocks[0] as TextBlock).content).toBe("Message 2");
  });

  it("should not update if ID does not match", () => {
    messageManager.addUserMessage({ content: "Message 1" });
    messageManager.updateUserMessage("non-existent-id", { content: "Updated" });

    const messages = messageManager.getMessages();
    expect((messages[0].blocks[0] as TextBlock).content).toBe("Message 1");
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
      getActiveRulesSplit: vi.fn().mockReturnValue({
        unconditional: [{ id: "rule1", content: "rule content" }],
        conditional: [],
      }),
    };

    const testContainer = new Container();
    testContainer.register(
      "MemoryRuleManager",
      mockMemoryRuleManager as unknown as Record<string, unknown>,
    );
    testContainer.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue("base memory"),
    } as unknown as Record<string, unknown>);

    const mm = new MessageManager(testContainer, {
      callbacks: {},
      workdir,
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

  it("should handle compactMessagesAndUpdateSession and preserve rootSessionId and last 3 messages", () => {
    const initialRootSessionId = messageManager.getRootSessionId();
    messageManager.addUserMessage({ content: "msg1" });
    messageManager.addAssistantMessage("msg2");
    messageManager.addUserMessage({ content: "msg3" });
    messageManager.addAssistantMessage("msg4");
    messageManager.addUserMessage({ content: "msg5" });

    messageManager.compactMessagesAndUpdateSession("compacted content");

    const messages = messageManager.getMessages();
    expect(messages.length).toBe(4); // [compact] + msg3, msg4, msg5
    expect(messages[0].blocks[0].type).toBe("compact");
    expect((messages[0].blocks[0] as { content: string }).content).toBe(
      "compacted content",
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

    const messages = messageManager.getMessages();
    vi.mocked(sessionService.loadFullMessageThread).mockResolvedValueOnce({
      messages,
      sessionIds: [messageManager.getSessionId()],
    });
    vi.mocked(sessionService.loadSessionFromJsonl).mockResolvedValue({
      id: messageManager.getSessionId(),
      messages,
      metadata: {
        workdir: "/test/workdir",
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    });

    await messageManager.truncateHistory(1);
    expect(messageManager.getMessages().length).toBe(1);
    expect(messageManager.getMessages()[0].blocks[0].type).toBe("text");
    expect(
      (messageManager.getMessages()[0].blocks[0] as { content: string })
        .content,
    ).toBe("msg1");
  });

  it("should process triggered file reads against conditional rules", () => {
    const mockMemoryRuleManager = {
      getActiveRulesSplit: vi.fn().mockReturnValue({
        unconditional: [],
        conditional: [
          {
            id: "cond",
            content: "Conditional rule",
            metadata: { paths: ["*.ts"] },
            source: "project" as const,
            filePath: "/test/cond.md",
          },
        ],
      }),
    };
    container.register(
      "MemoryRuleManager",
      mockMemoryRuleManager as unknown as Record<string, unknown>,
    );

    messageManager.triggerFileRead("src/index.ts");
    const rules = messageManager.processTriggeredRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].content).toBe("Conditional rule");
    expect(mockMemoryRuleManager.getActiveRulesSplit).toHaveBeenCalledWith([
      "src/index.ts",
    ]);
  });

  it("should return empty rules from processTriggeredRules when no MemoryRuleManager", () => {
    const freshContainer = new Container();
    freshContainer.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue("base memory"),
    } as unknown as Record<string, unknown>);
    const mm = new MessageManager(freshContainer, {
      callbacks: {},
      workdir,
    });
    mm.triggerFileRead("src/index.ts");
    const rules = mm.processTriggeredRules();
    expect(rules).toHaveLength(0);
  });

  it("should clear triggers after processTriggeredRules", () => {
    const mockMemoryRuleManager = {
      getActiveRulesSplit: vi.fn().mockReturnValue({
        unconditional: [],
        conditional: [],
      }),
    };
    container.register(
      "MemoryRuleManager",
      mockMemoryRuleManager as unknown as Record<string, unknown>,
    );

    messageManager.triggerFileRead("src/index.ts");
    messageManager.processTriggeredRules();
    // Second call should have no triggers to process
    const rules = messageManager.processTriggeredRules();
    expect(rules).toHaveLength(0);
    expect(mockMemoryRuleManager.getActiveRulesSplit).toHaveBeenCalledTimes(1);
  });

  it("should track file read contents from read tool blocks", () => {
    const readResultContent = "file contents go here";
    const msgs = [
      {
        id: "msg-1",
        role: "user",
        blocks: [{ type: "text" as const, content: "read a file" }],
      },
      {
        id: "msg-2",
        role: "assistant",
        blocks: [
          {
            type: "tool" as const,
            name: "read",
            stage: "end" as const,
            parameters: JSON.stringify({ file_path: "src/index.ts" }),
            result: readResultContent,
          },
        ],
      },
    ];

    messageManager.setMessages(msgs as unknown as Message[]);
    const fileReads = messageManager.getRecentFileReads(5);
    expect(fileReads).toHaveLength(1);
    expect(fileReads[0].path).toBe("src/index.ts");
    expect(fileReads[0].content).toBe(readResultContent);
  });

  it("should not track read tool blocks that are not finalized", () => {
    const msgs = [
      {
        id: "msg-1",
        role: "assistant",
        blocks: [
          {
            type: "tool" as const,
            name: "read",
            stage: "running" as const,
            parameters: JSON.stringify({ file_path: "src/index.ts" }),
            result: "partial",
          },
        ],
      },
    ];

    messageManager.setMessages(msgs as unknown as Message[]);
    const fileReads = messageManager.getRecentFileReads(5);
    expect(fileReads).toHaveLength(0);
  });

  it("should sort file reads by recency and limit count", () => {
    // First message with older read
    const msgs1 = [
      {
        id: "msg-1",
        role: "assistant",
        blocks: [
          {
            type: "tool" as const,
            name: "read",
            stage: "end" as const,
            parameters: JSON.stringify({ file_path: "old.ts" }),
            result: "old content",
          },
        ],
      },
    ];
    messageManager.setMessages(msgs1 as unknown as Message[]);

    // Advance time and add newer read
    vi.advanceTimersByTime(1000);
    const msgs2 = [
      {
        id: "msg-1",
        role: "assistant",
        blocks: [
          {
            type: "tool" as const,
            name: "read",
            stage: "end" as const,
            parameters: JSON.stringify({ file_path: "new.ts" }),
            result: "new content",
          },
        ],
      },
    ];
    messageManager.setMessages(msgs2 as unknown as Message[]);
    const fileReads = messageManager.getRecentFileReads(1);
    expect(fileReads).toHaveLength(1);
    expect(fileReads[0].path).toBe("new.ts");
  });

  describe("getMemoryForInjection", () => {
    it("should return prependContent from base memory when no MemoryRuleManager", async () => {
      const result = await messageManager.getMemoryForInjection();
      expect(result.prependContent).toBe("base memory");
    });

    it("should include unconditional rules in prependContent", async () => {
      const mockMemoryRuleManager = {
        getActiveRulesSplit: vi.fn().mockReturnValue({
          unconditional: [
            {
              id: "uncond",
              content: "Always active rule",
              metadata: {},
              source: "project" as const,
              filePath: "/test/uncond.md",
            },
          ],
          conditional: [
            {
              id: "cond",
              content: "Conditional rule",
              metadata: { paths: ["*.ts"] },
              source: "project" as const,
              filePath: "/test/cond.md",
            },
          ],
        }),
      };
      container.register(
        "MemoryRuleManager",
        mockMemoryRuleManager as unknown as Record<string, unknown>,
      );

      const result = await messageManager.getMemoryForInjection();
      expect(result.prependContent).toContain("base memory");
      expect(result.prependContent).toContain("Always active rule");
    });

    it("should return only prependContent when no conditional rules match", async () => {
      const mockMemoryRuleManager = {
        getActiveRulesSplit: vi.fn().mockReturnValue({
          unconditional: [],
          conditional: [],
        }),
      };
      container.register(
        "MemoryRuleManager",
        mockMemoryRuleManager as unknown as Record<string, unknown>,
      );

      const result = await messageManager.getMemoryForInjection();
      expect(result.prependContent).toBe("base memory");
    });

    it("should return conditional rules via processTriggeredRules when filesInContext matches", () => {
      const mockMemoryRuleManager = {
        getActiveRulesSplit: vi.fn().mockReturnValue({
          unconditional: [],
          conditional: [
            {
              id: "cond",
              content: "Conditional rule",
              metadata: { paths: ["*.ts"] },
              source: "project" as const,
              filePath: "/test/cond.md",
            },
          ],
        }),
      };
      container.register(
        "MemoryRuleManager",
        mockMemoryRuleManager as unknown as Record<string, unknown>,
      );

      messageManager.triggerFileRead("src/index.ts");
      const rules = messageManager.processTriggeredRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].content).toBe("Conditional rule");
    });

    it("should return empty rules from processTriggeredRules when no rules match filesInContext", () => {
      const mockMemoryRuleManager = {
        getActiveRulesSplit: vi.fn().mockReturnValue({
          unconditional: [],
          conditional: [],
        }),
      };
      container.register(
        "MemoryRuleManager",
        mockMemoryRuleManager as unknown as Record<string, unknown>,
      );

      messageManager.triggerFileRead("src/index.ts");
      const rules = messageManager.processTriggeredRules();
      expect(rules).toHaveLength(0);
    });
  });
});
