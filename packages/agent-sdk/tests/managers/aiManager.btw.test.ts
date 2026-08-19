import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { HookManager } from "../../src/managers/hookManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";

const { callAgentMock } = vi.hoisted(() => ({
  callAgentMock: vi.fn(),
}));

// Record the input to convertMessagesForAPI so tests can assert which raw
// messages (e.g. whether an in-progress assistant message was stripped)
// reached the conversion step.
const { convertMessagesForAPIMock } = vi.hoisted(() => ({
  convertMessagesForAPIMock: vi.fn(),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { access: vi.fn() },
}));

vi.mock("../../src/utils/gitUtils.js", () => ({
  isGitRepository: vi.fn(),
}));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: callAgentMock,
  transformMessagesForExplicitCache: vi.fn((m) => m),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: (...args: unknown[]) => {
    // Snapshot a copy: runBtwFork mutates the returned array afterwards
    // (pushes the wrapped question), which would otherwise leak into the
    // recorded call.
    convertMessagesForAPIMock(
      Array.isArray(args[0]) ? [...(args[0] as unknown[])] : args[0],
      args[1],
    );
    return args[0];
  },
}));

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/utils/messageOperations.js", () => ({}));

vi.mock("../../src/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
}));

const functionToolCall = {
  id: "call-1",
  type: "function" as const,
  function: { name: "Read", arguments: '{"file_path":"/tmp/x"}' },
};

const SIDE_QUESTION_REMINDER =
  "<system-reminder>This is a side question from the user. You must answer this question directly in a single response.";

describe("AIManager - runBtwFork", () => {
  let aiManager: AIManager;
  let mockMessageManager: MessageManager;
  let mockHookManager: HookManager;

  const mockGatewayConfig: GatewayConfig = {
    apiKey: "test-api-key",
    baseURL: "https://test-gateway.com",
  };

  const mockModelConfig: ModelConfig = {
    model: "test-agent-model",
    fastModel: "test-fast-model",
    permissionMode: "default",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: the fork produces an answer on the single turn.
    callAgentMock.mockResolvedValue({
      content: "Test side response",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [],
    });

    const container = new Container();

    mockMessageManager = {
      getMessages: vi.fn().mockReturnValue([{ role: "user", blocks: [] }]),
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.json"),
      saveSession: vi.fn().mockResolvedValue(undefined),
      compactMessagesAndUpdateSession: vi.fn(),
      addErrorBlock: vi.fn(),
      addUserMessage: vi.fn(),
      getRecentFileReads: vi.fn().mockReturnValue([]),
      getInvokedSkillNames: vi.fn().mockReturnValue([]),
      getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
      setlatestTotalTokens: vi.fn(),
    } as unknown as MessageManager;

    mockHookManager = {
      executePreCompactHooks: vi.fn().mockResolvedValue({
        results: [],
        additionalInstructions: undefined,
      }),
      executePostCompactHooks: vi.fn().mockResolvedValue([]),
      executeSessionStartHooks: vi.fn().mockResolvedValue({
        results: [],
        additionalContext: undefined,
        initialUserMessage: undefined,
      }),
    } as unknown as HookManager;

    const mockToolManager = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      getTools: vi.fn().mockReturnValue([]),
      getToolsConfig: vi.fn().mockReturnValue([]),
    } as unknown as ToolManager;

    const mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getPlanFilePath: vi.fn().mockReturnValue(undefined),
    } as unknown as PermissionManager;

    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("HookManager", mockHookManager);
    container.register("BackgroundTaskManager", {
      getAllTasks: vi.fn().mockReturnValue([]),
    });
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });
    container.register("SkillManager", undefined);
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    });
    container.register("TaskManager", { syncWithSession: vi.fn() });
    container.register("MergedEnv", { PATH: "/usr/bin" });
    container.register("Workdir", "/test/workdir");
    container.register("ConfigurationService", {
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
      resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
      resolveLanguage: vi.fn().mockReturnValue("en"),
    });

    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      callbacks: {
        onCompactionStateChange: vi.fn(),
        onUsageAdded: vi.fn(),
      },
    });
  });

  describe("fork config", () => {
    it("should reuse the main-loop config for prompt-cache hits", async () => {
      const result = await aiManager.runBtwFork("What is the plan?");

      expect(result).toEqual({ content: "Test side response" });

      // Single turn — no follow-up calls.
      expect(callAgentMock).toHaveBeenCalledTimes(1);
      expect(callAgentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayConfig: expect.objectContaining({
            ...mockGatewayConfig,
            sessionId: expect.any(String),
          }),
          modelConfig: mockModelConfig,
          workdir: "/test/workdir",
          tools: [],
          systemPrompt: expect.anything(),
        }),
      );
      // The fork must use the main model (no fast-model override) so the
      // request prefix matches the main loop and the cache is reused.
      expect(callAgentMock.mock.calls[0][0].model).toBeUndefined();
      expect(callAgentMock.mock.calls[0][0].stream).toBe(true);
    });

    it("should append the side-question reminder and the question as the trailing user message", async () => {
      await aiManager.runBtwFork("What is the current directory?");

      const messages = callAgentMock.mock.calls[0][0].messages;
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage.role).toBe("user");
      expect(lastMessage.content).toContain(SIDE_QUESTION_REMINDER);
      expect(lastMessage.content).toContain(
        "You have NO tools available - you cannot read files, run commands, search, or take any actions",
      );
      expect(
        lastMessage.content.endsWith("What is the current directory?"),
      ).toBe(true);
    });
  });

  describe("in-progress message handling", () => {
    it("should strip a streaming in-progress assistant message before conversion", async () => {
      const completed = {
        role: "user",
        blocks: [{ type: "text", text: "hello", stage: "end" }],
      };
      const inProgress = {
        role: "assistant",
        blocks: [{ type: "text", text: "partial", stage: "streaming" }],
      };
      mockMessageManager.getMessages = vi
        .fn()
        .mockReturnValue([completed, inProgress]);

      await aiManager.runBtwFork("Question?");

      // The last (streaming) assistant message must be dropped so the fork's
      // request prefix matches the last completed main-loop request.
      const converted = convertMessagesForAPIMock.mock.calls[0][0];
      expect(converted).toEqual([completed]);

      const messages = callAgentMock.mock.calls[0][0].messages;
      expect(messages).not.toContainEqual(
        expect.objectContaining({
          role: "assistant",
          content: "partial",
        }),
      );
    });

    it("should keep all messages when the last message is not in-progress", async () => {
      const messages = [
        { role: "user", blocks: [{ type: "text", text: "hi", stage: "end" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", text: "done", stage: "end" }],
        },
      ];
      mockMessageManager.getMessages = vi.fn().mockReturnValue(messages);
      // Snapshot: runBtwFork mutates the raw array in place when there is no
      // in-progress message to slice (the mock returns it as-is).
      const original = [...messages];

      await aiManager.runBtwFork("Question?");

      expect(convertMessagesForAPIMock.mock.calls[0][0]).toEqual(original);
    });
  });

  describe("memory injection", () => {
    it("should unshift wrapped memory content to match the main loop", async () => {
      mockMessageManager.getMemoryForInjection = vi
        .fn()
        .mockResolvedValue({ prependContent: "Important memory" });

      await aiManager.runBtwFork("Question?");

      const messages = callAgentMock.mock.calls[0][0].messages;
      expect(messages[0]).toEqual({
        role: "user",
        content: expect.stringContaining("Important memory"),
      });
      expect(messages[0].content).toContain("<system-reminder>");
    });
  });

  describe("onContent streaming", () => {
    it("should forward partial content from callAgent to the caller's onContent", async () => {
      const onContent = vi.fn();
      callAgentMock.mockImplementationOnce(
        async (options: { onContentUpdate?: (content: string) => void }) => {
          options.onContentUpdate?.("Partial side answer");
          return {
            content: "Full side answer",
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            tool_calls: [],
          };
        },
      );

      const result = await aiManager.runBtwFork(
        "Question?",
        undefined,
        onContent,
      );

      expect(onContent).toHaveBeenCalledWith("Partial side answer");
      expect(result).toEqual({ content: "Full side answer" });
    });

    it("should forward thinking chunks from a reasoning model to the caller's onContent", async () => {
      const onContent = vi.fn();
      callAgentMock.mockImplementationOnce(
        async (options: {
          onReasoningUpdate?: (content: string) => void;
          onContentUpdate?: (content: string) => void;
        }) => {
          // Thinking phase: reasoning chunks stream, no answer content yet.
          options.onReasoningUpdate?.("Let me think about this");
          options.onReasoningUpdate?.("Let me think about this carefully");
          // Answer phase: content takes over the display.
          options.onContentUpdate?.("The plan is:");
          return {
            content: "The plan is: step 1, step 2",
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            tool_calls: [],
          };
        },
      );

      const result = await aiManager.runBtwFork(
        "Question?",
        undefined,
        onContent,
      );

      expect(onContent).toHaveBeenCalledWith("Let me think about this");
      expect(onContent).toHaveBeenCalledWith(
        "Let me think about this carefully",
      );
      expect(onContent).toHaveBeenCalledWith("The plan is:");
      expect(result).toEqual({ content: "The plan is: step 1, step 2" });
    });

    it("should surface reasoning content when the model emits only thinking", async () => {
      const onContent = vi.fn();
      callAgentMock.mockResolvedValueOnce({
        content: "",
        reasoning_content: "I reasoned about this without a final answer",
        tool_calls: [],
      });

      const result = await aiManager.runBtwFork(
        "Question?",
        undefined,
        onContent,
      );

      expect(result).toEqual({
        content: "I reasoned about this without a final answer",
      });
    });
  });

  describe("result classification", () => {
    it("should surface an attempted tool call as an error string", async () => {
      callAgentMock.mockResolvedValueOnce({
        content: "",
        tool_calls: [functionToolCall],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

      const result = await aiManager.runBtwFork("What is in /tmp/x?");

      expect(result).toEqual({
        error:
          "(The model tried to call Read instead of answering directly. Try rephrasing or ask in the main conversation.)",
      });
    });

    it("should report No response received when there is neither text nor tool calls", async () => {
      callAgentMock.mockResolvedValueOnce({
        content: "",
        tool_calls: [],
      });

      const result = await aiManager.runBtwFork("Question?");

      expect(result).toEqual({ error: "No response received" });
    });

    it("should format API errors as an error string", async () => {
      callAgentMock.mockRejectedValueOnce(new Error("rate limit exceeded"));

      const result = await aiManager.runBtwFork("Question?");

      expect(result).toEqual({
        error: "(API error: rate limit exceeded)",
      });
    });

    it("should rethrow when the request was aborted so the UI can dismiss silently", async () => {
      const abortController = new AbortController();
      callAgentMock.mockRejectedValueOnce(new Error("Request was aborted"));
      // callAgent converts AbortError into a plain Error, so abort detection
      // relies on the signal state itself.
      abortController.abort();

      await expect(
        aiManager.runBtwFork("Question?", abortController.signal),
      ).rejects.toThrow("Request was aborted");
    });
  });
});
