import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

// Mock AIManager to capture the system prompt
vi.mock("../../src/managers/aiManager.js", async () => {
  const actual = await vi.importActual("../../src/managers/aiManager.js");
  return {
    ...actual,
    AIManager: vi.fn().mockImplementation(function (options) {
      const ActualAIManager = (actual as { AIManager: typeof AIManager })
        .AIManager;
      const aiManager = new ActualAIManager(options);
      // Spy on sendAIMessage to capture the system prompt
      const originalSendAIMessage = aiManager.sendAIMessage.bind(aiManager);
      aiManager.sendAIMessage = vi.fn().mockImplementation(async (params) => {
        return originalSendAIMessage(params);
      });
      return aiManager;
    }),
  };
});

// Mock callAgent to capture the final system prompt sent to the AI
vi.mock("../../src/services/aiService.js", async () => {
  const actual = await vi.importActual("../../src/services/aiService.js");
  return {
    ...actual,
    callAgent: vi.fn().mockResolvedValue({
      content: "Subagent response",
      toolCalls: [],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
  };
});

describe("Subagent Plan Mode Integration", () => {
  let subagentManager: SubagentManager;
  let mockToolManager: ToolManager;
  let mockPermissionManager: PermissionManager;

  const subagentConfig: SubagentConfiguration = {
    name: "TestSubagent",
    description: "A test subagent",
    systemPrompt: "Base subagent system prompt",
    tools: ["Read"],
    model: "inherit",
    filePath: "/test/subagent.md",
    scope: "user",
    priority: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock PermissionManager in plan mode
    mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("plan"),
      getPlanFilePath: vi.fn().mockReturnValue("/test/project/plan.md"),
      addTemporaryRules: vi.fn(),
      removeTemporaryRules: vi.fn(),
      clearTemporaryRules: vi.fn(),
    } as unknown as PermissionManager;

    // Mock ToolManager
    mockToolManager = {
      getPermissionManager: vi.fn().mockReturnValue(mockPermissionManager),
      list: vi.fn().mockReturnValue([]),
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolManager;

    subagentManager = new SubagentManager({
      workdir: "/test/project",
      parentToolManager: mockToolManager,
      taskManager: {
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager,
      getGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      getModelConfig: () => ({
        agentModel: "test-model",
        fastModel: "test-fast-model",
        permissionMode: "plan",
      }),
      getMaxInputTokens: () => 100000,
      getLanguage: () => undefined,
    });
  });

  it("should include plan mode reminder in subagent system prompt when plan mode is active", async () => {
    const instance = await subagentManager.createInstance(subagentConfig, {
      description: "Test task",
      prompt: "Test prompt",
      subagent_type: "TestSubagent",
    });

    // Execute task
    await subagentManager.executeTask(instance, "Test prompt");

    // Verify that AIManager was created with the permissionManager
    expect(AIManager).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionManager: mockPermissionManager,
      }),
    );

    // Verify the system prompt sent to callAgent
    const { callAgent } = await import("../../src/services/aiService.js");
    const callAgentMock = vi.mocked(callAgent);

    expect(callAgentMock).toHaveBeenCalled();
    const lastCall = callAgentMock.mock.calls[0][0];
    const systemPrompt = lastCall.systemPrompt;

    expect(systemPrompt).toContain("Plan mode is active.");
    expect(systemPrompt).toContain(
      "The user indicated that they do not want you to execute yet",
    );
    expect(systemPrompt).toContain("/test/project/plan.md");
  });
});
