import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { existsSync, readFileSync } from "fs";

// Mock os.homedir before importing configurationService
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...(actual as typeof os),
    homedir: vi.fn(),
  };
});

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
} from "../../src/services/configurationService.js";
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
      expect(configService.getEnvironmentVars()).toEqual(
        result.configuration?.env,
      );
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
    it("should set and get environment variables", () => {
      const env = { KEY: "VALUE" };
      configService.setEnvironmentVars(env);
      expect(configService.getEnvironmentVars()).toEqual(env);
    });

    it("should return a copy of environment variables", () => {
      const env = { KEY: "VALUE" };
      configService.setEnvironmentVars(env);
      const retrieved = configService.getEnvironmentVars();
      retrieved.KEY = "CHANGED";
      expect(configService.getEnvironmentVars().KEY).toBe("VALUE");
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

    it("should throw on missing baseURL", () => {
      expect(() => configService.resolveGatewayConfig()).toThrow();
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

    it("should throw when models are missing", () => {
      const originalModel = process.env.WAVE_MODEL;
      const originalFastModel = process.env.WAVE_FAST_MODEL;
      delete process.env.WAVE_MODEL;
      delete process.env.WAVE_FAST_MODEL;
      try {
        expect(() => configService.resolveModelConfig()).toThrow();
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

  describe("resolveMaxInputTokens", () => {
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
  });
});
