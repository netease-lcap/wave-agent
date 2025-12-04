/**
 * Dynamic Configuration Tests
 *
 * Tests that Agent dynamically resolves configuration from environment variables
 * and that LiveConfigManager updates process.env from settings.json changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Agent } from "../../src/agent.js";
import { LiveConfigManager } from "../../src/managers/liveConfigManager.js";
import { loadMergedWaveConfig } from "../../src/services/hook.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";

// Define types for testing Agent internal methods
interface TestableAgent {
  getGatewayConfig: () => GatewayConfig;
  getModelConfig: () => ModelConfig;
  getTokenLimit: () => number;
  aiManager: {
    getGatewayConfig: () => GatewayConfig;
    getModelConfig: () => ModelConfig;
    getTokenLimit: () => number;
  };
}

interface TestableLiveConfigManager {
  updateEnvironmentFromSettings: () => void;
}

// Mock external dependencies
vi.mock("../../src/services/hook.js", () => ({
  loadMergedWaveConfig: vi.fn(),
}));

// Store original environment variables to restore later
const originalEnv = { ...process.env };

describe("Dynamic Configuration Tests", () => {
  let agent: Agent;
  let liveConfigManager: LiveConfigManager;
  const mockWorkdir = "/mock/workdir";

  beforeEach(async () => {
    // Clear environment variables that might interfere
    delete process.env.AIGW_TOKEN;
    delete process.env.AIGW_URL;
    delete process.env.AIGW_MODEL;
    delete process.env.AIGW_FAST_MODEL;
    delete process.env.TOKEN_LIMIT;
    vi.mocked(loadMergedWaveConfig).mockReturnValue(null);
  });

  afterEach(async () => {
    // Clean up agent and managers
    if (agent) {
      await agent.destroy();
    }

    // Restore original environment variables
    process.env = { ...originalEnv };

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("Environment Variable Dynamic Resolution", () => {
    it("should dynamically resolve gateway config from updated environment variables", async () => {
      // Set initial environment variables
      process.env.AIGW_TOKEN = "initial-token";
      process.env.AIGW_URL = "https://initial.url";

      // Create agent - should use initial environment values
      agent = await Agent.create({
        workdir: mockWorkdir,
      });

      // Get initial gateway config through dynamic getter
      const initialGateway = (
        agent as unknown as TestableAgent
      ).getGatewayConfig();
      expect(initialGateway.apiKey).toBe("initial-token");
      expect(initialGateway.baseURL).toBe("https://initial.url");

      // Update environment variables at runtime
      process.env.AIGW_TOKEN = "updated-token";
      process.env.AIGW_URL = "https://updated.url";

      // Get updated gateway config - should reflect new environment values
      const updatedGateway = (
        agent as unknown as TestableAgent
      ).getGatewayConfig();
      expect(updatedGateway.apiKey).toBe("updated-token");
      expect(updatedGateway.baseURL).toBe("https://updated.url");
    });

    it("should dynamically resolve model config from updated environment variables", async () => {
      // Set initial environment variables (including required token and URL)
      process.env.AIGW_TOKEN = "test-token";
      process.env.AIGW_URL = "https://test.url";
      process.env.AIGW_MODEL = "initial-agent-model";
      process.env.AIGW_FAST_MODEL = "initial-fast-model";

      // Create agent
      agent = await Agent.create({
        workdir: mockWorkdir,
      });

      // Get initial model config
      const initialModel = (agent as unknown as TestableAgent).getModelConfig();
      expect(initialModel.agentModel).toBe("initial-agent-model");
      expect(initialModel.fastModel).toBe("initial-fast-model");

      // Update environment variables
      process.env.AIGW_MODEL = "updated-agent-model";
      process.env.AIGW_FAST_MODEL = "updated-fast-model";

      // Get updated model config
      const updatedModel = (agent as unknown as TestableAgent).getModelConfig();
      expect(updatedModel.agentModel).toBe("updated-agent-model");
      expect(updatedModel.fastModel).toBe("updated-fast-model");
    });

    it("should dynamically resolve token limit from updated environment variables", async () => {
      // Set initial environment variables (including required token and URL)
      process.env.AIGW_TOKEN = "test-token";
      process.env.AIGW_URL = "https://test.url";
      process.env.TOKEN_LIMIT = "50000";

      // Create agent
      agent = await Agent.create({
        workdir: mockWorkdir,
      });

      // Get initial token limit
      const initialLimit = (
        agent as unknown as { getTokenLimit: () => number }
      ).getTokenLimit();
      expect(initialLimit).toBe(50000);

      // Update environment variable
      process.env.TOKEN_LIMIT = "75000";

      // Get updated token limit
      const updatedLimit = (
        agent as unknown as { getTokenLimit: () => number }
      ).getTokenLimit();
      expect(updatedLimit).toBe(75000);
    });
  });

  describe("LiveConfigManager Process.env Updates", () => {
    it("should update process.env when settings.json contains environment variables", async () => {
      // Mock loadMergedWaveConfig to return environment configuration
      const mockWaveConfig = {
        env: {
          AIGW_TOKEN: "settings-token",
          AIGW_URL: "https://settings.url",
          AIGW_MODEL: "settings-model",
          TOKEN_LIMIT: "60000",
        },
      };
      vi.mocked(loadMergedWaveConfig).mockReturnValue(mockWaveConfig);

      // Create LiveConfigManager
      liveConfigManager = new LiveConfigManager({
        workdir: mockWorkdir,
      });

      // Simulate configuration change by calling the private method
      (
        liveConfigManager as unknown as TestableLiveConfigManager
      ).updateEnvironmentFromSettings();

      // Verify process.env was updated
      expect(process.env.AIGW_TOKEN).toBe("settings-token");
      expect(process.env.AIGW_URL).toBe("https://settings.url");
      expect(process.env.AIGW_MODEL).toBe("settings-model");
      expect(process.env.TOKEN_LIMIT).toBe("60000");

      // Verify loadMergedWaveConfig was called with correct workdir
      expect(loadMergedWaveConfig).toHaveBeenCalledWith(mockWorkdir);
    });

    it("should handle missing environment configuration gracefully", async () => {
      // Mock loadMergedWaveConfig to return config without env
      const mockWaveConfig = {
        hooks: {
          /* some hook config */
        },
        // No env property
      };
      vi.mocked(loadMergedWaveConfig).mockReturnValue(mockWaveConfig);

      // Create LiveConfigManager
      liveConfigManager = new LiveConfigManager({
        workdir: mockWorkdir,
      });

      // Store original process.env value
      const originalToken = process.env.AIGW_TOKEN;

      // Simulate configuration change
      (
        liveConfigManager as unknown as TestableLiveConfigManager
      ).updateEnvironmentFromSettings();

      // Verify process.env was not modified
      expect(process.env.AIGW_TOKEN).toBe(originalToken);
    });

    it("should handle null/undefined wave config gracefully", async () => {
      // Mock loadMergedWaveConfig to return null
      vi.mocked(loadMergedWaveConfig).mockReturnValue(null);

      // Create LiveConfigManager
      liveConfigManager = new LiveConfigManager({
        workdir: mockWorkdir,
      });

      // This should not throw an error
      expect(() => {
        (
          liveConfigManager as unknown as TestableLiveConfigManager
        ).updateEnvironmentFromSettings();
      }).not.toThrow();
    });
  });

  describe("End-to-End Dynamic Configuration", () => {
    it("should reflect settings.json changes through LiveConfigManager and dynamic getters", async () => {
      // Set initial environment
      process.env.AIGW_TOKEN = "initial-token";
      process.env.AIGW_URL = "https://initial.url";

      // Create agent
      agent = await Agent.create({
        workdir: mockWorkdir,
      });

      // Verify initial configuration
      const initialGateway = (
        agent as unknown as TestableAgent
      ).getGatewayConfig();
      expect(initialGateway.apiKey).toBe("initial-token");
      expect(initialGateway.baseURL).toBe("https://initial.url");

      // Mock settings.json with new environment variables
      const mockWaveConfig = {
        env: {
          AIGW_TOKEN: "settings-updated-token",
          AIGW_URL: "https://settings-updated.url",
        },
      };
      vi.mocked(loadMergedWaveConfig).mockReturnValue(mockWaveConfig);

      // Create and use LiveConfigManager to update process.env
      liveConfigManager = new LiveConfigManager({
        workdir: mockWorkdir,
      });

      // Simulate settings.json change detection and process.env update
      (
        liveConfigManager as unknown as TestableLiveConfigManager
      ).updateEnvironmentFromSettings();

      // Verify agent now uses updated configuration via dynamic getters
      const updatedGateway = (
        agent as unknown as TestableAgent
      ).getGatewayConfig();
      expect(updatedGateway.apiKey).toBe("settings-updated-token");
      expect(updatedGateway.baseURL).toBe("https://settings-updated.url");
    });
  });

  describe("AIManager Dynamic Configuration", () => {
    it("should pass dynamic configuration to AIManager", async () => {
      // Set environment variables
      process.env.AIGW_TOKEN = "test-token";
      process.env.AIGW_URL = "https://test.url";
      process.env.AIGW_MODEL = "test-model";

      // Create agent
      agent = await Agent.create({
        workdir: mockWorkdir,
      });

      // Get AIManager instance
      const aiManager = (agent as unknown as TestableAgent).aiManager;

      // Verify AIManager has access to dynamic config through getters
      expect(aiManager.getGatewayConfig()).toEqual({
        apiKey: "test-token",
        baseURL: "https://test.url",
      });

      expect(aiManager.getModelConfig().agentModel).toBe("test-model");

      // Update environment variables
      process.env.AIGW_TOKEN = "updated-test-token";
      process.env.AIGW_URL = "https://updated-test.url";
      process.env.AIGW_MODEL = "updated-test-model";

      // Verify AIManager gets updated values
      expect(aiManager.getGatewayConfig().apiKey).toBe("updated-test-token");
      expect(aiManager.getGatewayConfig().baseURL).toBe(
        "https://updated-test.url",
      );
      expect(aiManager.getModelConfig().agentModel).toBe("updated-test-model");
    });
  });
});
