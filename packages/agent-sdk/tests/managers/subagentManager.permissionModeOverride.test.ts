/**
 * @file Tests for permissionModeOverride in subagent creation
 * Verifies that permissionModeOverride is correctly registered in the subagent container
 * to shadow the inherited parent PermissionMode value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { SubagentManagerCallbacks } from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { PermissionMode } from "../../src/types/permissions.js";

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

describe("SubagentManager - permissionModeOverride", () => {
  let subagentManager: SubagentManager;
  let parentToolManager: ToolManager;
  let callbacks: SubagentManagerCallbacks;
  let mockGatewayConfig: GatewayConfig;
  let mockModelConfig: ModelConfig;
  let container: Container;

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

  describe("T01: permissionModeOverride is registered in the subagent container", () => {
    it("should register dontAsk in the subagent container when override is passed", async () => {
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
        description: "Test permission override",
        prompt: "Test prompt",
        subagent_type: "test-subagent",
        permissionModeOverride: "dontAsk" as PermissionMode,
      });

      // The subagent's ToolManager uses the subagent container, which should resolve "dontAsk"
      const subContainer = (
        instance.toolManager as unknown as { container: Container }
      ).container;
      const resolvedMode = subContainer.get<PermissionMode>("PermissionMode");
      expect(resolvedMode).toBe("dontAsk");
    });

    it("should not register PermissionMode when no override is passed", async () => {
      const mockConfig: SubagentConfiguration = {
        name: "test-subagent",
        description: "A test subagent",
        systemPrompt: "You are a test subagent",
        tools: ["Read"],
        model: "inherit",
        filePath: "/tmp/test-subagent.md",
        scope: "project",
        priority: 1,
      };

      const instance = await subagentManager.createInstance(mockConfig, {
        description: "Test no override",
        prompt: "Test prompt",
        subagent_type: "test-subagent",
      });

      // Without override, the subagent container should inherit from parent
      const subContainer = (
        instance.toolManager as unknown as { container: Container }
      ).container;
      // The parent container doesn't register "PermissionMode", so child shouldn't either
      expect(subContainer.has("PermissionMode")).toBe(false);
    });
  });

  describe("T02: Without permissionModeOverride, subagent inherits parent PermissionMode", () => {
    it("should inherit PermissionMode from parent container when no override", async () => {
      // Register a PermissionMode in the parent container
      container.register("PermissionMode", "acceptEdits" as PermissionMode);

      const mockConfig: SubagentConfiguration = {
        name: "test-subagent",
        description: "A test subagent",
        systemPrompt: "You are a test subagent",
        tools: ["Read"],
        model: "inherit",
        filePath: "/tmp/test-subagent.md",
        scope: "project",
        priority: 1,
      };

      const instance = await subagentManager.createInstance(mockConfig, {
        description: "Test inheritance",
        prompt: "Test prompt",
        subagent_type: "test-subagent",
      });

      // The subagent container should inherit from parent via createChild()
      const subContainer = (
        instance.toolManager as unknown as { container: Container }
      ).container;
      const resolvedMode = subContainer.get<PermissionMode>("PermissionMode");
      expect(resolvedMode).toBe("acceptEdits");
    });
  });

  describe("T03: Tool execution with permissionModeOverride respects allowedTools", () => {
    it("should deny writes to workdir when tool is not in allowedTools with dontAsk", async () => {
      const memoryDir = "/tmp/test/.wave/memory";

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

      // allowedTools only allows writing to memory directory
      const instance = await subagentManager.createInstance(mockConfig, {
        description: "Test denied write",
        prompt: "Test prompt",
        subagent_type: "test-subagent",
        permissionModeOverride: "dontAsk" as PermissionMode,
        allowedTools: [`Write(${memoryDir}/**/*)`],
      });

      const subContainer = (
        instance.toolManager as unknown as { container: Container }
      ).container;
      const subPermissionManager = subContainer.get("PermissionManager");
      expect(subPermissionManager).toBeDefined();

      // The temporaryRules should include the memory dir pattern
      const tempRules = (
        subPermissionManager as unknown as { temporaryRules: string[] }
      ).temporaryRules;
      expect(tempRules).toContain(`Write(${memoryDir}/**/*)`);

      // Check that a write to a workdir file would be denied via checkPermission
      const workdirPath = "/tmp/test/src/file.ts";
      const decision = await (
        subPermissionManager as unknown as {
          checkPermission: (ctx: {
            toolName: string;
            toolInput: unknown;
            permissionMode: string;
          }) => Promise<{ behavior: string; message?: string }>;
        }
      ).checkPermission({
        toolName: "Write",
        toolInput: { file_path: workdirPath, content: "test" },
        permissionMode: "dontAsk",
      });
      expect(decision).toEqual({
        behavior: "deny",
        message: expect.any(String),
      });
    });
  });

  describe("T04: Tool execution with permissionModeOverride allows matching allowedTools", () => {
    it("should allow writes to memory directory when tool matches allowedTools with dontAsk", async () => {
      const memoryDir = "/tmp/test/.wave/memory";

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
        description: "Test allowed write",
        prompt: "Test prompt",
        subagent_type: "test-subagent",
        permissionModeOverride: "dontAsk" as PermissionMode,
        allowedTools: [`Write(${memoryDir}/**/*)`],
      });

      const subContainer = (
        instance.toolManager as unknown as { container: Container }
      ).container;
      const subPermissionManager = subContainer.get("PermissionManager");

      // Check that a write to the memory directory is allowed via checkPermission
      const memoryPath = `${memoryDir}/MEMORY.md`;
      const decision = await (
        subPermissionManager as unknown as {
          checkPermission: (ctx: {
            toolName: string;
            toolInput: unknown;
            permissionMode: string;
          }) => Promise<{ behavior: string }>;
        }
      ).checkPermission({
        toolName: "Write",
        toolInput: { file_path: memoryPath, content: "test" },
        permissionMode: "dontAsk",
      });
      expect(decision).toEqual({ behavior: "allow" });
    });
  });
});
