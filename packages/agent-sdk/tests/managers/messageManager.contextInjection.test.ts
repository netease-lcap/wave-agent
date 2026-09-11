import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
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

describe("MessageManager context injection and file reads", () => {
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
            name: "Read",
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
            name: "Read",
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
            name: "Read",
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
            name: "Read",
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

  it("hasFileBeenRead should return true after Read tool with capital R name (production behavior)", () => {
    const msgs = [
      {
        id: "msg-1",
        role: "assistant" as const,
        blocks: [
          {
            type: "tool" as const,
            name: "Read",
            stage: "end" as const,
            parameters: JSON.stringify({ file_path: "src/index.ts" }),
            result: "file contents",
          },
        ],
      },
    ];

    messageManager.setMessages(msgs as unknown as Message[]);
    expect(messageManager.hasFileBeenRead("src/index.ts")).toBe(true);
    expect(messageManager.hasFileBeenRead("src/other.ts")).toBe(false);
  });

  it("hasFileBeenRead should work with absolute paths", () => {
    const msgs = [
      {
        id: "msg-1",
        role: "assistant" as const,
        blocks: [
          {
            type: "tool" as const,
            name: "Read",
            stage: "end" as const,
            parameters: JSON.stringify({
              file_path: path.join("src", "index.ts"),
            }),
            result: "file contents",
          },
        ],
      },
    ];

    messageManager.setMessages(msgs as unknown as Message[]);
    expect(messageManager.hasFileBeenRead("/test/workdir/src/index.ts")).toBe(
      true,
    );
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
