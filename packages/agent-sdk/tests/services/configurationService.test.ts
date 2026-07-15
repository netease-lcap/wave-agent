import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { existsSync, readFileSync } from "fs";

// Mock fs module for some tests that use sync methods
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import {
  ConfigurationService,
  validateEnvironmentConfig,
  mergeEnvironmentConfig,
  loadMergedWaveConfig,
  loadWaveConfigFromFile,
} from "../../src/services/configurationService.js";
import { atomicWriteFile } from "../../src/utils/atomicWrite.js";
import {
  DEFAULT_WAVE_MAX_OUTPUT_TOKENS,
  DEFAULT_WAVE_MAX_INPUT_TOKENS,
} from "../../src/utils/constants.js";
import type { WaveConfiguration } from "../../src/types/configuration.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe("ConfigurationService", () => {
  let tempDir: string;
  let userHome: string;
  let configService: ConfigurationService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-config-test-"));
    userHome = await fs.mkdtemp(path.join(os.tmpdir(), "wave-user-home-"));

    vi.mocked(os.homedir).mockReturnValue(userHome);
    configService = new ConfigurationService();

    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(userHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("loadMergedConfiguration", () => {
    it("should load and merge user and project configurations", async () => {
      const userConfig = {
        env: { USER_VAR: "user" },
        permissions: { allow: ["rule1"] },
      };
      const projectConfig = {
        env: { PROJECT_VAR: "project" },
        permissions: { allow: ["rule2"] },
      };

      mockExistsSync.mockImplementation((p) => {
        const pathStr = p.toString();
        return (
          pathStr.includes(path.join(userHome, ".wave", "settings.json")) ||
          pathStr.includes(path.join(tempDir, ".wave", "settings.json"))
        );
      });

      mockReadFileSync.mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes(userHome)) return JSON.stringify(userConfig);
        if (pathStr.includes(tempDir)) return JSON.stringify(projectConfig);
        return "";
      });

      const result = await configService.loadMergedConfiguration(tempDir);

      expect(result.success).toBe(true);
      expect(result.configuration?.env).toEqual({
        USER_VAR: "user",
        PROJECT_VAR: "project",
        WAVE_PROJECT_DIR: tempDir,
      });
      expect(result.configuration?.permissions?.allow).toContain("rule1");
      expect(result.configuration?.permissions?.allow).toContain("rule2");
      expect(process.env.USER_VAR).toBe("user");
      expect(process.env.PROJECT_VAR).toBe("project");
      expect(process.env.WAVE_PROJECT_DIR).toBe(tempDir);
    });

    it("should merge deny rules from all sources", async () => {
      const userConfig = {
        permissions: { deny: ["rule1"] },
      };
      const projectConfig = {
        permissions: { deny: ["rule2"] },
      };

      mockExistsSync.mockImplementation((p) => {
        const pathStr = p.toString();
        return (
          pathStr.includes(path.join(userHome, ".wave", "settings.json")) ||
          pathStr.includes(path.join(tempDir, ".wave", "settings.json"))
        );
      });

      mockReadFileSync.mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes(userHome)) return JSON.stringify(userConfig);
        if (pathStr.includes(tempDir)) return JSON.stringify(projectConfig);
        return "";
      });

      const result = await configService.loadMergedConfiguration(tempDir);

      expect(result.success).toBe(true);
      expect(result.configuration?.permissions?.deny).toContain("rule1");
      expect(result.configuration?.permissions?.deny).toContain("rule2");
    });

    it("should handle no configuration files found", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await configService.loadMergedConfiguration(tempDir);

      expect(result.success).toBe(true);
      expect(result.configuration).toEqual({
        env: { WAVE_PROJECT_DIR: tempDir },
      });
      expect(result.warnings).toContain(
        "No configuration files found in user or project directories",
      );
    });

    it("should return error on invalid configuration", async () => {
      const invalidConfig = {
        permissions: {
          permissionMode: "invalid-mode",
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidConfig));

      const result = await configService.loadMergedConfiguration(tempDir);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Merged configuration validation failed");
    });
  });

  describe("loadMergedWaveConfig", () => {
    it("should correctly merge all 3 configuration files in priority order", async () => {
      const userSettingsPath = path.join(userHome, ".wave", "settings.json");
      const projectSettingsPath = path.join(tempDir, ".wave", "settings.json");
      const localConfigPath = path.join(
        tempDir,
        ".wave",
        "settings.local.json",
      );

      const userSettings = {
        enabledPlugins: { "plugin1@market": true, "plugin2@market": true },
        hooks: { PreToolUse: [{ matcher: "user", hooks: [] }] },
        env: { VAR1: "user", VAR2: "user" },
        permissions: { allow: ["rule-user"], permissionMode: "default" },
        models: {
          model1: { temperature: 0.1, maxTokens: 500 },
          model2: { temperature: 0.2 },
        },
      };

      const projectSettings = {
        enabledPlugins: { "plugin2@market": false, "plugin3@market": true },
        hooks: { PreToolUse: [{ matcher: "project", hooks: [] }] },
        env: { VAR2: "project", VAR3: "project" },
        permissions: { allow: ["rule-project"], permissionMode: "acceptEdits" },
        models: {
          model1: { temperature: 0.5, maxTokens: 1000 },
          model2: { temperature: 0.8 },
        },
      };

      const localSettings = {
        enabledPlugins: { "plugin3@market": false, "plugin4@market": true },
        hooks: { PreToolUse: [{ matcher: "local", hooks: [] }] },
        env: { VAR3: "local", VAR4: "local" },
        permissions: {
          allow: ["rule-local"],
          permissionMode: "bypassPermissions",
        },
        models: {
          model2: { reasoning_effort: "high" },
        },
      };

      mockExistsSync.mockImplementation((p) => {
        const pathStr = p.toString();
        return [userSettingsPath, projectSettingsPath, localConfigPath].some(
          (expected) => pathStr.includes(expected),
        );
      });

      mockReadFileSync.mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes(userSettingsPath))
          return JSON.stringify(userSettings);
        if (pathStr.includes(projectSettingsPath))
          return JSON.stringify(projectSettings);
        if (pathStr.includes(localConfigPath))
          return JSON.stringify(localSettings);
        return "";
      });

      const result = loadMergedWaveConfig(tempDir);

      expect(result).not.toBeNull();

      // Verify enabledPlugins (merged with precedence)
      expect(result?.enabledPlugins).toEqual({
        "plugin1@market": true,
        "plugin2@market": false, // from projectSettings
        "plugin3@market": false, // from localSettings
        "plugin4@market": true, // from localSettings
      });

      // Verify hooks (combined)
      expect(result?.hooks?.PreToolUse).toHaveLength(3);
      expect(result?.hooks?.PreToolUse?.[0].matcher).toBe("user");
      expect(result?.hooks?.PreToolUse?.[1].matcher).toBe("project");
      expect(result?.hooks?.PreToolUse?.[2].matcher).toBe("local");

      // Verify env (merged with precedence)
      expect(result?.env).toEqual({
        VAR1: "user",
        VAR2: "project",
        VAR3: "local",
        VAR4: "local",
      });

      // Verify permissionMode (highest priority wins)
      expect(result?.permissions?.permissionMode).toBe("bypassPermissions"); // from localSettings

      // Verify permissions.allow (combined)
      expect(result?.permissions?.allow).toEqual(
        expect.arrayContaining(["rule-user", "rule-project", "rule-local"]),
      );
      expect(result?.permissions?.allow).toHaveLength(3);

      // Verify models (merged with precedence)
      expect(result?.models?.["model1"]).toEqual({
        temperature: 0.5,
        maxTokens: 1000,
      });
      expect(result?.models?.["model2"]).toEqual({
        temperature: 0.8,
        reasoning_effort: "high",
      });
    });
  });

  describe("validateConfiguration", () => {
    it("should validate a correct configuration", () => {
      const config = {
        hooks: {
          PreToolUse: [
            {
              matcher: "test",
              hooks: [{ type: "command" as const, command: "echo" }],
            },
          ],
        },
        env: { VAR: "val" },
        permissions: {
          allow: ["rule"],
          permissionMode: "bypassPermissions" as const,
        },
      };

      const result = configService.validateConfiguration(config);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate "plan" as a valid permissionMode', () => {
      const config = {
        permissions: {
          permissionMode: "plan" as const,
        },
      };

      const result = configService.validateConfiguration(config);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should catch invalid hook event", () => {
      const config = {
        hooks: {
          InvalidEvent: [
            { hooks: [{ type: "command" as const, command: "echo" }] },
          ],
        },
      } as unknown as WaveConfiguration;

      const result = configService.validateConfiguration(config);
      expect(result.isValid).toBe(true); // Unknown events are warnings
      expect(result.warnings).toContain("Unknown hook event: InvalidEvent");
    });

    it("should catch invalid permissionMode", () => {
      const config = {
        permissions: {
          permissionMode: "invalid" as unknown as "bypassPermissions",
        },
      };

      const result = configService.validateConfiguration(config);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("Invalid permissionMode");
    });

    it("should catch invalid permissions", () => {
      const config = {
        permissions: { allow: "not an array" } as unknown as {
          allow: string[];
        },
      };

      const result = configService.validateConfiguration(config);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Permissions allow must be an array of strings",
      );
    });
  });

  describe("validateConfigurationFile", () => {
    it("should return error if file does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      const result =
        configService.validateConfigurationFile("nonexistent.json");
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("Configuration file not found");
    });

    it("should return error on invalid JSON", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("invalid json");
      const result = configService.validateConfigurationFile("file.json");
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("Invalid JSON syntax");
    });
  });

  describe("Environment Variable Management", () => {
    it("should set environment variables to process.env", () => {
      const env = { KEY: "VALUE" };
      configService.setEnvironmentVars(env);
      expect(process.env.KEY).toBe("VALUE");
    });
  });

  describe("resolveGatewayConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.WAVE_API_KEY;
      delete process.env.WAVE_BASE_URL;
      delete process.env.WAVE_CUSTOM_HEADERS;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should resolve from constructor args", () => {
      const config = configService.resolveGatewayConfig(
        "key",
        "http://base.com",
      );
      expect(config.apiKey).toBe("key");
      expect(config.baseURL).toBe("http://base.com");
    });

    it("should resolve from internal env", () => {
      configService.setEnvironmentVars({
        WAVE_API_KEY: "env-key",
        WAVE_BASE_URL: "http://env-base.com",
      });
      const config = configService.resolveGatewayConfig();
      expect(config.apiKey).toBe("env-key");
      expect(config.baseURL).toBe("http://env-base.com");
    });

    it("should allow missing baseURL", () => {
      const config = configService.resolveGatewayConfig();
      expect(config.baseURL).toBeUndefined();
    });

    it("should parse custom headers from env", () => {
      configService.setEnvironmentVars({
        WAVE_BASE_URL: "http://base.com",
        WAVE_CUSTOM_HEADERS: "X-Header: value\nY-Header: value2",
      });
      const config = configService.resolveGatewayConfig();
      expect(config.defaultHeaders).toEqual({
        "X-Header": "value",
        "Y-Header": "value2",
      });
    });
  });

  describe("resolveModelConfig", () => {
    it("should resolve with defaults from environment", () => {
      const config = configService.resolveModelConfig();
      const expectedAgentModel = process.env.WAVE_MODEL;
      const expectedFastModel = process.env.WAVE_FAST_MODEL;
      const expectedMaxTokens = process.env.WAVE_MAX_OUTPUT_TOKENS
        ? parseInt(process.env.WAVE_MAX_OUTPUT_TOKENS, 10)
        : DEFAULT_WAVE_MAX_OUTPUT_TOKENS;
      expect(config.model).toBe(expectedAgentModel);
      expect(config.fastModel).toBe(expectedFastModel);
      expect(config.maxTokens).toBe(expectedMaxTokens);
    });

    it("should return undefined model/fastModel when not configured", () => {
      const originalModel = process.env.WAVE_MODEL;
      const originalFastModel = process.env.WAVE_FAST_MODEL;
      delete process.env.WAVE_MODEL;
      delete process.env.WAVE_FAST_MODEL;
      try {
        const config = configService.resolveModelConfig();
        expect(config.model).toBeUndefined();
        expect(config.fastModel).toBeUndefined();
      } finally {
        process.env.WAVE_MODEL = originalModel;
        process.env.WAVE_FAST_MODEL = originalFastModel;
      }
    });

    it("should resolve from internal env", () => {
      configService.setEnvironmentVars({
        WAVE_MODEL: "custom-agent",
        WAVE_FAST_MODEL: "custom-fast",
        WAVE_MAX_OUTPUT_TOKENS: "1000",
      });
      const config = configService.resolveModelConfig();
      expect(config.model).toBe("custom-agent");
      expect(config.fastModel).toBe("custom-fast");
      expect(config.maxTokens).toBe(1000);
    });

    it("should merge model-specific settings from configuration", async () => {
      const config = {
        models: {
          "gpt-4o": {
            temperature: 0.5,
            reasoning_effort: "high",
          },
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      await configService.loadMergedConfiguration(tempDir);
      const resolved = configService.resolveModelConfig("gpt-4o");

      expect(resolved.model).toBe("gpt-4o");
      expect(resolved.temperature).toBe(0.5);
      expect(resolved.reasoning_effort).toBe("high");
    });
  });

  describe("resolveModelConfig — fastModelConfig", () => {
    it("should set fastModelConfig from models[fastModel] hyperparams", async () => {
      const config = {
        models: {
          "gpt-4o": { temperature: 0.7 },
          "gpt-4o-mini": { temperature: 0.2, top_p: 0.9 },
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      const origFastModel = process.env.WAVE_FAST_MODEL;
      delete process.env.WAVE_MODEL;
      delete process.env.WAVE_FAST_MODEL;
      try {
        await configService.loadMergedConfiguration(tempDir);
        const resolved = configService.resolveModelConfig(
          "gpt-4o",
          "gpt-4o-mini",
        );

        expect(resolved.fastModelConfig).toEqual({
          temperature: 0.2,
          top_p: 0.9,
        });
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
        else delete process.env.WAVE_MODEL;
        if (origFastModel !== undefined)
          process.env.WAVE_FAST_MODEL = origFastModel;
        else delete process.env.WAVE_FAST_MODEL;
      }
    });

    it("should strip structural fields from fastModelConfig", async () => {
      const config = {
        models: {
          "gpt-4o-mini": {
            model: "should-be-stripped",
            fastModel: "should-be-stripped",
            maxTokens: 999,
            permissionMode: "default",
            temperature: 0.3,
          },
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      const origFastModel = process.env.WAVE_FAST_MODEL;
      delete process.env.WAVE_MODEL;
      delete process.env.WAVE_FAST_MODEL;
      try {
        await configService.loadMergedConfiguration(tempDir);
        const resolved = configService.resolveModelConfig(
          undefined,
          "gpt-4o-mini",
        );

        expect(resolved.fastModelConfig).toEqual({ temperature: 0.3 });
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
        else delete process.env.WAVE_MODEL;
        if (origFastModel !== undefined)
          process.env.WAVE_FAST_MODEL = origFastModel;
        else delete process.env.WAVE_FAST_MODEL;
      }
    });

    it("should leave fastModelConfig undefined when fast model not in models", async () => {
      const config = {
        models: {
          "gpt-4o": { temperature: 0.7 },
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      const origFastModel = process.env.WAVE_FAST_MODEL;
      delete process.env.WAVE_MODEL;
      delete process.env.WAVE_FAST_MODEL;
      try {
        await configService.loadMergedConfiguration(tempDir);
        const resolved = configService.resolveModelConfig(
          "gpt-4o",
          "unknown-fast-model",
        );

        expect(resolved.fastModelConfig).toBeUndefined();
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
        else delete process.env.WAVE_MODEL;
        if (origFastModel !== undefined)
          process.env.WAVE_FAST_MODEL = origFastModel;
        else delete process.env.WAVE_FAST_MODEL;
      }
    });

    it("should leave fastModelConfig undefined when no fast model configured", async () => {
      const config = {
        models: {
          "gpt-4o": { temperature: 0.7 },
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      const origFastModel = process.env.WAVE_FAST_MODEL;
      delete process.env.WAVE_MODEL;
      delete process.env.WAVE_FAST_MODEL;
      try {
        await configService.loadMergedConfiguration(tempDir);
        const resolved = configService.resolveModelConfig("gpt-4o");

        expect(resolved.fastModelConfig).toBeUndefined();
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
        else delete process.env.WAVE_MODEL;
        if (origFastModel !== undefined)
          process.env.WAVE_FAST_MODEL = origFastModel;
        else delete process.env.WAVE_FAST_MODEL;
      }
    });
  });

  describe("resolveModelConfig — capabilities", () => {
    it("should merge capabilities from models[modelName] into resolved config", async () => {
      const config = {
        models: {
          "claude-sonnet-4": {
            capabilities: { promptCaching: true, vision: true },
          },
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      const origFastModel = process.env.WAVE_FAST_MODEL;
      delete process.env.WAVE_MODEL;
      delete process.env.WAVE_FAST_MODEL;
      try {
        await configService.loadMergedConfiguration(tempDir);
        const resolved = configService.resolveModelConfig("claude-sonnet-4");

        expect(resolved.capabilities).toEqual({
          promptCaching: true,
          vision: true,
        });
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
        else delete process.env.WAVE_MODEL;
        if (origFastModel !== undefined)
          process.env.WAVE_FAST_MODEL = origFastModel;
        else delete process.env.WAVE_FAST_MODEL;
      }
    });

    it("should strip capabilities from fastModelConfig extraction", async () => {
      const config = {
        models: {
          "gpt-4o": { capabilities: { promptCaching: true } },
          "gpt-4o-mini": {
            capabilities: { vision: false },
            temperature: 0.2,
          },
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      const origFastModel = process.env.WAVE_FAST_MODEL;
      delete process.env.WAVE_MODEL;
      delete process.env.WAVE_FAST_MODEL;
      try {
        await configService.loadMergedConfiguration(tempDir);
        const resolved = configService.resolveModelConfig(
          "gpt-4o",
          "gpt-4o-mini",
        );

        // capabilities should NOT leak into fastModelConfig
        expect(resolved.fastModelConfig).toEqual({ temperature: 0.2 });
        expect(resolved.fastModelConfig).not.toHaveProperty("capabilities");
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
        else delete process.env.WAVE_MODEL;
        if (origFastModel !== undefined)
          process.env.WAVE_FAST_MODEL = origFastModel;
        else delete process.env.WAVE_FAST_MODEL;
      }
    });
  });

  describe("resolveMaxInputTokens", () => {
    const originalEnv = process.env.WAVE_MAX_INPUT_TOKENS;

    beforeEach(() => {
      delete process.env.WAVE_MAX_INPUT_TOKENS;
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.WAVE_MAX_INPUT_TOKENS = originalEnv;
      }
    });

    it("should return default", () => {
      expect(configService.resolveMaxInputTokens()).toBe(
        DEFAULT_WAVE_MAX_INPUT_TOKENS,
      );
    });

    it("should resolve from internal env", () => {
      configService.setEnvironmentVars({ WAVE_MAX_INPUT_TOKENS: "5000" });
      expect(configService.resolveMaxInputTokens()).toBe(5000);
    });
  });

  describe("resolveLanguage", () => {
    it("should return undefined by default", () => {
      expect(configService.resolveLanguage()).toBeUndefined();
    });

    it("should resolve from constructor", () => {
      expect(configService.resolveLanguage("Spanish")).toBe("Spanish");
    });

    it("should resolve from current configuration", async () => {
      const config = { language: "French" };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      await configService.loadMergedConfiguration(tempDir);
      expect(configService.resolveLanguage()).toBe("French");
    });

    it("should prioritize constructor over configuration", async () => {
      const config = { language: "French" };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      await configService.loadMergedConfiguration(tempDir);
      expect(configService.resolveLanguage("Spanish")).toBe("Spanish");
    });
  });

  describe("validateEnvironmentConfig", () => {
    it("should validate correct env", () => {
      const result = validateEnvironmentConfig({ KEY: "VAL" });
      expect(result.isValid).toBe(true);
    });

    it("should warn on non-standard naming", () => {
      const result = validateEnvironmentConfig({ "key-with-dash": "val" });
      expect(result.isValid).toBe(true);
      expect(result.warnings[0]).toContain(
        "does not follow standard naming convention",
      );
    });

    it("should warn on empty value", () => {
      const result = validateEnvironmentConfig({ KEY: "" });
      expect(result.isValid).toBe(true);
      expect(result.warnings[0]).toContain("has an empty value");
    });

    it("should warn on reserved names", () => {
      const result = validateEnvironmentConfig({ PATH: "/usr/bin" });
      expect(result.isValid).toBe(true);
      expect(result.warnings[0]).toContain("overrides a system variable");
    });
  });

  describe("mergeEnvironmentConfig", () => {
    it("should merge and detect conflicts", () => {
      const userEnv = { VAR1: "user1", VAR2: "user2" };
      const projectEnv = { VAR2: "project2", VAR3: "project3" };
      const result = mergeEnvironmentConfig(userEnv, projectEnv);

      expect(result.mergedVars).toEqual({
        VAR1: "user1",
        VAR2: "project2",
        VAR3: "project3",
      });
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe("VAR2");
    });
  });

  describe("Model Selection", () => {
    it("should set model in options", () => {
      configService.setModel("new-model");
      const config = configService.resolveModelConfig();
      expect(config.model).toBe("new-model");
    });

    it("should get configured models including current", () => {
      configService.setEnvironmentVars({ WAVE_MODEL: "env-model" });
      const models = configService.getConfiguredModels();
      expect(models).not.toContain("gemini-3-flash");
      expect(models).toContain("env-model");
    });

    it("should get models from configuration", async () => {
      const config = {
        models: {
          "model-a": {},
          "model-b": {},
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      await configService.loadMergedConfiguration(tempDir);
      const models = configService.getConfiguredModels();

      expect(models).toContain("model-a");
      expect(models).toContain("model-b");
      expect(models).not.toContain("gemini-3-flash");
    });

    it("should include currentConfiguration.model in getConfiguredModels", async () => {
      const config = { model: "persisted-model" };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      delete process.env.WAVE_MODEL;
      try {
        await configService.loadMergedConfiguration(tempDir);
        const models = configService.getConfiguredModels();
        expect(models).toContain("persisted-model");
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
      }
    });
  });

  describe("resolveModelConfig — model priority", () => {
    it("should fall back to currentConfiguration.model when no param, options, or env var", async () => {
      const config = { model: "config-model" };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      const origFastModel = process.env.WAVE_FAST_MODEL;
      delete process.env.WAVE_MODEL;
      process.env.WAVE_FAST_MODEL = "fast-model";
      try {
        await configService.loadMergedConfiguration(tempDir);
        configService.setOptions({}); // no options.model
        const resolved = configService.resolveModelConfig();
        expect(resolved.model).toBe("config-model");
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
        else delete process.env.WAVE_MODEL;
        if (origFastModel !== undefined)
          process.env.WAVE_FAST_MODEL = origFastModel;
        else delete process.env.WAVE_FAST_MODEL;
      }
    });

    it("should prioritize options.model over WAVE_MODEL env var and currentConfiguration.model", async () => {
      const config = { model: "config-model" };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      const origFastModel = process.env.WAVE_FAST_MODEL;
      process.env.WAVE_MODEL = "env-model";
      process.env.WAVE_FAST_MODEL = "fast-model";
      try {
        await configService.loadMergedConfiguration(tempDir);
        configService.setOptions({ model: "options-model" });
        const resolved = configService.resolveModelConfig();
        expect(resolved.model).toBe("options-model");
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
        else delete process.env.WAVE_MODEL;
        if (origFastModel !== undefined)
          process.env.WAVE_FAST_MODEL = origFastModel;
        else delete process.env.WAVE_FAST_MODEL;
      }
    });

    it("should prioritize currentConfiguration.model over WAVE_MODEL env var", async () => {
      const config = { model: "config-model" };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      const origFastModel = process.env.WAVE_FAST_MODEL;
      process.env.WAVE_MODEL = "env-model";
      process.env.WAVE_FAST_MODEL = "fast-model";
      try {
        await configService.loadMergedConfiguration(tempDir);
        configService.setOptions({}); // no options.model
        const resolved = configService.resolveModelConfig();
        expect(resolved.model).toBe("config-model");
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
        else delete process.env.WAVE_MODEL;
        if (origFastModel !== undefined)
          process.env.WAVE_FAST_MODEL = origFastModel;
        else delete process.env.WAVE_FAST_MODEL;
      }
    });

    it("should prioritize model param over options.model, env var, and currentConfiguration.model", async () => {
      const config = { model: "config-model" };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const origModel = process.env.WAVE_MODEL;
      const origFastModel = process.env.WAVE_FAST_MODEL;
      process.env.WAVE_MODEL = "env-model";
      process.env.WAVE_FAST_MODEL = "fast-model";
      try {
        await configService.loadMergedConfiguration(tempDir);
        configService.setOptions({ model: "options-model" });
        const resolved = configService.resolveModelConfig("param-model");
        expect(resolved.model).toBe("param-model");
      } finally {
        if (origModel !== undefined) process.env.WAVE_MODEL = origModel;
        else delete process.env.WAVE_MODEL;
        if (origFastModel !== undefined)
          process.env.WAVE_FAST_MODEL = origFastModel;
        else delete process.env.WAVE_FAST_MODEL;
      }
    });
  });

  describe("loadMergedWaveConfig — model field", () => {
    it("should merge model field with last-write-wins", async () => {
      const userSettingsPath = path.join(userHome, ".wave", "settings.json");
      const projectSettingsPath = path.join(tempDir, ".wave", "settings.json");

      const userSettings = { model: "user-model" };
      const projectSettings = { model: "project-model" };

      mockExistsSync.mockImplementation((p) => {
        const pathStr = p.toString();
        return [userSettingsPath, projectSettingsPath].some((expected) =>
          pathStr.includes(expected),
        );
      });

      mockReadFileSync.mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes(userSettingsPath))
          return JSON.stringify(userSettings);
        if (pathStr.includes(projectSettingsPath))
          return JSON.stringify(projectSettings);
        return "";
      });

      const result = loadMergedWaveConfig(tempDir);
      expect(result?.model).toBe("project-model");
    });

    it("should use user model when project has no model", async () => {
      const userSettingsPath = path.join(userHome, ".wave", "settings.json");
      const projectSettingsPath = path.join(tempDir, ".wave", "settings.json");

      const userSettings = { model: "user-model" };
      const projectSettings = {};

      mockExistsSync.mockImplementation((p) => {
        const pathStr = p.toString();
        return [userSettingsPath, projectSettingsPath].some((expected) =>
          pathStr.includes(expected),
        );
      });

      mockReadFileSync.mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes(userSettingsPath))
          return JSON.stringify(userSettings);
        if (pathStr.includes(projectSettingsPath))
          return JSON.stringify(projectSettings);
        return "";
      });

      const result = loadMergedWaveConfig(tempDir);
      expect(result?.model).toBe("user-model");
    });
  });

  describe("loadWaveConfigFromFile — read tolerance", () => {
    it("should return null for empty file (not throw)", () => {
      const configPath = path.join(tempDir, "settings.json");
      mockExistsSync.mockImplementation((p) => p.toString() === configPath);
      mockReadFileSync.mockReturnValue("");

      expect(() => loadWaveConfigFromFile(configPath)).not.toThrow();
      expect(loadWaveConfigFromFile(configPath)).toBeNull();
    });

    it("should return null for whitespace-only file (not throw)", () => {
      const configPath = path.join(tempDir, "settings.json");
      mockExistsSync.mockImplementation((p) => p.toString() === configPath);
      mockReadFileSync.mockReturnValue("   \n\t  ");

      expect(() => loadWaveConfigFromFile(configPath)).not.toThrow();
      expect(loadWaveConfigFromFile(configPath)).toBeNull();
    });

    it("should return null for corrupted JSON (not throw)", () => {
      const configPath = path.join(tempDir, "settings.json");
      mockExistsSync.mockImplementation((p) => p.toString() === configPath);
      mockReadFileSync.mockReturnValue('{"model": "test"');

      expect(() => loadWaveConfigFromFile(configPath)).not.toThrow();
      expect(loadWaveConfigFromFile(configPath)).toBeNull();
    });

    it("should still return config for valid JSON", () => {
      const configPath = path.join(tempDir, "settings.json");
      mockExistsSync.mockImplementation((p) => p.toString() === configPath);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ model: "valid-model" }),
      );

      const result = loadWaveConfigFromFile(configPath);
      expect(result).not.toBeNull();
      expect(result?.model).toBe("valid-model");
    });
  });

  describe("atomicWriteFile", () => {
    it("should write file content correctly", async () => {
      const filePath = path.join(tempDir, "test-atomic.json");
      const data = JSON.stringify({ key: "value" }, null, 2);

      await atomicWriteFile(filePath, data);

      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe(data);
      expect(JSON.parse(content)).toEqual({ key: "value" });
    });

    it("should leave no temp file on success", async () => {
      const filePath = path.join(tempDir, "test-no-tmp.json");
      await atomicWriteFile(filePath, "{}");

      const dirEntries = await fs.readdir(tempDir);
      const tmpFiles = dirEntries.filter((f) => f.includes(".tmp."));
      expect(tmpFiles).toHaveLength(0);
    });

    it("should overwrite existing file atomically", async () => {
      const filePath = path.join(tempDir, "overwrite.json");
      await fs.writeFile(filePath, JSON.stringify({ old: true }));

      await atomicWriteFile(filePath, JSON.stringify({ new: true }));

      const content = await fs.readFile(filePath, "utf-8");
      expect(JSON.parse(content)).toEqual({ new: true });
    });

    it("should not leave temp file on write failure", async () => {
      const filePath = path.join(tempDir, "nonexistent-dir", "fail.json");

      await expect(atomicWriteFile(filePath, "{}")).rejects.toThrow();

      // The temp file should have been cleaned up (directory doesn't exist
      // so the temp file was never created, but the cleanup path ran)
      // Verify no temp files in tempDir itself
      const dirEntries = await fs.readdir(tempDir);
      const tmpFiles = dirEntries.filter((f) => f.includes(".tmp."));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe("atomic settings write integration", () => {
    it("addMarketplaceToScope should produce valid JSON immediately after write", async () => {
      const projectConfigPath = path.join(tempDir, ".wave", "settings.json");
      mockExistsSync.mockImplementation(
        (p) => p.toString() === projectConfigPath || p.toString() === tempDir,
      );

      const marketConfig = {
        source: { source: "git", url: "https://example.com/repo.git" },
      } as unknown as import("../../src/types/configuration.js").MarketplaceConfig;

      await configService.addMarketplaceToScope(
        tempDir,
        "project",
        "test-market",
        marketConfig,
      );

      // Read back the real file (not mocked) — it should be valid JSON
      const content = await fs.readFile(projectConfigPath, "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();
      const parsed = JSON.parse(content);
      expect(parsed.marketplaces["test-market"]).toBeDefined();
      expect(parsed.marketplaces["test-market"].source.source).toBe("git");

      // Ensure no leftover temp files
      const waveDir = path.join(tempDir, ".wave");
      const dirEntries = await fs.readdir(waveDir);
      const tmpFiles = dirEntries.filter((f) => f.includes(".tmp."));
      expect(tmpFiles).toHaveLength(0);
    });

    it("updateEnabledPlugin should produce valid JSON immediately after write", async () => {
      const projectConfigPath = path.join(tempDir, ".wave", "settings.json");
      mockExistsSync.mockImplementation(
        (p) => p.toString() === projectConfigPath || p.toString() === tempDir,
      );

      await configService.updateEnabledPlugin(
        tempDir,
        "project",
        "plugin@market",
        true,
      );

      const content = await fs.readFile(projectConfigPath, "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();
      const parsed = JSON.parse(content);
      expect(parsed.enabledPlugins["plugin@market"]).toBe(true);
    });
  });
});
