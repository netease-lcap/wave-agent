import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { TurnBudgetLedger } from "../../src/managers/turnBudgetLedger.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type {
  GatewayConfig,
  ModelConfig,
  Usage,
  Message,
} from "../../src/types/index.js";
import * as aiService from "../../src/services/aiService.js";

// Mock the aiService module
vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn(),
  compactMessages: vi.fn(),
}));

// Mock the memory service
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
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

/**
 * Wiring of the shared turn output-token ledger (spec multi-agent/workflow.md,
 * 用户故事「预算与规模硬上限（P1）」): the main loop owns the turn boundary, the
 * target is read from the user's own prompt, and every request is charged
 * output-only.
 */
describe("AIManager - turn output-token ledger", () => {
  const mockGatewayConfig: GatewayConfig = {
    apiKey: "test-api-key",
    baseURL: "https://test-gateway.com",
  };

  const mockModelConfig: ModelConfig = {
    model: "test-agent-model",
    fastModel: "test-fast-model",
  };

  let ledger: TurnBudgetLedger;

  function createHarness(options: {
    messages?: Message[];
    subagentType?: string;
    /** Bare containers (some tests build one by hand) have no ledger registered. */
    withLedger?: boolean;
  }): { aiManager: AIManager; messageManager: MessageManager } {
    const messages = options.messages ?? [];
    const withLedger = options.withLedger ?? true;

    const mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
      getMessages: vi.fn().mockReturnValue(messages),
      addAssistantMessage: vi.fn(),
      updateCurrentMessageContent: vi.fn(),
      updateToolBlock: vi.fn(),
      mergeAssistantAdditionalFields: vi.fn(),
      setMessages: vi.fn(),
      getLatestTotalTokens: vi.fn().mockReturnValue(0),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
      processTriggeredRules: vi.fn().mockReturnValue([]),
      addErrorBlock: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      saveSession: vi.fn().mockResolvedValue(undefined),
      compactMessagesAndUpdateSession: vi.fn(),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
      finalizeStreamingBlocks: vi.fn(),
      finalizeAbortedToolBlocks: vi.fn(),
    } as unknown as MessageManager;

    const mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      execute: vi
        .fn()
        .mockResolvedValue({ success: true, content: "test result" }),
    } as unknown as ToolManager;

    const mockConfigurationService = {
      setOptions: vi.fn(),
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
      resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
      getEnvironmentVars: vi.fn().mockReturnValue({}),
    };

    const container = new Container();
    container.register("ConfigurationService", mockConfigurationService);
    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", {} as unknown as TaskManager);
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    });
    container.register("PermissionManager", {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
      clearTemporaryRules: vi.fn(),
      getPlanFilePath: vi.fn().mockReturnValue(undefined),
      setHasExitedPlanMode: vi.fn(),
      hasExitedPlanModeInSession: vi.fn(() => false),
      setNeedsPlanModeExitAttachment: vi.fn(),
      getNeedsPlanModeExitAttachment: vi.fn(() => false),
    } as unknown as Record<string, unknown>);
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });
    container.register("SkillManager", {
      getAvailableSkills: vi.fn().mockReturnValue([]),
    });
    // The real agent container setup registers this singleton; a bare container
    // would simply skip token accounting.
    if (withLedger) {
      container.register("TurnBudgetLedger", ledger);
    }

    const aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      ...(options.subagentType ? { subagentType: options.subagentType } : {}),
    });

    return { aiManager, messageManager: mockMessageManager };
  }

  function mockResponse(usage: Usage | undefined): void {
    vi.mocked(aiService.callAgent).mockResolvedValue({
      content: "Test response",
      usage,
      tool_calls: [],
    });
  }

  function userMessage(text: string): Message {
    return {
      role: "user",
      blocks: [{ type: "text", content: text }],
    } as unknown as Message;
  }

  function notificationMessage(): Message {
    return {
      role: "user",
      blocks: [
        {
          type: "task_notification",
          taskId: "wf_1",
          taskType: "workflow",
          status: "completed",
          summary: "done",
        },
      ],
    } as unknown as Message;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    ledger = new TurnBudgetLedger();
  });

  describe("output-only accounting", () => {
    it("charges completion_tokens and nothing else", async () => {
      const { aiManager } = createHarness({
        messages: [userMessage("+500k run the workflow")],
      });
      mockResponse({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "test-model",
        operation_type: "agent",
      });

      await aiManager.sendAIMessage();

      // 50 (output), not 150.
      expect(ledger.getTurnSpent()).toBe(50);
      expect(ledger.remaining()).toBe(499950);
    });

    it("does not bill the prompt side carried by total_tokens or cache fields", async () => {
      const { aiManager } = createHarness({
        messages: [userMessage("use 500k tokens")],
      });
      mockResponse({
        prompt_tokens: 1000,
        completion_tokens: 70,
        total_tokens: 1070,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 3000,
        model: "test-model",
        operation_type: "agent",
      });

      await aiManager.sendAIMessage();

      expect(ledger.getTurnSpent()).toBe(70);
      expect(ledger.total).toBe(500000);
    });

    it("charges nothing when the response carries no usage", async () => {
      const { aiManager } = createHarness({
        messages: [userMessage("+500k run the workflow")],
      });
      mockResponse(undefined);

      await aiManager.sendAIMessage();

      expect(ledger.getTurnSpent()).toBe(0);
    });
  });

  describe("turn target", () => {
    it("reads a `+500k` target from the user prompt", async () => {
      const { aiManager } = createHarness({
        messages: [userMessage("Research this. +500k")],
      });
      mockResponse(undefined);

      await aiManager.sendAIMessage();

      expect(ledger.total).toBe(500000);
      expect(ledger.remaining()).toBe(500000);
    });

    it("reads a `use 500k tokens` target from the user prompt", async () => {
      const { aiManager } = createHarness({
        messages: [userMessage("Please use 500k tokens at most")],
      });
      mockResponse(undefined);

      await aiManager.sendAIMessage();

      expect(ledger.total).toBe(500000);
    });

    it("leaves the turn unbounded when the prompt has no token target", async () => {
      const { aiManager } = createHarness({
        messages: [userMessage("Summarize the diff")],
      });
      mockResponse({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "test-model",
        operation_type: "agent",
      });

      await aiManager.sendAIMessage();

      expect(ledger.total).toBeNull();
      expect(ledger.remaining()).toBe(Infinity);
    });

    it("keeps the user's target across a notification-triggered turn", async () => {
      const { aiManager } = createHarness({
        messages: [
          userMessage("Run the research. +500k"),
          notificationMessage(),
        ],
      });
      mockResponse(undefined);

      await aiManager.sendAIMessage();

      expect(ledger.total).toBe(500000);
    });
  });

  describe("turn boundary", () => {
    it("re-baselines on the next main-agent turn so spent() resets", async () => {
      const { aiManager } = createHarness({
        messages: [userMessage("+500k run the workflow")],
      });

      mockResponse({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "test-model",
        operation_type: "agent",
      });
      await aiManager.sendAIMessage();
      expect(ledger.getTurnSpent()).toBe(50);

      mockResponse({
        prompt_tokens: 100,
        completion_tokens: 70,
        total_tokens: 170,
        model: "test-model",
        operation_type: "agent",
      });
      await aiManager.sendAIMessage();

      // Second turn only, not 50 + 70.
      expect(ledger.getTurnSpent()).toBe(70);
      expect(ledger.total).toBe(500000);
    });

    it("does not re-baseline on a subagent turn (shared budget)", async () => {
      const { aiManager } = createHarness({
        messages: [userMessage("+500k run the workflow")],
        subagentType: "general-purpose",
      });
      // The parent's turn already started and consumed 400 output tokens.
      ledger.beginTurn(1000);
      ledger.addOutputTokens(400);

      mockResponse({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "test-model",
        operation_type: "agent",
      });
      await aiManager.sendAIMessage();

      expect(ledger.total).toBe(1000);
      expect(ledger.getTurnSpent()).toBe(450);
      expect(ledger.remaining()).toBe(550);
    });

    it("skips token accounting entirely when no ledger is registered", async () => {
      const { aiManager } = createHarness({
        messages: [userMessage("+500k run the workflow")],
        withLedger: false,
      });

      mockResponse({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "test-model",
        operation_type: "agent",
      });

      await expect(aiManager.sendAIMessage()).resolves.toBeUndefined();
      // A bare container has no ledger: nothing to charge, no crash.
      expect(ledger.getTurnSpent()).toBe(0);
      expect(ledger.total).toBeNull();
    });
  });
});
