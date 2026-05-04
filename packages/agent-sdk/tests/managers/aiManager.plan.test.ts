import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import fs from "node:fs/promises";
import { callAgent } from "../../src/services/aiService.js";
import { DEFAULT_SYSTEM_PROMPT } from "../../src/prompts/index.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";

vi.mock("node:fs/promises");
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

describe("AIManager Plan Mode Prompt", () => {
  let aiManager: AIManager;
  let mockMessageManager: Mocked<MessageManager>;
  let mockToolManager: Mocked<ToolManager>;
  let mockPermissionManager: Mocked<PermissionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session"),
      getMessages: vi.fn().mockReturnValue([]),
      saveSession: vi.fn().mockResolvedValue(undefined),
      addAssistantMessage: vi.fn(),
      updateCurrentMessageContent: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      addErrorBlock: vi.fn(),
    } as unknown as Mocked<MessageManager>;
    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      getDeferredToolNames: vi.fn().mockReturnValue([]),
    } as unknown as Mocked<ToolManager>;

    mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getPlanFilePath: vi.fn().mockReturnValue("/path/to/plan.md"),
      clearTemporaryRules: vi.fn(),
    } as unknown as Mocked<PermissionManager>;

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
    });
    container.register("PermissionManager", mockPermissionManager);

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
  });

  it("should use default system prompt in default mode", async () => {
    await aiManager.sendAIMessage();

    expect(callAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(DEFAULT_SYSTEM_PROMPT),
      }),
    );
  });

  it("should NOT include plan mode in system prompt (injected as user meta message instead)", async () => {
    mockPermissionManager.getCurrentEffectiveMode.mockReturnValue("plan");
    vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

    await aiManager.sendAIMessage();

    const callOptions = vi.mocked(callAgent).mock.calls[0][0];
    // Plan mode instructions are now injected as user meta message, not in system prompt
    expect(callOptions.systemPrompt).not.toContain("Plan mode is active");
  });

  it("should inject plan mode as user meta message when file does not exist", async () => {
    mockPermissionManager.getCurrentEffectiveMode.mockReturnValue("plan");
    vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

    await aiManager.sendAIMessage();

    const callOptions = vi.mocked(callAgent).mock.calls[0][0];
    const messages = callOptions.messages as Array<{
      role: string;
      content: string;
    }>;
    // First message should be the plan mode meta message
    const planMessage = messages.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("<system-reminder>") &&
        m.content.includes("Plan mode is active"),
    );
    expect(planMessage).toBeDefined();
    expect(planMessage!.content).toContain("Plan File Info");
    expect(planMessage!.content).toContain(
      "Plan mode is active. The user indicated that they do not want you to execute yet",
    );
    expect(planMessage!.content).toContain("No plan file exists yet");
    expect(planMessage!.content).toContain("using the Write tool");
  });

  it("should inject plan mode as user meta message when file exists", async () => {
    mockPermissionManager.getCurrentEffectiveMode.mockReturnValue("plan");
    vi.mocked(fs.access).mockResolvedValue(undefined);

    await aiManager.sendAIMessage();

    const callOptions = vi.mocked(callAgent).mock.calls[0][0];
    const messages = callOptions.messages as Array<{
      role: string;
      content: string;
    }>;
    // First message should be the plan mode meta message
    const planMessage = messages.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("<system-reminder>") &&
        m.content.includes("Plan mode is active"),
    );
    expect(planMessage).toBeDefined();
    expect(planMessage!.content).toContain("Plan File Info");
    expect(planMessage!.content).toContain(
      "Plan mode is active. The user indicated that they do not want you to execute yet",
    );
    expect(planMessage!.content).toContain("A plan file already exists");
    expect(planMessage!.content).toContain("using the Edit tool");
  });
});
