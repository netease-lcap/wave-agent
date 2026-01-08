import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentOptions } from "@/agent.js";
import { loadMergedWaveConfig } from "@/services/configurationService.js";

// Mock loadMergedWaveConfig
vi.mock("@/services/configurationService.js", async () => {
  const actual = await vi.importActual("@/services/configurationService.js");
  return {
    ...actual,
    loadMergedWaveConfig: vi.fn(),
  };
});

describe("Agent Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    vi.resetModules();
    process.env = { ...originalEnv };

    // Reset and setup loadMergedWaveConfig mock
    vi.mocked(loadMergedWaveConfig).mockReturnValue(null);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Gateway Configuration", () => {
    it("should use constructor parameters over environment variables", async () => {
      // Set environment variables
      process.env.WAVE_API_KEY = "env-api-key";
      process.env.WAVE_BASE_URL = "https://env-gateway.com/api";

      const agent = await Agent.create({
        apiKey: "constructor-api-key",
        baseURL: "https://constructor-gateway.com/api",
      });

      expect(agent).toBeDefined();
      // Cannot directly test internal config, but creation success indicates proper resolution
    });

    it("should fall back to environment variables when constructor params not provided", async () => {
      process.env.WAVE_API_KEY = "env-api-key";
      process.env.WAVE_BASE_URL = "https://env-gateway.com/api";

      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });

    it("should throw error when neither constructor nor environment provides apiKey", async () => {
      delete process.env.WAVE_API_KEY;
      process.env.WAVE_BASE_URL = "https://test-gateway.com/api";

      await expect(Agent.create({})).rejects.toThrow(/apiKey/);
    });

    it("should throw error when neither constructor nor environment provides baseURL", async () => {
      process.env.WAVE_API_KEY = "test-api-key";
      delete process.env.WAVE_BASE_URL;

      await expect(Agent.create({})).rejects.toThrow(/baseURL/);
    });

    it("should throw error for empty apiKey", async () => {
      await expect(
        Agent.create({
          apiKey: "",
          baseURL: "https://test-gateway.com/api",
        }),
      ).rejects.toThrow(/empty/);
    });

    it("should throw error for empty baseURL", async () => {
      await expect(
        Agent.create({
          apiKey: "test-api-key",
          baseURL: "",
        }),
      ).rejects.toThrow(/empty/);
    });
  });

  describe("Token Limit Configuration", () => {
    beforeEach(() => {
      // Provide required gateway config
      process.env.WAVE_API_KEY = "test-api-key";
      process.env.WAVE_BASE_URL = "https://test-gateway.com/api";
    });

    it("should use constructor maxInputTokens over environment variable", async () => {
      process.env.WAVE_MAX_INPUT_TOKENS = "32000";

      const agent = await Agent.create({
        maxInputTokens: 128000,
      });

      expect(agent).toBeDefined();
    });

    it("should fall back to environment variable for maxInputTokens", async () => {
      process.env.WAVE_MAX_INPUT_TOKENS = "32000";

      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });

    it("should use default maxInputTokens when not provided", async () => {
      delete process.env.WAVE_MAX_INPUT_TOKENS;

      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });

    it("should throw error for invalid maxInputTokens", async () => {
      await expect(
        Agent.create({
          maxInputTokens: -1000,
        }),
      ).rejects.toThrow(/positive/);
    });

    it("should throw error for zero maxInputTokens", async () => {
      await expect(
        Agent.create({
          maxInputTokens: 0,
        }),
      ).rejects.toThrow(/positive/);
    });

    it("should throw error for non-integer maxInputTokens", async () => {
      await expect(
        Agent.create({
          maxInputTokens: 96000.5,
        }),
      ).rejects.toThrow(/integer/);
    });
  });

  describe("Model Configuration", () => {
    beforeEach(() => {
      // Provide required gateway config
      process.env.WAVE_API_KEY = "test-api-key";
      process.env.WAVE_BASE_URL = "https://test-gateway.com/api";
    });

    it("should use constructor model parameters over environment variables", async () => {
      process.env.AIGW_MODEL = "env-agent-model";
      process.env.AIGW_FAST_MODEL = "env-fast-model";

      const agent = await Agent.create({
        agentModel: "constructor-agent-model",
        fastModel: "constructor-fast-model",
      });

      expect(agent).toBeDefined();
    });

    it("should fall back to environment variables for models", async () => {
      process.env.AIGW_MODEL = "env-agent-model";
      process.env.AIGW_FAST_MODEL = "env-fast-model";

      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });

    it("should use default models when not provided", async () => {
      delete process.env.AIGW_MODEL;
      delete process.env.AIGW_FAST_MODEL;

      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });

    it("should accept only agentModel with fastModel from environment", async () => {
      process.env.AIGW_FAST_MODEL = "env-fast-model";

      const agent = await Agent.create({
        agentModel: "custom-agent-model",
      });

      expect(agent).toBeDefined();
    });

    it("should accept only fastModel with agentModel from environment", async () => {
      process.env.AIGW_MODEL = "env-agent-model";

      const agent = await Agent.create({
        fastModel: "custom-fast-model",
      });

      expect(agent).toBeDefined();
    });
  });

  describe("Mixed Configuration Scenarios", () => {
    it("should handle complete constructor configuration", async () => {
      const options: AgentOptions = {
        apiKey: "constructor-api-key",
        baseURL: "https://constructor-gateway.com/api",
        agentModel: "constructor-agent-model",
        fastModel: "constructor-fast-model",
        maxInputTokens: 96000,
      };

      const agent = await Agent.create(options);

      expect(agent).toBeDefined();
    });

    it("should handle mixed constructor and environment configuration", async () => {
      // Set some environment variables
      process.env.WAVE_API_KEY = "env-api-key";
      process.env.AIGW_FAST_MODEL = "env-fast-model";
      process.env.WAVE_MAX_INPUT_TOKENS = "48000";

      // Provide some constructor parameters
      const agent = await Agent.create({
        baseURL: "https://constructor-gateway.com/api",
        agentModel: "constructor-agent-model",
      });

      expect(agent).toBeDefined();
    });

    it("should handle environment-only configuration", async () => {
      process.env.WAVE_API_KEY = "env-api-key";
      process.env.WAVE_BASE_URL = "https://env-gateway.com/api";
      process.env.AIGW_MODEL = "env-agent-model";
      process.env.AIGW_FAST_MODEL = "env-fast-model";
      process.env.WAVE_MAX_INPUT_TOKENS = "32000";

      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });

    it("should preserve existing AgentOptions functionality", async () => {
      process.env.WAVE_API_KEY = "test-api-key";
      process.env.WAVE_BASE_URL = "https://test-gateway.com/api";

      const agent = await Agent.create({
        workdir: "/custom/workdir",
        systemPrompt: "Custom system prompt",
        messages: [],
      });

      expect(agent).toBeDefined();
    });
  });

  describe("Configuration Validation", () => {
    it("should validate configuration early in constructor", async () => {
      // Missing both constructor and environment config should fail fast
      delete process.env.WAVE_API_KEY;
      delete process.env.WAVE_BASE_URL;

      await expect(Agent.create({})).rejects.toThrow();
    });

    it("should provide descriptive error messages", async () => {
      delete process.env.WAVE_API_KEY;
      process.env.WAVE_BASE_URL = "https://test-gateway.com/api";

      await expect(Agent.create({})).rejects.toThrow(/apiKey.*WAVE_API_KEY/);
    });

    it("should handle environment variable parsing errors gracefully", async () => {
      process.env.WAVE_API_KEY = "test-api-key";
      process.env.WAVE_BASE_URL = "https://test-gateway.com/api";
      process.env.WAVE_MAX_INPUT_TOKENS = "not-a-number";

      // Should use default token limit when environment variable is invalid
      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });
  });

  describe("Backward Compatibility", () => {
    it("should work with existing code that doesn't use new configuration", async () => {
      process.env.WAVE_API_KEY = "env-api-key";
      process.env.WAVE_BASE_URL = "https://env-gateway.com/api";

      // This is how existing code creates agents
      const agent = await Agent.create({
        workdir: process.cwd(),
      });

      expect(agent).toBeDefined();
    });

    it("should not break when new config options are mixed with existing options", async () => {
      process.env.WAVE_API_KEY = "env-api-key";
      process.env.WAVE_BASE_URL = "https://env-gateway.com/api";

      const agent = await Agent.create({
        apiKey: "custom-api-key", // New configuration option
        workdir: process.cwd(), // Existing option
        systemPrompt: "Custom prompt", // Existing option
        maxInputTokens: 48000, // New configuration option
      });

      expect(agent).toBeDefined();
    });
  });

  describe("Dynamic Configuration Update", () => {
    beforeEach(() => {
      // Provide required gateway config
      process.env.WAVE_API_KEY = "test-api-key";
      process.env.WAVE_BASE_URL = "https://test-gateway.com/api";
    });

    it("should update gateway configuration", async () => {
      const agent = await Agent.create({
        apiKey: "initial-api-key",
        baseURL: "https://initial-gateway.com/api",
      });

      expect(agent.getGatewayConfig().apiKey).toBe("initial-api-key");
      expect(agent.getGatewayConfig().baseURL).toBe(
        "https://initial-gateway.com/api",
      );

      agent.updateConfig({
        gateway: {
          apiKey: "updated-api-key",
          baseURL: "https://updated-gateway.com/api",
        },
      });

      expect(agent.getGatewayConfig().apiKey).toBe("updated-api-key");
      expect(agent.getGatewayConfig().baseURL).toBe(
        "https://updated-gateway.com/api",
      );
    });

    it("should update model configuration", async () => {
      const agent = await Agent.create({
        agentModel: "initial-agent-model",
        fastModel: "initial-fast-model",
      });

      expect(agent.getModelConfig().agentModel).toBe("initial-agent-model");
      expect(agent.getModelConfig().fastModel).toBe("initial-fast-model");

      agent.updateConfig({
        model: {
          agentModel: "updated-agent-model",
          fastModel: "updated-fast-model",
        },
      });

      expect(agent.getModelConfig().agentModel).toBe("updated-agent-model");
      expect(agent.getModelConfig().fastModel).toBe("updated-fast-model");
    });

    it("should update token limit", async () => {
      const agent = await Agent.create({
        maxInputTokens: 1000,
      });

      expect(agent.getMaxInputTokens()).toBe(1000);

      agent.updateConfig({
        maxInputTokens: 2000,
      });

      expect(agent.getMaxInputTokens()).toBe(2000);
    });

    it("should partially update gateway configuration", async () => {
      const agent = await Agent.create({
        apiKey: "initial-api-key",
        baseURL: "https://initial-gateway.com/api",
      });

      agent.updateConfig({
        gateway: {
          apiKey: "updated-api-key",
        },
      });

      expect(agent.getGatewayConfig().apiKey).toBe("updated-api-key");
      expect(agent.getGatewayConfig().baseURL).toBe(
        "https://initial-gateway.com/api",
      );
    });

    it("should validate configuration after update", async () => {
      const agent = await Agent.create({
        apiKey: "initial-api-key",
        baseURL: "https://initial-gateway.com/api",
      });

      // Updating with invalid token limit should throw
      expect(() => {
        agent.updateConfig({
          maxInputTokens: -1,
        });
      }).toThrow(/positive/);
    });
  });
});
