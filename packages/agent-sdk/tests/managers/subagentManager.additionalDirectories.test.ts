/**
 * @file Tests that subagents inherit instance additional directories from the
 * parent PermissionManager (session-level /add-dir directories).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { SubagentManagerCallbacks } from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";

import { Container } from "../../src/utils/container.js";

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
vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));

// Mock the AI service
vi.mock("../../src/services/aiService.js", () => ({
  sendAIMessage: vi.fn().mockResolvedValue({
    content: "Mock AI response",
    toolCalls: [],
    usage: { totalTokens: 10 },
  }),
}));

describe("SubagentManager - instance additional directories inheritance", () => {
  let subagentManager: SubagentManager;
  let parentToolManager: ToolManager;
  let callbacks: SubagentManagerCallbacks;
  let mockGatewayConfig: GatewayConfig;
  let mockModelConfig: ModelConfig;
  let container: Container;
  const instanceDirs = [path.resolve("/tmp/test/shared-session")];

  beforeEach(async () => {
    callbacks = {};

    container = new Container();
    container.register("PermissionManager", {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getConfiguredPermissionMode: vi.fn().mockReturnValue("acceptEdits"),
      getAllowedRules: vi.fn().mockReturnValue([]),
      getDeniedRules: vi.fn().mockReturnValue([]),
      getInstanceAllowedRules: vi.fn().mockReturnValue([]),
      getInstanceDeniedRules: vi.fn().mockReturnValue([]),
      getAdditionalDirectories: vi.fn().mockReturnValue([]),
      getInstanceAdditionalDirectories: vi.fn().mockReturnValue(instanceDirs),
      getSystemAdditionalDirectories: vi.fn().mockReturnValue([]),
      getPlanFilePath: vi.fn().mockReturnValue(undefined),
    } as unknown as Record<string, unknown>);
    container.register("TaskManager", {} as unknown as Record<string, unknown>);
    container.register(
      "ReversionManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "BackgroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "ForegroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register("LspManager", {} as unknown as Record<string, unknown>);

    const mockMcpManager = {
      listTools: vi.fn().mockReturnValue([]),
      callTool: vi.fn().mockResolvedValue({ result: "mock result" }),
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    };
    container.register(
      "McpManager",
      mockMcpManager as unknown as Record<string, unknown>,
    );

    parentToolManager = new ToolManager({
      container,
    });
    container.register("ToolManager", parentToolManager);

    mockGatewayConfig = {
      apiKey: "test-key",
      baseURL: "https://api.anthropic.com",
    };

    mockModelConfig = {
      model: "claude-3-sonnet",
      fastModel: "claude-3-haiku",
    };

    container.register("ConfigurationService", {
      resolveGatewayConfig: () => mockGatewayConfig,
      resolveModelConfig: () => mockModelConfig,
      resolveMaxInputTokens: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => undefined,
    });

    subagentManager = new SubagentManager(container, {
      workdir: "/tmp/test",
      callbacks,
      stream: false,
    });

    await subagentManager.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should inherit instance additional directories into the subagent PermissionManager", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "test-subagent",
      description: "A test subagent",
      systemPrompt: "You are a test subagent",
      tools: ["Read", "Write"],
      model: "inherit",
      filePath: "/tmp/test-subagent.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "Test instance dir inheritance",
      prompt: "Test prompt",
      subagent_type: "test-subagent",
    });

    const subContainer = (
      instance.toolManager as unknown as { container: Container }
    ).container;
    const subPermissionManager = subContainer.get("PermissionManager");
    const inherited = (
      subPermissionManager as unknown as {
        getInstanceAdditionalDirectories: () => string[];
      }
    ).getInstanceAdditionalDirectories();

    expect(inherited).toEqual(instanceDirs);
  });
});
