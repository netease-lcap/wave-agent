import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";

// Mock the subagent parser module
vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));

describe("Subagent Permission Sync", () => {
  let subagentManager: SubagentManager;
  let container: Container;
  let mockGatewayConfig: GatewayConfig;
  let mockModelConfig: ModelConfig;

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

  let parentPermissionManager: PermissionManager;

  beforeEach(async () => {
    container = new Container();

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

    // Register parent PermissionManager BEFORE initializing SubagentManager
    // so the hook can wrap its methods
    container.register("Workdir", "/tmp/test");
    parentPermissionManager = new PermissionManager(container);
    container.register("PermissionManager", parentPermissionManager);

    subagentManager = new SubagentManager(container, {
      workdir: "/tmp/test",
      stream: false,
    });

    await subagentManager.initialize();
  });

  function getSubagentPermissionManager(subagentId: string) {
    const instance = subagentManager.getInstance(subagentId);
    if (!instance) throw new Error("Instance not found");
    const subagentContainer = (
      instance.aiManager as unknown as { container: Container }
    ).container;
    return subagentContainer.get<PermissionManager>("PermissionManager")!;
  }

  it("should sync allowedRules to running subagents when parent updates", async () => {
    const instance = await subagentManager.createInstance(mockConfig, {
      description: "test task",
      prompt: "test prompt",
      subagent_type: "test-agent",
    });

    const subagentPm = getSubagentPermissionManager(instance.subagentId);
    expect(subagentPm.getAllowedRules()).toEqual([]);

    // Update parent's allowed rules
    parentPermissionManager.updateAllowedRules(["git:*", "ls *"]);

    // Subagent should have synced
    expect(subagentPm.getAllowedRules()).toEqual(["git:*", "ls *"]);
  });

  it("should sync deniedRules to running subagents when parent updates", async () => {
    const instance = await subagentManager.createInstance(mockConfig, {
      description: "test task",
      prompt: "test prompt",
      subagent_type: "test-agent",
    });

    const subagentPm = getSubagentPermissionManager(instance.subagentId);
    expect(subagentPm.getDeniedRules()).toEqual([]);

    // Update parent's denied rules
    parentPermissionManager.updateDeniedRules(["Bash(rm *)"]);

    // Subagent should have synced
    expect(subagentPm.getDeniedRules()).toEqual(["Bash(rm *)"]);
  });

  it("should sync additionalDirectories to running subagents when parent updates", async () => {
    const instance = await subagentManager.createInstance(mockConfig, {
      description: "test task",
      prompt: "test prompt",
      subagent_type: "test-agent",
    });

    const subagentPm = getSubagentPermissionManager(instance.subagentId);
    expect(subagentPm.getAdditionalDirectories()).toEqual([]);

    // Update parent's additional directories
    parentPermissionManager.updateAdditionalDirectories(["/tmp/other"]);

    // Subagent should have synced
    expect(subagentPm.getAdditionalDirectories()).toEqual(["/tmp/other"]);
  });

  it("should sync to multiple running subagents", async () => {
    const instance1 = await subagentManager.createInstance(mockConfig, {
      description: "task 1",
      prompt: "prompt 1",
      subagent_type: "test-agent",
    });
    const instance2 = await subagentManager.createInstance(mockConfig, {
      description: "task 2",
      prompt: "prompt 2",
      subagent_type: "test-agent",
    });

    const subagentPm1 = getSubagentPermissionManager(instance1.subagentId);
    const subagentPm2 = getSubagentPermissionManager(instance2.subagentId);

    // Update parent's rules
    parentPermissionManager.updateAllowedRules(["git:*"]);
    parentPermissionManager.updateDeniedRules(["Bash(rm *)"]);

    // Both subagents should have synced
    expect(subagentPm1.getAllowedRules()).toEqual(["git:*"]);
    expect(subagentPm1.getDeniedRules()).toEqual(["Bash(rm *)"]);
    expect(subagentPm2.getAllowedRules()).toEqual(["git:*"]);
    expect(subagentPm2.getDeniedRules()).toEqual(["Bash(rm *)"]);
  });

  it("should not sync to cleaned-up subagents", async () => {
    const instance = await subagentManager.createInstance(mockConfig, {
      description: "test task",
      prompt: "test prompt",
      subagent_type: "test-agent",
    });

    const subagentPm = getSubagentPermissionManager(instance.subagentId);

    // Mark as completed and cleanup
    subagentManager.updateInstanceStatus(instance.subagentId, "completed");
    subagentManager.cleanupInstance(instance.subagentId);

    // Update parent's rules after cleanup
    parentPermissionManager.updateAllowedRules(["git:*"]);

    // The cleaned-up subagent's rules should NOT have changed
    // (it was removed from the tracking map)
    expect(subagentPm.getAllowedRules()).toEqual([]);
  });

  it("should sync all three rule types simultaneously", async () => {
    const instance = await subagentManager.createInstance(mockConfig, {
      description: "test task",
      prompt: "test prompt",
      subagent_type: "test-agent",
    });

    const subagentPm = getSubagentPermissionManager(instance.subagentId);

    // Update all three types
    parentPermissionManager.updateAllowedRules(["git:*"]);
    parentPermissionManager.updateDeniedRules(["Bash(rm *)"]);
    parentPermissionManager.updateAdditionalDirectories(["/tmp/shared"]);

    expect(subagentPm.getAllowedRules()).toEqual(["git:*"]);
    expect(subagentPm.getDeniedRules()).toEqual(["Bash(rm *)"]);
    expect(subagentPm.getAdditionalDirectories()).toEqual(["/tmp/shared"]);
  });
});
