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

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi
    .fn()
    .mockReturnValue([{ role: "user", content: "hello" }]),
}));

vi.mock("../../src/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
}));

const toolCall = {
  id: "call-1",
  type: "function" as const,
  function: { name: "Read", arguments: '{"file_path":"/tmp/x"}' },
};

describe("AIManager - compactConversation", () => {
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
    maxTokens: 4096,
    permissionMode: "default",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: the fork path produces a summary on the first turn.
    callAgentMock.mockResolvedValue({
      content: "Test response",
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

  describe("fork path", () => {
    it("should fork with the main conversation config and not call the fallback", async () => {
      await aiManager.compactConversation();

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
      // The fork must NOT use the fast model — that would bust the cache.
      expect(callAgentMock.mock.calls[0][0].model).toBeUndefined();
      // The fork must stream so a slow reasoning model emits first bytes
      // before the gateway idle timeout fires (non-streaming waits for the
      // full summary on the largest context and gets killed).
      expect(callAgentMock.mock.calls[0][0].stream).toBe(true);
      expect(
        mockMessageManager.compactMessagesAndUpdateSession,
      ).toHaveBeenCalled();
    });

    it("should send the compact instruction as the trailing user message", async () => {
      await aiManager.compactConversation();

      const messages = callAgentMock.mock.calls[0][0].messages;
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage.role).toBe("user");
      expect(lastMessage.content).toContain(
        "Your task is to create a detailed summary of the conversation so far",
      );
      expect(lastMessage.content).toContain("REMINDER: Do NOT call any tools");
    });

    it("should include custom instructions in the compact prompt", async () => {
      await aiManager.compactConversation({
        customInstructions: "Focus on the bug fix discussion",
      });

      const messages = callAgentMock.mock.calls[0][0].messages;
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage.content).toContain(
        "Additional Instructions:\nFocus on the bug fix discussion",
      );
    });

    it("should merge PreCompact hook stdout into the compact prompt", async () => {
      vi.mocked(mockHookManager.executePreCompactHooks).mockResolvedValueOnce({
        results: [],
        additionalInstructions: "hook instructions",
      });

      await aiManager.compactConversation({
        customInstructions: "user instructions",
      });

      const messages = callAgentMock.mock.calls[0][0].messages;
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage.content).toContain(
        "Additional Instructions:\nuser instructions\nhook instructions",
      );
    });

    it("should deny tool calls locally and continue the fork loop", async () => {
      callAgentMock
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [toolCall],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
        .mockResolvedValueOnce({
          content: "Summary after denial",
          usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
          tool_calls: [],
        });

      await aiManager.compactConversation();

      expect(callAgentMock).toHaveBeenCalledTimes(2);
      const secondCallMessages = callAgentMock.mock.calls[1][0].messages;
      expect(secondCallMessages).toContainEqual(
        expect.objectContaining({
          role: "assistant",
          tool_calls: [toolCall],
        }),
      );
      expect(secondCallMessages).toContainEqual({
        role: "tool",
        tool_call_id: "call-1",
        content: "Tool use is not allowed during compaction",
      });
      expect(
        mockMessageManager.compactMessagesAndUpdateSession,
      ).toHaveBeenCalledWith(
        expect.stringContaining("Summary after denial"),
        expect.objectContaining({
          // Token usage accumulates across fork turns.
          prompt_tokens: 22,
          completion_tokens: 11,
          total_tokens: 33,
          model: "test-agent-model",
          operation_type: "compact",
        }),
      );
    });

    it("should strip the analysis block and extract the summary body", async () => {
      callAgentMock.mockResolvedValueOnce({
        content:
          "<analysis>scratch pad</analysis>\n<summary>real summary</summary>",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [],
      });

      await aiManager.compactConversation();

      const [appliedSummary] = vi.mocked(
        mockMessageManager.compactMessagesAndUpdateSession,
      ).mock.calls[0];
      expect(appliedSummary).toContain("Summary:\nreal summary");
      expect(appliedSummary).not.toContain("scratch pad");
    });

    it("should pass raw text through unchanged when no summary tag is present", async () => {
      callAgentMock.mockResolvedValueOnce({
        content: "plain summary without tags",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [],
      });

      await aiManager.compactConversation();

      const [appliedSummary] = vi.mocked(
        mockMessageManager.compactMessagesAndUpdateSession,
      ).mock.calls[0];
      expect(appliedSummary).toContain("plain summary without tags");
    });
  });

  describe("failure path", () => {
    it("should fail when the fork exhausts turns with only tool calls", async () => {
      callAgentMock.mockResolvedValue({
        content: "",
        tool_calls: [toolCall],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await aiManager.compactConversation({
        customInstructions: "keep it short",
      });

      expect(callAgentMock).toHaveBeenCalledTimes(3);
      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        expect.stringContaining("Failed to compact conversation history"),
      );
      expect(
        mockMessageManager.compactMessagesAndUpdateSession,
      ).not.toHaveBeenCalled();
    });

    it("should fail when the fork produces neither text nor tool calls", async () => {
      callAgentMock.mockResolvedValue({
        content: "",
        tool_calls: [],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      });

      await aiManager.compactConversation();

      // Retrying the identical request is pointless — single fork turn.
      expect(callAgentMock).toHaveBeenCalledTimes(1);
      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        expect.stringContaining("Failed to compact conversation history"),
      );
    });

    it("should fail when the fork request throws", async () => {
      callAgentMock.mockRejectedValue(new Error("fork exploded"));

      await aiManager.compactConversation();

      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        expect.stringContaining("fork exploded"),
      );
      expect(
        mockMessageManager.compactMessagesAndUpdateSession,
      ).not.toHaveBeenCalled();
    });

    it("should report the abort error without compacting", async () => {
      callAgentMock.mockRejectedValue(new Error("Request was aborted"));

      await aiManager.compactConversation();

      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        expect.stringContaining("Request was aborted"),
      );
      expect(
        mockMessageManager.compactMessagesAndUpdateSession,
      ).not.toHaveBeenCalled();
    });
  });

  describe("hooks and guards", () => {
    it("should fire PreCompact hooks before compaction", async () => {
      await aiManager.compactConversation({
        customInstructions: "user instructions",
      });

      expect(mockHookManager.executePreCompactHooks).toHaveBeenCalledWith(
        "test-session-id",
        "/test/transcript.json",
        "user instructions",
      );
    });

    it("should fire PostCompact hooks with the formatted summary", async () => {
      await aiManager.compactConversation();

      expect(mockHookManager.executePostCompactHooks).toHaveBeenCalledWith(
        "test-session-id",
        "/test/transcript.json",
        "Test response",
      );
    });

    it("should fire SessionStart hooks with source='compact'", async () => {
      await aiManager.compactConversation();

      expect(mockHookManager.executeSessionStartHooks).toHaveBeenCalledWith(
        "compact",
        "test-session-id",
        "/test/transcript.json",
        undefined,
      );
    });

    it("should skip if already compacting", async () => {
      let resolveFirst: () => void;
      const firstCompact = new Promise<void>(
        (resolve) => (resolveFirst = resolve),
      );
      callAgentMock.mockImplementationOnce(async () => {
        await firstCompact;
        return {
          content: "compacted",
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          tool_calls: [],
        };
      });

      const firstCall = aiManager.compactConversation();

      // Wait for the first compaction to actually start (isCompacting = true)
      await vi.waitFor(() => {
        expect(aiManager.getIsCompacting()).toBe(true);
      });

      // Try a second compaction while the first is running - should be skipped
      await aiManager.compactConversation();

      // Only one fork call should have happened
      expect(callAgentMock).toHaveBeenCalledTimes(1);

      resolveFirst!();
      await firstCall;
    });

    it("should return early when messages are empty", async () => {
      vi.mocked(mockMessageManager.getMessages).mockReturnValueOnce([]);

      await aiManager.compactConversation();

      expect(callAgentMock).not.toHaveBeenCalled();
    });
  });
});
