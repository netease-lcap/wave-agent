import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { Container } from "../../src/utils/container.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

// Mock dependencies
vi.mock("../../src/managers/messageManager.js");
vi.mock("../../src/managers/toolManager.js");
vi.mock("../../src/managers/permissionManager.js", () => ({
  PermissionManager: vi.fn().mockImplementation(function () {
    return {
      getConfiguredDefaultMode: vi.fn(),
      getAllowedRules: vi.fn(),
      getDeniedRules: vi.fn(),
      getAdditionalDirectories: vi.fn(),
      getPlanFilePath: vi.fn(),
      addTemporaryRules: vi.fn(),
    };
  }),
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

describe("SubagentManager Dynamic Config", () => {
  let subagentManager: SubagentManager;
  let mockToolManager: ToolManager;
  let container: Container;
  let configurationService: ConfigurationService;

  const inheritConfig: SubagentConfiguration = {
    name: "InheritAgent",
    description: "Agent that inherits model",
    systemPrompt: "System prompt",
    tools: ["Read"],
    model: "inherit",
    filePath: "/home/user/.wave/agents/inherit.md",
    scope: "user",
    priority: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    container = new Container();

    // Real ConfigurationService but we'll control its state
    configurationService = new ConfigurationService();
    configurationService.setOptions({});
    container.register("ConfigurationService", configurationService);

    // Mock ToolManager
    mockToolManager = {
      list: vi.fn(() => [{ name: "Read" }]),
      getPermissionManager: vi.fn(),
      initializeBuiltInTools: vi.fn(),
    } as unknown as ToolManager;
    container.register("ToolManager", mockToolManager);

    container.register("TaskManager", {} as unknown as Record<string, unknown>);

    // Mock AIManager to return the model from configuration service
    const mockAIManager = {
      getModelConfig: () => configurationService.resolveModelConfig(),
    };
    container.register(
      "AIManager",
      mockAIManager as unknown as Record<string, unknown>,
    );

    subagentManager = new SubagentManager(container, {
      workdir: "/test",
    });
  });

  it("should inherit the parent's model when model is set to 'inherit'", async () => {
    // Set parent model to something specific
    configurationService.setOptions({ model: "gpt-4" });

    const instance = await subagentManager.createInstance(inheritConfig, {
      description: "Test task",
      prompt: "Test prompt",
      subagent_type: "InheritAgent",
    });

    // The subagent's AIManager should now resolve to gpt-4
    expect(instance.aiManager.getModelConfig().model).toBe("gpt-4");
  });

  it("should pick up parent's model changes for new subagent instances", async () => {
    // 1. Set parent model to model-A
    configurationService.setOptions({ model: "model-A" });

    const instance1 = await subagentManager.createInstance(inheritConfig, {
      description: "Task 1",
      prompt: "Prompt 1",
      subagent_type: "InheritAgent",
    });
    expect(instance1.aiManager.getModelConfig().model).toBe("model-A");

    // 2. Change parent model to model-B
    configurationService.setOptions({ model: "model-B" });

    const instance2 = await subagentManager.createInstance(inheritConfig, {
      description: "Task 2",
      prompt: "Prompt 2",
      subagent_type: "InheritAgent",
    });

    // The new instance should pick up the new parent model
    expect(instance2.aiManager.getModelConfig().model).toBe("model-B");
  });

  it("should inherit environment variables from parent", async () => {
    configurationService.setEnvironmentVars({ CUSTOM_VAR: "parent-value" });

    const instance = await subagentManager.createInstance(inheritConfig, {
      description: "Test task",
      prompt: "Test prompt",
      subagent_type: "InheritAgent",
    });

    // Get the subagent's configuration service from its container
    const subagentConfigService = (
      instance.aiManager as unknown as {
        container: Container;
      }
    ).container.get<ConfigurationService>("ConfigurationService");
    expect(subagentConfigService?.getEnvironmentVars().CUSTOM_VAR).toBe(
      "parent-value",
    );
  });
});
