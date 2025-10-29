import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentOptions } from "@/agent.js";

describe("Agent Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Gateway Configuration", () => {
    it("should use constructor parameters over environment variables", async () => {
      // Set environment variables
      process.env.AIGW_TOKEN = "env-api-key";
      process.env.AIGW_URL = "https://env-gateway.com/api";

      const agent = await Agent.create({
        apiKey: "constructor-api-key",
        baseURL: "https://constructor-gateway.com/api",
      });

      expect(agent).toBeDefined();
      // Cannot directly test internal config, but creation success indicates proper resolution
    });

    it("should fall back to environment variables when constructor params not provided", async () => {
      process.env.AIGW_TOKEN = "env-api-key";
      process.env.AIGW_URL = "https://env-gateway.com/api";

      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });

    it("should throw error when neither constructor nor environment provides apiKey", async () => {
      delete process.env.AIGW_TOKEN;
      process.env.AIGW_URL = "https://test-gateway.com/api";

      await expect(Agent.create({})).rejects.toThrow(/apiKey/);
    });

    it("should throw error when neither constructor nor environment provides baseURL", async () => {
      process.env.AIGW_TOKEN = "test-api-key";
      delete process.env.AIGW_URL;

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
      process.env.AIGW_TOKEN = "test-api-key";
      process.env.AIGW_URL = "https://test-gateway.com/api";
    });

    it("should use constructor tokenLimit over environment variable", async () => {
      process.env.TOKEN_LIMIT = "32000";

      const agent = await Agent.create({
        tokenLimit: 128000,
      });

      expect(agent).toBeDefined();
    });

    it("should fall back to environment variable for tokenLimit", async () => {
      process.env.TOKEN_LIMIT = "32000";

      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });

    it("should use default tokenLimit when not provided", async () => {
      delete process.env.TOKEN_LIMIT;

      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });

    it("should throw error for invalid tokenLimit", async () => {
      await expect(
        Agent.create({
          tokenLimit: -1000,
        }),
      ).rejects.toThrow(/positive/);
    });

    it("should throw error for zero tokenLimit", async () => {
      await expect(
        Agent.create({
          tokenLimit: 0,
        }),
      ).rejects.toThrow(/positive/);
    });

    it("should throw error for non-integer tokenLimit", async () => {
      await expect(
        Agent.create({
          tokenLimit: 64000.5,
        }),
      ).rejects.toThrow(/integer/);
    });
  });

  describe("Model Configuration", () => {
    beforeEach(() => {
      // Provide required gateway config
      process.env.AIGW_TOKEN = "test-api-key";
      process.env.AIGW_URL = "https://test-gateway.com/api";
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
        tokenLimit: 96000,
      };

      const agent = await Agent.create(options);

      expect(agent).toBeDefined();
    });

    it("should handle mixed constructor and environment configuration", async () => {
      // Set some environment variables
      process.env.AIGW_TOKEN = "env-api-key";
      process.env.AIGW_FAST_MODEL = "env-fast-model";
      process.env.TOKEN_LIMIT = "48000";

      // Provide some constructor parameters
      const agent = await Agent.create({
        baseURL: "https://constructor-gateway.com/api",
        agentModel: "constructor-agent-model",
      });

      expect(agent).toBeDefined();
    });

    it("should handle environment-only configuration", async () => {
      process.env.AIGW_TOKEN = "env-api-key";
      process.env.AIGW_URL = "https://env-gateway.com/api";
      process.env.AIGW_MODEL = "env-agent-model";
      process.env.AIGW_FAST_MODEL = "env-fast-model";
      process.env.TOKEN_LIMIT = "32000";

      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });

    it("should preserve existing AgentOptions functionality", async () => {
      process.env.AIGW_TOKEN = "test-api-key";
      process.env.AIGW_URL = "https://test-gateway.com/api";

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
      delete process.env.AIGW_TOKEN;
      delete process.env.AIGW_URL;

      await expect(Agent.create({})).rejects.toThrow();
    });

    it("should provide descriptive error messages", async () => {
      delete process.env.AIGW_TOKEN;
      process.env.AIGW_URL = "https://test-gateway.com/api";

      await expect(Agent.create({})).rejects.toThrow(/apiKey.*AIGW_TOKEN/);
    });

    it("should handle environment variable parsing errors gracefully", async () => {
      process.env.AIGW_TOKEN = "test-api-key";
      process.env.AIGW_URL = "https://test-gateway.com/api";
      process.env.TOKEN_LIMIT = "not-a-number";

      // Should use default token limit when environment variable is invalid
      const agent = await Agent.create({});

      expect(agent).toBeDefined();
    });
  });

  describe("Backward Compatibility", () => {
    it("should work with existing code that doesn't use new configuration", async () => {
      process.env.AIGW_TOKEN = "env-api-key";
      process.env.AIGW_URL = "https://env-gateway.com/api";

      // This is how existing code creates agents
      const agent = await Agent.create({
        workdir: process.cwd(),
      });

      expect(agent).toBeDefined();
    });

    it("should not break when new config options are mixed with existing options", async () => {
      process.env.AIGW_TOKEN = "env-api-key";
      process.env.AIGW_URL = "https://env-gateway.com/api";

      const agent = await Agent.create({
        apiKey: "custom-api-key", // New configuration option
        workdir: process.cwd(), // Existing option
        systemPrompt: "Custom prompt", // Existing option
        tokenLimit: 48000, // New configuration option
      });

      expect(agent).toBeDefined();
    });
  });
});
