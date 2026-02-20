import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { SubagentManagerCallbacks } from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import type { TaskManager } from "../../src/services/taskManager.js";
import type { ToolContext } from "../../src/tools/types.js";

// Mock the subagent parser module
vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));

describe("SubagentManager - Recent Changes Coverage", () => {
  let subagentManager: SubagentManager;
  let parentToolManager: ToolManager;
  let callbacks: SubagentManagerCallbacks;
  let mockGatewayConfig: GatewayConfig;
  let mockModelConfig: ModelConfig;

  beforeEach(async () => {
    callbacks = {
      onSubagentToolBlockUpdated: vi.fn(),
    };

    const mockMcpManager = {
      listTools: vi.fn().mockReturnValue([]),
      callTool: vi.fn().mockResolvedValue({ result: "mock result" }),
    };

    parentToolManager = new ToolManager({
      mcpManager: mockMcpManager as unknown as McpManager,
    });

    mockGatewayConfig = {
      apiKey: "test-key",
      baseURL: "https://api.anthropic.com",
    };
    mockModelConfig = {
      agentModel: "claude-3-sonnet",
      fastModel: "claude-3-haiku",
    };

    subagentManager = new SubagentManager({
      workdir: "/tmp/test",
      parentToolManager,
      taskManager: {} as unknown as TaskManager,
      callbacks,
      getGatewayConfig: () => mockGatewayConfig,
      getModelConfig: () => mockModelConfig,
      getMaxInputTokens: () => 1000,
      getLanguage: () => undefined,
    });

    await subagentManager.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should track last two tool names in subagent instance (ad85945f)", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "tool-tracker",
      description: "Tracks tools",
      systemPrompt: "...",
      tools: ["ToolA", "ToolB", "ToolC"],
      model: "inherit",
      filePath: "/tmp/tool-tracker.md",
      scope: "project",
      priority: 1,
    };

    const onUpdate = vi.fn();
    const instance = await subagentManager.createInstance(
      mockConfig,
      {
        description: "Test",
        prompt: "Test",
        subagent_type: "tool-tracker",
      },
      false,
      onUpdate,
    );

    // Simulate tool block updates
    instance.messageManager.updateToolBlock({
      id: "1",
      name: "ToolA",
      stage: "running",
    });
    expect(instance.lastTools).toEqual(["ToolA"]);
    expect(onUpdate).toHaveBeenCalled();

    instance.messageManager.updateToolBlock({
      id: "2",
      name: "ToolB",
      stage: "running",
    });
    expect(instance.lastTools).toEqual(["ToolA", "ToolB"]);

    instance.messageManager.updateToolBlock({
      id: "3",
      name: "ToolC",
      stage: "running",
    });
    expect(instance.lastTools).toEqual(["ToolB", "ToolC"]); // Should only keep last two
  });

  it("should cleanup subagent instance on completion (7b412d33)", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "cleanup-test",
      description: "Cleanup test",
      systemPrompt: "...",
      tools: [],
      model: "inherit",
      filePath: "/tmp/cleanup.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "Test",
      prompt: "Test",
      subagent_type: "cleanup-test",
    });

    const subagentId = instance.subagentId;
    expect(subagentManager.getInstance(subagentId)).toBe(instance);

    // Set status to completed and cleanup
    subagentManager.updateInstanceStatus(subagentId, "completed");
    subagentManager.cleanupInstance(subagentId);

    expect(subagentManager.getInstance(subagentId)).toBeNull();
  });

  it("should cleanup subagent instance on error (7b412d33)", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "cleanup-error-test",
      description: "Cleanup error test",
      systemPrompt: "...",
      tools: [],
      model: "inherit",
      filePath: "/tmp/cleanup-error.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "Test",
      prompt: "Test",
      subagent_type: "cleanup-error-test",
    });

    const subagentId = instance.subagentId;
    subagentManager.updateInstanceStatus(subagentId, "error");
    subagentManager.cleanupInstance(subagentId);

    expect(subagentManager.getInstance(subagentId)).toBeNull();
  });

  it("should update shortResult with tool names and count (ad85945f)", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "short-result-test",
      description: "Tests short result",
      systemPrompt: "...",
      tools: ["ToolA"],
      model: "inherit",
      filePath: "/tmp/short-result.md",
      scope: "project",
      priority: 1,
    };

    // Use spyOn instead of vi.mocked for instance methods
    vi.spyOn(subagentManager, "findSubagent").mockResolvedValue(mockConfig);

    const { createTaskTool } = await import("../../src/tools/taskTool.js");
    const taskTool = createTaskTool(subagentManager);

    const onShortResultUpdate = vi.fn();
    const context = {
      onShortResultUpdate,
      abortSignal: new AbortController().signal,
    } as unknown as ToolContext;

    // We need to mock executeTask to not actually run AI
    vi.spyOn(subagentManager, "executeTask").mockResolvedValue("Done");

    await taskTool.execute(
      {
        description: "Test",
        prompt: "Test",
        subagent_type: "short-result-test",
      },
      context,
    );

    // Get the instance created during execute
    const activeInstances = subagentManager.getActiveInstances();
    const instance = activeInstances.find(
      (i) => i.configuration.name === "short-result-test",
    )!;

    // Simulate tool updates
    instance.lastTools.push("ToolA");
    instance.messageManager.addAssistantMessage("Thinking", [
      {
        id: "1",
        type: "function",
        function: { name: "ToolA", arguments: "{}" },
      },
    ]);

    // Trigger the update callback that was passed to createInstance
    instance.onUpdate?.();

    expect(onShortResultUpdate).toHaveBeenCalledWith(
      expect.stringContaining("ToolA (1 tools"),
    );
  });
});
