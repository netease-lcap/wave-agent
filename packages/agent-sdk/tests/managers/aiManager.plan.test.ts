import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { existsSync } from "node:fs";
import { callAgent, compactMessages } from "../../src/services/aiService.js";
import { DEFAULT_SYSTEM_PROMPT } from "../../src/prompts/index.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { PlanManager } from "../../src/managers/planManager.js";
import type { Message } from "../../src/types/index.js";

vi.mock("node:fs/promises");
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));
vi.mock("../../src/services/aiService.js");
vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

/** Extract text from API message content (string or content parts array). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p: { type: string; text?: string }) =>
        p.type === "text" ? (p.text ?? "") : "",
      )
      .join("");
  }
  return "";
}

describe("AIManager Plan Mode Prompt", () => {
  let aiManager: AIManager;
  let mockMessageManager: Mocked<MessageManager>;
  let mockToolManager: Mocked<ToolManager>;
  let mockPermissionManager: Mocked<PermissionManager>;
  let mockPlanManager: Mocked<PlanManager>;
  let mockMessages: Message[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessages = [];

    mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session"),
      getMessages: vi.fn(() => [...mockMessages]),
      saveSession: vi.fn().mockResolvedValue(undefined),
      addAssistantMessage: vi.fn(() => {
        mockMessages.push({
          id: `assistant-${mockMessages.length}`,
          role: "assistant",
          blocks: [{ type: "text", content: "hello" }],
          timestamp: new Date().toISOString(),
        } as Message);
      }),
      addUserMessage: vi.fn((params: { content: string; isMeta?: boolean }) => {
        mockMessages.push({
          id: `user-${mockMessages.length}`,
          role: "user",
          blocks: [{ type: "text", content: params.content }],
          timestamp: new Date().toISOString(),
          isMeta: params.isMeta,
        } as Message);
      }),
      updateCurrentMessageContent: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      getStableMemory: vi.fn().mockResolvedValue(""),
      getActiveRulesContent: vi.fn().mockReturnValue(""),
      addErrorBlock: vi.fn(),
      touchFile: vi.fn(),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.jsonl"),
      getRecentFileReads: vi.fn().mockReturnValue([]),
      getInvokedSkillNames: vi.fn().mockReturnValue([]),
      setMessages: vi.fn((msgs: Message[]) => {
        mockMessages = [...msgs];
      }),
      finalizeStreamingBlocks: vi.fn(),
      mergeAssistantAdditionalFields: vi.fn(),
      compactMessagesAndUpdateSession: vi.fn(),
      clearMemoryCache: vi.fn(),
    } as unknown as Mocked<MessageManager>;
    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
    } as unknown as Mocked<ToolManager>;

    mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getPlanFilePath: vi.fn().mockReturnValue("/path/to/plan.md"),
      clearTemporaryRules: vi.fn(),
      setHasExitedPlanMode: vi.fn(),
      hasExitedPlanModeInSession: vi.fn(() => false),
      setNeedsPlanModeExitAttachment: vi.fn(),
      getNeedsPlanModeExitAttachment: vi.fn(() => false),
    } as unknown as Mocked<PermissionManager>;

    mockPlanManager = {
      isPlanEntryReminderPending: vi.fn(() => true),
      consumePlanEntryReminder: vi.fn(),
    } as unknown as Mocked<PlanManager>;

    const container = new Container();
    container.register("ConfigurationService", {
      resolveGatewayConfig: vi.fn().mockReturnValue({}),
      resolveModelConfig: vi.fn().mockReturnValue({ model: "gpt-4" }),
      resolveMaxInputTokens: vi.fn().mockReturnValue(1000),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
    });
    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", {} as unknown as TaskManager);
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
      clearCache: vi.fn(),
    });
    container.register("PermissionManager", mockPermissionManager);
    container.register("PlanManager", mockPlanManager);

    // Mock SubagentManager and register it
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });

    // Mock SkillManager and register it
    container.register("SkillManager", {
      getAvailableSkills: vi.fn().mockReturnValue([]),
    });

    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
    });

    vi.mocked(callAgent).mockResolvedValue({
      content: "hello",
      finish_reason: "stop",
    });
    vi.mocked(compactMessages).mockResolvedValue({
      content: "compacted summary",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    });
  });

  it("should use default system prompt in default mode", async () => {
    await aiManager.sendAIMessage();

    expect(callAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(DEFAULT_SYSTEM_PROMPT),
      }),
    );
  });

  it("should add plan reminder in plan mode when file does not exist", async () => {
    mockPermissionManager.getCurrentEffectiveMode.mockReturnValue("plan");
    vi.mocked(existsSync).mockReturnValue(false);

    await aiManager.sendAIMessage();

    const callOptions = vi.mocked(callAgent).mock.calls[0][0];
    const userMessages = (
      callOptions.messages as Array<{ role: string; content: unknown }>
    ).filter((m) => m.role === "user");
    const planMessage = userMessages.find((m) =>
      extractText(m.content).includes("Plan File Info"),
    );
    expect(planMessage).toBeDefined();
    expect(extractText(planMessage!.content)).toContain(
      "Plan mode is active. The user indicated that they do not want you to execute yet",
    );
    expect(extractText(planMessage!.content)).toContain(
      "No plan file exists yet",
    );
    expect(extractText(planMessage!.content)).toContain("using the Write tool");
  });

  it("should add plan reminder in plan mode when file exists", async () => {
    mockPermissionManager.getCurrentEffectiveMode.mockReturnValue("plan");
    vi.mocked(existsSync).mockReturnValue(true);

    await aiManager.sendAIMessage();

    const callOptions = vi.mocked(callAgent).mock.calls[0][0];
    const userMessages = (
      callOptions.messages as Array<{ role: string; content: unknown }>
    ).filter((m) => m.role === "user");
    const planMessage = userMessages.find((m) =>
      extractText(m.content).includes("Plan File Info"),
    );
    expect(planMessage).toBeDefined();
    expect(extractText(planMessage!.content)).toContain(
      "Plan mode is active. The user indicated that they do not want you to execute yet",
    );
    expect(extractText(planMessage!.content)).toContain(
      "A plan file already exists",
    );
    expect(extractText(planMessage!.content)).toContain("using the Edit tool");
  });

  it("should persist plan reminder across calls (one-time injection)", async () => {
    mockPermissionManager.getCurrentEffectiveMode.mockReturnValue("plan");
    vi.mocked(existsSync).mockReturnValue(false);

    // First call: reminder is pending
    mockPlanManager.isPlanEntryReminderPending.mockReturnValue(true);
    await aiManager.sendAIMessage();

    // consumePlanEntryReminder was called, making pending = false
    expect(mockPlanManager.consumePlanEntryReminder).toHaveBeenCalledTimes(1);

    // First call: plan message is present
    const firstCallOptions = vi.mocked(callAgent).mock.calls[0][0];
    const firstUserMessages = (
      firstCallOptions.messages as Array<{ role: string; content: unknown }>
    ).filter((m) => m.role === "user");
    const firstPlanMessage = firstUserMessages.find((m) =>
      extractText(m.content).includes("Plan mode is active"),
    );
    expect(firstPlanMessage).toBeDefined();

    // Second call: reminder consumed, no longer pending
    mockPlanManager.isPlanEntryReminderPending.mockReturnValue(false);
    await aiManager.sendAIMessage();

    // consumePlanEntryReminder should NOT be called again
    expect(mockPlanManager.consumePlanEntryReminder).toHaveBeenCalledTimes(1);

    // Second call: plan message is STILL present (persistent in messageManager)
    const secondCallOptions = vi.mocked(callAgent).mock.calls[1][0];
    const secondUserMessages = (
      secondCallOptions.messages as Array<{ role: string; content: unknown }>
    ).filter((m) => m.role === "user");
    const secondPlanMessage = secondUserMessages.find((m) =>
      extractText(m.content).includes("Plan mode is active"),
    );
    expect(secondPlanMessage).toBeDefined();
  });

  it("should add re-entry reminder when re-entering plan mode", async () => {
    mockPermissionManager.getCurrentEffectiveMode.mockReturnValue("plan");
    mockPermissionManager.hasExitedPlanModeInSession.mockReturnValue(true);
    vi.mocked(existsSync).mockReturnValue(true);
    mockPlanManager.isPlanEntryReminderPending.mockReturnValue(true);

    await aiManager.sendAIMessage();

    const callOptions = vi.mocked(callAgent).mock.calls[0][0];
    const userMessages = (
      callOptions.messages as Array<{ role: string; content: unknown }>
    ).filter((m) => m.role === "user");
    const planMessage = userMessages.find((m) =>
      extractText(m.content).includes("Re-entering Plan Mode"),
    );
    expect(planMessage).toBeDefined();
    expect(extractText(planMessage!.content)).toContain(
      "returning to plan mode",
    );
  });

  it("should re-add plan mode reminder after compaction", async () => {
    mockPermissionManager.getCurrentEffectiveMode.mockReturnValue("plan");
    vi.mocked(existsSync).mockReturnValue(true);

    // Need messages to compact (compactConversation skips if empty)
    mockMessages.push({
      id: "existing",
      role: "user",
      blocks: [{ type: "text", content: "hello" }],
      timestamp: new Date().toISOString(),
    } as Message);

    await aiManager.compactConversation();

    // After compaction, a plan mode meta message should have been added
    const addUserMessageCalls = vi.mocked(mockMessageManager.addUserMessage)
      .mock.calls;
    const planMetaCall = addUserMessageCalls.find((call) =>
      call[0]?.content?.includes("Plan mode is active"),
    );
    expect(planMetaCall).toBeDefined();
    expect(planMetaCall![0].isMeta).toBe(true);
  });
});
