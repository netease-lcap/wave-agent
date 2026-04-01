import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { ToolContext } from "../../src/tools/types.js";

// Mock the subagent parser module
vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));

describe("Subagent Permission Integration", () => {
  let subagentManager: SubagentManager;
  let container: Container;
  let mockGatewayConfig: GatewayConfig;
  let mockModelConfig: ModelConfig;

  beforeEach(async () => {
    container = new Container();

    // Register necessary managers in parent container
    const mockMcpManager = {
      listTools: vi.fn().mockReturnValue([]),
    };
    container.register(
      "McpManager",
      mockMcpManager as unknown as { listTools: () => string[] },
    );

    const toolManager = new ToolManager({ container });
    container.register("ToolManager", toolManager);

    mockGatewayConfig = { apiKey: "test", baseURL: "test" };
    mockModelConfig = { model: "test", fastModel: "test" };

    container.register("ConfigurationService", {
      resolveGatewayConfig: () => mockGatewayConfig,
      resolveModelConfig: () => mockModelConfig,
      resolveMaxInputTokens: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => undefined,
    });

    subagentManager = new SubagentManager(container, {
      workdir: "/tmp/test",
      stream: false,
    });

    await subagentManager.initialize();
  });

  it("should pass allowedTools as permission rules to the subagent's PermissionManager", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "test-agent",
      description: "test",
      systemPrompt: "test",
      tools: ["Bash"],
      model: "inherit",
      filePath: "/tmp/test.md",
      scope: "project",
      priority: 1,
    };

    const allowedTools = ["git:*", "ls *"];

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "test task",
      prompt: "test prompt",
      subagent_type: "test-agent",
      allowedTools: allowedTools,
    });

    // Get the subagent's container (it's private in SubagentManager, but we can access it via the managers)
    // Actually, we can't easily get the subagent's container from the instance.
    // But we can check if the PermissionManager in the subagent's AIManager/MessageManager context has the rules.

    // A better way: since we are in a test, we can use a trick to get the subagent's PermissionManager.
    // The subagent's AIManager is created with the subagent's container.
    const subagentAIManager = instance.aiManager;
    const subagentContainer = (
      subagentAIManager as unknown as { container: Container }
    ).container;
    const subagentPermissionManager =
      subagentContainer.get<PermissionManager>("PermissionManager");

    expect(subagentPermissionManager).toBeDefined();

    // Check if the rules were added as temporary rules
    expect(
      (subagentPermissionManager as unknown as { temporaryRules: string[] })
        .temporaryRules,
    ).toContain("git:*");
    expect(
      (subagentPermissionManager as unknown as { temporaryRules: string[] })
        .temporaryRules,
    ).toContain("ls *");
  });

  it("should verify that subagent's PermissionManager is isolated from parent", async () => {
    const parentPermissionManager = new PermissionManager(container, {
      workdir: "/tmp/test",
    });
    container.register("PermissionManager", parentPermissionManager);

    const mockConfig: SubagentConfiguration = {
      name: "test-agent",
      description: "test",
      systemPrompt: "test",
      tools: ["Bash"],
      model: "inherit",
      filePath: "/tmp/test.md",
      scope: "project",
      priority: 1,
    };

    const allowedTools = ["git:*"];

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "test task",
      prompt: "test prompt",
      subagent_type: "test-agent",
      allowedTools: allowedTools,
    });

    const subagentContainer = (
      instance.aiManager as unknown as { container: Container }
    ).container;
    const subagentPermissionManager =
      subagentContainer.get<PermissionManager>("PermissionManager");

    // Subagent should have the rule
    expect(
      (subagentPermissionManager as unknown as { temporaryRules: string[] })
        .temporaryRules,
    ).toContain("git:*");

    // Parent should NOT have the rule
    expect(
      (parentPermissionManager as unknown as { temporaryRules: string[] })
        .temporaryRules,
    ).not.toContain("git:*");
  });

  it("should inherit all permission settings from parent PermissionManager", async () => {
    const parentPermissionManager = new PermissionManager(container, {
      workdir: "/tmp/test",
      configuredPermissionMode: "acceptEdits",
      allowedRules: ["git:*"],
      deniedRules: ["Bash(rm *)"],
      additionalDirectories: ["/tmp/other"],
      planFilePath: "/tmp/test/plan.md",
    });
    container.register("PermissionManager", parentPermissionManager);

    const mockConfig: SubagentConfiguration = {
      name: "test-agent",
      description: "test",
      systemPrompt: "test",
      tools: ["Bash"],
      model: "inherit",
      filePath: "/tmp/test.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "test task",
      prompt: "test prompt",
      subagent_type: "test-agent",
    });

    const subagentContainer = (
      instance.aiManager as unknown as { container: Container }
    ).container;
    const subagentPermissionManager =
      subagentContainer.get<PermissionManager>("PermissionManager")!;

    expect(subagentPermissionManager.getConfiguredPermissionMode()).toBe(
      "acceptEdits",
    );
    expect(subagentPermissionManager.getAllowedRules()).toContain("git:*");
    expect(subagentPermissionManager.getDeniedRules()).toContain("Bash(rm *)");
    expect(subagentPermissionManager.getAdditionalDirectories()).toContain(
      "/tmp/other",
    );
    expect(subagentPermissionManager.getPlanFilePath()).toBe(
      "/tmp/test/plan.md",
    );
  });

  it("should inherit instance-specific permission rules from parent PermissionManager", async () => {
    const parentPermissionManager = new PermissionManager(container, {
      workdir: "/tmp/test",
      instanceAllowedRules: ["Bash(ls)"],
      instanceDeniedRules: ["Bash(rm *)"],
    });
    container.register("PermissionManager", parentPermissionManager);

    const mockConfig: SubagentConfiguration = {
      name: "test-agent",
      description: "test",
      systemPrompt: "test",
      tools: ["Bash"],
      model: "inherit",
      filePath: "/tmp/test.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "test task",
      prompt: "test prompt",
      subagent_type: "test-agent",
    });

    const subagentContainer = (
      instance.aiManager as unknown as { container: Container }
    ).container;
    const subagentPermissionManager =
      subagentContainer.get<PermissionManager>("PermissionManager")!;

    expect(subagentPermissionManager.getInstanceAllowedRules()).toContain(
      "Bash(ls)",
    );
    expect(subagentPermissionManager.getInstanceDeniedRules()).toContain(
      "Bash(rm *)",
    );
  });

  it("should verify that skillTool passes allowedTools to subagentManager.createInstance", async () => {
    const { skillTool } = await import("../../src/tools/skillTool.js");
    const mockSkillManager = {
      getSkillMetadata: vi.fn().mockReturnValue({ context: "fork" }),
      executeSkill: vi.fn().mockResolvedValue({
        content: "skill content",
        allowedTools: ["git:*"],
      }),
    };

    const mockSubagentManager = {
      findSubagent: vi.fn().mockResolvedValue({ name: "gp" }),
      createInstance: vi.fn().mockResolvedValue({
        subagentId: "test-id",
        messageManager: {
          getMessages: vi.fn(() => []),
          getLatestTotalTokens: vi.fn(() => 0),
        },
        lastTools: [],
      }),
      executeAgent: vi.fn().mockResolvedValue("task result"),
      cleanupInstance: vi.fn(),
    };

    const mockContext = {
      skillManager: mockSkillManager,
      subagentManager: mockSubagentManager,
      abortSignal: new AbortController().signal,
    };

    await skillTool.execute(
      { skill_name: "test-skill" },
      mockContext as unknown as ToolContext,
    );

    expect(mockSubagentManager.createInstance).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        allowedTools: ["git:*"],
      }),
      false,
      expect.any(Function),
    );
  });
});
