import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

// Mock dependencies
vi.mock("../../src/managers/messageManager.js");
vi.mock("../../src/managers/toolManager.js");
vi.mock("../../src/managers/aiManager.js", () => ({
  AIManager: vi.fn().mockImplementation(function () {
    return {
      sendAIMessage: vi.fn().mockResolvedValue("Test response"),
      abortAIMessage: vi.fn(),
    };
  }),
}));

describe("SubagentManager Consistency", () => {
  let subagentManager: SubagentManager;
  let mockToolManager: ToolManager;

  const builtinConfig: SubagentConfiguration = {
    name: "Explore",
    description: "Built-in exploration agent",
    systemPrompt: "Built-in system prompt",
    tools: ["Glob", "Grep", "Read"],
    model: "fastModel",
    filePath: "<builtin:Explore>",
    scope: "builtin",
    priority: 3,
  };

  const userConfig: SubagentConfiguration = {
    name: "UserAgent",
    description: "User-defined agent",
    systemPrompt: "User system prompt",
    tools: ["Read", "Write"],
    model: "inherit",
    filePath: "/home/user/.wave/agents/useragent.md",
    scope: "user",
    priority: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock ToolManager
    mockToolManager = {
      list: vi.fn(() => [
        { name: "Glob" },
        { name: "Grep" },
        { name: "Read" },
        { name: "Write" },
      ]),
      getPermissionManager: vi.fn(),
    } as unknown as ToolManager;

    // Create SubagentManager with mocks
    subagentManager = new SubagentManager({
      workdir: "/test",
      parentToolManager: mockToolManager,
      taskManager: {} as unknown as TaskManager,
      getGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      getModelConfig: () => ({
        agentModel: "claude-3-5-sonnet",
        fastModel: "claude-3-haiku",
      }),
      getMaxInputTokens: () => 200000,
      getLanguage: () => undefined,
    });

    // Mock configurations
    vi.spyOn(subagentManager, "getConfigurations").mockReturnValue([
      builtinConfig,
      userConfig,
    ]);
  });

  describe("Consistent SubagentBlock Creation", () => {
    it("should create identical SubagentInstance structure for built-in and user subagents", async () => {
      const builtinInstance = await subagentManager.createInstance(
        builtinConfig,
        {
          description: "Test builtin task",
          prompt: "Test prompt",
          subagent_type: "Explore",
        },
      );

      const userInstance = await subagentManager.createInstance(userConfig, {
        description: "Test user task",
        prompt: "Test prompt",
        subagent_type: "UserAgent",
      });

      // Both should have subagent instances with same structure
      expect(builtinInstance.status).toBe("initializing");
      expect(userInstance.status).toBe("initializing");
      expect(typeof builtinInstance.subagentId).toBe("string");
      expect(typeof userInstance.subagentId).toBe("string");

      // Both should have configuration objects
      expect(typeof builtinInstance.configuration).toBe("object");
      expect(typeof userInstance.configuration).toBe("object");
      expect(builtinInstance.configuration.name).toBe("Explore");
      expect(userInstance.configuration.name).toBe("UserAgent");
    });

    it("should handle model configuration consistently", async () => {
      const builtinInstance = await subagentManager.createInstance(
        builtinConfig,
        {
          description: "Test task",
          prompt: "Test prompt",
          subagent_type: "Explore",
        },
      );

      const userInstance = await subagentManager.createInstance(userConfig, {
        description: "Test task",
        prompt: "Test prompt",
        subagent_type: "UserAgent",
      });

      // Both instances should use the same structure for model configuration
      expect(builtinInstance.configuration).toBeDefined();
      expect(userInstance.configuration).toBeDefined();
      expect(builtinInstance.aiManager).toBeDefined();
      expect(userInstance.aiManager).toBeDefined();
    });

    it("should handle tool filtering consistently", async () => {
      const builtinInstance = await subagentManager.createInstance(
        builtinConfig,
        {
          description: "Test task",
          prompt: "Test prompt",
          subagent_type: "Explore",
        },
      );

      const userInstance = await subagentManager.createInstance(userConfig, {
        description: "Test task",
        prompt: "Test prompt",
        subagent_type: "UserAgent",
      });

      // Both should have tool configurations
      expect(builtinInstance.configuration.tools).toBeDefined();
      expect(userInstance.configuration.tools).toBeDefined();

      // Both should follow same tool filtering logic
      expect(Array.isArray(builtinInstance.configuration.tools)).toBe(true);
      expect(Array.isArray(userInstance.configuration.tools)).toBe(true);
    });

    it("should manage lifecycle identically", async () => {
      const builtinInstance = await subagentManager.createInstance(
        builtinConfig,
        {
          description: "Test task",
          prompt: "Test prompt",
          subagent_type: "Explore",
        },
      );

      const userInstance = await subagentManager.createInstance(userConfig, {
        description: "Test task",
        prompt: "Test prompt",
        subagent_type: "UserAgent",
      });

      // Both should start with same initial status
      expect(builtinInstance.status).toBe(userInstance.status);

      // Both should be manageable by same methods
      subagentManager.updateInstanceStatus(
        builtinInstance.subagentId,
        "active",
      );
      subagentManager.updateInstanceStatus(userInstance.subagentId, "active");

      expect(
        subagentManager.getInstance(builtinInstance.subagentId)?.status,
      ).toBe("active");
      expect(subagentManager.getInstance(userInstance.subagentId)?.status).toBe(
        "active",
      );
    });
  });
});
