/**
 * Subagent Dynamic Configuration Tests
 *
 * Tests that subagents inherit dynamic configuration behavior from parent Agent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Agent } from "../../src/agent.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import { loadMergedWaveConfig } from "../../src/services/configurationService.js";

// Mock loadMergedWaveConfig
vi.mock("../../src/services/configurationService.js", async () => {
  const actual = await vi.importActual(
    "../../src/services/configurationService.js",
  );
  return {
    ...actual,
    loadMergedWaveConfig: vi.fn(),
  };
});

// Define types for testing Agent internal methods
interface TestableAgent {
  subagentManager: SubagentManager;
}

describe("Subagent Dynamic Configuration Tests", () => {
  let agent: Agent;
  let subagentManager: SubagentManager;
  const mockWorkdir = "/mock/workdir";

  beforeEach(async () => {
    // Clear environment variables that might interfere
    delete process.env.WAVE_API_KEY;
    delete process.env.WAVE_BASE_URL;
    delete process.env.WAVE_MODEL;
    delete process.env.WAVE_FAST_MODEL;
    delete process.env.WAVE_MAX_INPUT_TOKENS;
    // Reset and setup loadMergedWaveConfig mock
    vi.mocked(loadMergedWaveConfig).mockReturnValue(null);
  });

  afterEach(async () => {
    // Clean up agent and managers
    if (agent) {
      await agent.destroy();
    }

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("Subagent Dynamic Configuration Inheritance", () => {
    it("should create subagent with dynamic configuration from parent Agent", async () => {
      // Set initial environment variables
      process.env.WAVE_API_KEY = "parent-token";
      process.env.WAVE_BASE_URL = "https://parent.url";
      process.env.WAVE_MODEL = "parent-model";
      process.env.WAVE_MAX_INPUT_TOKENS = "40000";

      // Create parent agent
      agent = await Agent.create({
        workdir: mockWorkdir,
      });

      // Get SubagentManager
      subagentManager = (agent as unknown as TestableAgent).subagentManager;
      await subagentManager.initialize();

      // Create test subagent configuration
      const mockConfiguration: SubagentConfiguration = {
        name: "test-subagent",
        description: "Test subagent for dynamic config",
        systemPrompt: "You are a test subagent.",
        model: "inherit",
        tools: ["Read", "Write"],
        filePath: "/mock/path/test-subagent.md",
        scope: "project",
        priority: 1,
      };

      // Create subagent instance
      const subagentInstance = await subagentManager.createInstance(
        mockConfiguration,
        {
          description: "Testing dynamic config",
          prompt: "Test prompt",
          subagent_type: "test-subagent",
        },
      );

      // Verify subagent AIManager has access to parent's dynamic configuration
      const subagentAIManager = subagentInstance.aiManager;

      // Check initial configuration
      expect(subagentAIManager.getGatewayConfig()).toMatchObject({
        apiKey: "parent-token",
        baseURL: "https://parent.url",
      });

      expect(subagentAIManager.getModelConfig().agentModel).toBe(
        "parent-model",
      );
      expect(subagentAIManager.getMaxInputTokens()).toBe(40000);

      // Update parent environment variables
      process.env.WAVE_API_KEY = "updated-parent-token";
      process.env.WAVE_BASE_URL = "https://updated-parent.url";
      process.env.WAVE_MODEL = "updated-parent-model";
      process.env.WAVE_MAX_INPUT_TOKENS = "50000";

      // Verify subagent AIManager gets updated values through parent's dynamic getters
      expect(subagentAIManager.getGatewayConfig()).toMatchObject({
        apiKey: "updated-parent-token",
        baseURL: "https://updated-parent.url",
      });

      expect(subagentAIManager.getModelConfig().agentModel).toBe(
        "updated-parent-model",
      );
      expect(subagentAIManager.getMaxInputTokens()).toBe(50000);
    });

    it("should handle subagent-specific model override with dynamic configuration", async () => {
      // Set parent environment variables
      process.env.WAVE_API_KEY = "parent-token";
      process.env.WAVE_BASE_URL = "https://parent.url";
      process.env.WAVE_MODEL = "parent-model";
      process.env.WAVE_FAST_MODEL = "parent-fast-model";

      // Create parent agent
      agent = await Agent.create({
        workdir: mockWorkdir,
      });

      // Get SubagentManager
      subagentManager = (agent as unknown as TestableAgent).subagentManager;
      await subagentManager.initialize();

      // Create subagent configuration with specific model override
      const mockConfiguration: SubagentConfiguration = {
        name: "test-subagent-override",
        description: "Test subagent with model override",
        systemPrompt: "You are a test subagent with model override.",
        model: "specific-subagent-model", // Override parent model
        tools: ["Read"],
        filePath: "/mock/path/test-subagent-override.md",
        scope: "project",
        priority: 1,
      };

      // Create subagent instance
      const subagentInstance = await subagentManager.createInstance(
        mockConfiguration,
        {
          description: "Testing model override",
          prompt: "Test prompt",
          subagent_type: "test-subagent-override",
        },
      );

      // Verify subagent uses override model but inherits other dynamic config
      const subagentAIManager = subagentInstance.aiManager;

      // Should inherit dynamic gateway config from parent
      expect(subagentAIManager.getGatewayConfig()).toMatchObject({
        apiKey: "parent-token",
        baseURL: "https://parent.url",
      });

      // Should use override model, but inherit fastModel from parent
      const modelConfig = subagentAIManager.getModelConfig();
      expect(modelConfig.agentModel).toBe("specific-subagent-model");
      expect(modelConfig.fastModel).toBe("parent-fast-model");

      // Should inherit token limit from parent (using default since not specified)
      expect(subagentAIManager.getMaxInputTokens()).toBe(96000); // Default value

      // Update parent environment variables
      process.env.WAVE_API_KEY = "updated-parent-token";
      process.env.WAVE_FAST_MODEL = "updated-parent-fast-model";

      // Verify subagent still uses override model but gets updated inherited values
      const updatedModelConfig = subagentAIManager.getModelConfig();
      expect(updatedModelConfig.agentModel).toBe("specific-subagent-model"); // Still overridden
      expect(updatedModelConfig.fastModel).toBe("updated-parent-fast-model"); // Inherited dynamically

      expect(subagentAIManager.getGatewayConfig().apiKey).toBe(
        "updated-parent-token",
      );
    });

    it("should handle multiple subagents with dynamic configuration", async () => {
      // Set initial environment variables
      process.env.WAVE_API_KEY = "multi-token";
      process.env.WAVE_BASE_URL = "https://multi.url";
      process.env.WAVE_MODEL = "multi-model";

      // Create parent agent
      agent = await Agent.create({
        workdir: mockWorkdir,
      });

      // Get SubagentManager
      subagentManager = (agent as unknown as TestableAgent).subagentManager;
      await subagentManager.initialize();

      // Create multiple subagent configurations
      const config1: SubagentConfiguration = {
        name: "subagent-1",
        description: "First subagent",
        systemPrompt: "You are subagent 1.",
        model: "inherit",
        tools: ["Read"],
        filePath: "/mock/path/subagent-1.md",
        scope: "project",
        priority: 1,
      };

      const config2: SubagentConfiguration = {
        name: "subagent-2",
        description: "Second subagent",
        systemPrompt: "You are subagent 2.",
        model: "custom-model",
        tools: ["Write"],
        filePath: "/mock/path/subagent-2.md",
        scope: "project",
        priority: 2,
      };

      // Create subagent instances
      const subagent1 = await subagentManager.createInstance(config1, {
        description: "First instance",
        prompt: "Test 1",
        subagent_type: "subagent-1",
      });

      const subagent2 = await subagentManager.createInstance(config2, {
        description: "Second instance",
        prompt: "Test 2",
        subagent_type: "subagent-2",
      });

      // Verify both subagents have access to parent's dynamic configuration
      expect(subagent1.aiManager.getGatewayConfig().apiKey).toBe("multi-token");
      expect(subagent2.aiManager.getGatewayConfig().apiKey).toBe("multi-token");

      expect(subagent1.aiManager.getModelConfig().agentModel).toBe(
        "multi-model",
      );
      expect(subagent2.aiManager.getModelConfig().agentModel).toBe(
        "custom-model",
      );

      // Update environment
      process.env.WAVE_API_KEY = "multi-updated-token";
      process.env.WAVE_MODEL = "multi-updated-model";

      // Verify both subagents get updated values
      expect(subagent1.aiManager.getGatewayConfig().apiKey).toBe(
        "multi-updated-token",
      );
      expect(subagent2.aiManager.getGatewayConfig().apiKey).toBe(
        "multi-updated-token",
      );

      expect(subagent1.aiManager.getModelConfig().agentModel).toBe(
        "multi-updated-model",
      );
      expect(subagent2.aiManager.getModelConfig().agentModel).toBe(
        "custom-model",
      ); // Still overridden
    });
  });
});
