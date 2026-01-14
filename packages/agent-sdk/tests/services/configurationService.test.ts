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
      });
      expect(result.configuration?.permissions?.allow).toContain("rule1");
      expect(result.configuration?.permissions?.allow).toContain("rule2");
      expect(configService.getEnvironmentVars()).toEqual(
        result.configuration?.env,
      );
    });

    it("should handle no configuration files found", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await configService.loadMergedConfiguration(tempDir);

      expect(result.success).toBe(true);
      expect(result.configuration).toBeNull();
      expect(result.warnings).toContain(
        "No configuration files found in user or project directories",
      );
    });

    it("should return error on invalid configuration", async () => {
      const invalidConfig = {
        permissions: {
          defaultMode: "invalid-mode",
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
    it("should correctly merge all 4 configuration files in priority order", async () => {
      const userSettingsPath = path.join(userHome, ".wave", "settings.json");
      const userLocalPath = path.join(userHome, ".wave", "settings.local.json");
      const projectSettingsPath = path.join(tempDir, ".wave", "settings.json");
      const projectLocalPath = path.join(
        tempDir,
        ".wave",
        "settings.local.json",
      );

      const userSettings = {
        enabledPlugins: { "plugin1@market": true, "plugin2@market": true },
        hooks: { PreToolUse: [{ matcher: "user", hooks: [] }] },
        env: { VAR1: "user", VAR2: "user" },
        permissions: { allow: ["rule-user"], defaultMode: "default" },
      };

      const userLocal = {
        enabledPlugins: { "plugin2@market": false, "plugin3@market": true },
        hooks: { PreToolUse: [{ matcher: "user-local", hooks: [] }] },
        env: { VAR2: "user-local", VAR3: "user-local" },
        permissions: {
          allow: ["rule-user-local"],
          defaultMode: "bypassPermissions",
        },
      };

      const projectSettings = {
        enabledPlugins: { "plugin3@market": false, "plugin4@market": true },
        hooks: { PreToolUse: [{ matcher: "project", hooks: [] }] },
        env: { VAR3: "project", VAR4: "project" },
        permissions: { allow: ["rule-project"], defaultMode: "acceptEdits" },
      };

      const projectLocal = {
        enabledPlugins: { "plugin4@market": false, "plugin5@market": true },
        hooks: { PreToolUse: [{ matcher: "project-local", hooks: [] }] },
        env: { VAR4: "project-local", VAR5: "project-local" },
        permissions: {
          allow: ["rule-project-local"],
          defaultMode: "bypassPermissions",
        },
      };

      mockExistsSync.mockImplementation((p) => {
        const pathStr = p.toString();
        return [
          userSettingsPath,
          userLocalPath,
          projectSettingsPath,
          projectLocalPath,
        ].some((expected) => pathStr.includes(expected));
      });

      mockReadFileSync.mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes(userSettingsPath))
          return JSON.stringify(userSettings);
        if (pathStr.includes(userLocalPath)) return JSON.stringify(userLocal);
        if (pathStr.includes(projectSettingsPath))
          return JSON.stringify(projectSettings);
        if (pathStr.includes(projectLocalPath))
          return JSON.stringify(projectLocal);
        return "";
      });

      const result = loadMergedWaveConfig(tempDir);

      expect(result).not.toBeNull();

      // Verify enabledPlugins (merged with precedence)
      expect(result?.enabledPlugins).toEqual({
        "plugin1@market": true,
        "plugin2@market": false, // from userLocal
        "plugin3@market": false, // from projectSettings
        "plugin4@market": false, // from projectLocal
        "plugin5@market": true, // from projectLocal
      });

      // Verify hooks (combined)
      expect(result?.hooks?.PreToolUse).toHaveLength(4);
      expect(result?.hooks?.PreToolUse?.[0].matcher).toBe("user");
      expect(result?.hooks?.PreToolUse?.[1].matcher).toBe("user-local");
      expect(result?.hooks?.PreToolUse?.[2].matcher).toBe("project");
      expect(result?.hooks?.PreToolUse?.[3].matcher).toBe("project-local");

      // Verify env (merged with precedence)
      expect(result?.env).toEqual({
        VAR1: "user",
        VAR2: "user-local",
        VAR3: "project",
        VAR4: "project-local",
        VAR5: "project-local",
      });

      // Verify defaultMode (highest priority wins)
      expect(result?.permissions?.defaultMode).toBe("bypassPermissions"); // from projectLocal

      // Verify permissions.allow (combined)
      expect(result?.permissions?.allow).toEqual(
        expect.arrayContaining([
          "rule-user",
          "rule-user-local",
          "rule-project",
          "rule-project-local",
        ]),
      );
      expect(result?.permissions?.allow).toHaveLength(4);
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
          defaultMode: "bypassPermissions" as const,
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

    it("should catch invalid defaultMode", () => {
      const config = {
        permissions: {
          defaultMode: "invalid" as unknown as "bypassPermissions",
        },
      };

      const result = configService.validateConfiguration(config);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("Invalid defaultMode");
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
    it("should resolve with defaults", () => {
      const config = configService.resolveModelConfig();
      expect(config.agentModel).toBe("gemini-3-flash");
      expect(config.fastModel).toBe("gemini-2.5-flash");
      expect(config.maxTokens).toBe(DEFAULT_WAVE_MAX_OUTPUT_TOKENS);
    });

    it("should resolve from internal env", () => {
      configService.setEnvironmentVars({
        WAVE_MODEL: "custom-agent",
        WAVE_FAST_MODEL: "custom-fast",
        WAVE_MAX_OUTPUT_TOKENS: "1000",
      });
      const config = configService.resolveModelConfig();
      expect(config.agentModel).toBe("custom-agent");
      expect(config.fastModel).toBe("custom-fast");
      expect(config.maxTokens).toBe(1000);
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
});
