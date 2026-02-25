import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { PluginScopeManager } from "../../src/managers/pluginScopeManager.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { PluginManager } from "../../src/managers/pluginManager.js";

vi.mock("../../src/services/configurationService.js");
vi.mock("../../src/managers/pluginManager.js");

describe("PluginScopeManager", () => {
  let scopeManager: PluginScopeManager;
  let mockConfigService: {
    updateEnabledPlugin: Mock;
    removeEnabledPlugin: Mock;
    getMergedEnabledPlugins: Mock;
    getConfigurationPaths: Mock;
    loadWaveConfigFromFile: Mock;
  };
  let mockPluginManager: {
    updateEnabledPlugins: Mock;
  };
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigService = {
      updateEnabledPlugin: vi.fn(),
      removeEnabledPlugin: vi.fn(),
      getMergedEnabledPlugins: vi.fn(),
      getConfigurationPaths: vi.fn().mockReturnValue({
        projectPaths: [
          "/test/workdir/.wave/settings.local.json",
          "/test/workdir/.wave/settings.json",
        ],
        userPaths: [
          "/test/userhome/.wave/settings.local.json",
          "/test/userhome/.wave/settings.json",
        ],
      }),
      loadWaveConfigFromFile: vi.fn(),
    };
    mockPluginManager = {
      updateEnabledPlugins: vi.fn(),
    };

    scopeManager = new PluginScopeManager({
      workdir,
      configurationService:
        mockConfigService as unknown as ConfigurationService,
      pluginManager: mockPluginManager as unknown as PluginManager,
    });
  });

  describe("findPluginScope", () => {
    it("should return 'local' if plugin is found in project settings.local.json", () => {
      mockConfigService.loadWaveConfigFromFile.mockImplementation(
        (filePath: string) => {
          if (filePath === "/test/workdir/.wave/settings.local.json") {
            return { enabledPlugins: { "test-plugin": true } };
          }
          return null;
        },
      );

      const scope = scopeManager.findPluginScope("test-plugin");
      expect(scope).toBe("local");
    });

    it("should return 'project' if plugin is found in project settings.json", () => {
      mockConfigService.loadWaveConfigFromFile.mockImplementation(
        (filePath: string) => {
          if (filePath === "/test/workdir/.wave/settings.json") {
            return { enabledPlugins: { "test-plugin": true } };
          }
          return null;
        },
      );

      const scope = scopeManager.findPluginScope("test-plugin");
      expect(scope).toBe("project");
    });

    it("should return 'user' if plugin is found in user settings.local.json", () => {
      mockConfigService.loadWaveConfigFromFile.mockImplementation(
        (filePath: string) => {
          if (filePath === "/test/userhome/.wave/settings.local.json") {
            return { enabledPlugins: { "test-plugin": true } };
          }
          return null;
        },
      );

      const scope = scopeManager.findPluginScope("test-plugin");
      expect(scope).toBe("user");
    });

    it("should return 'user' if plugin is found in user settings.json", () => {
      mockConfigService.loadWaveConfigFromFile.mockImplementation(
        (filePath: string) => {
          if (filePath === "/test/userhome/.wave/settings.json") {
            return { enabledPlugins: { "test-plugin": true } };
          }
          return null;
        },
      );

      const scope = scopeManager.findPluginScope("test-plugin");
      expect(scope).toBe("user");
    });

    it("should return null if plugin is not found in any scope", () => {
      mockConfigService.loadWaveConfigFromFile.mockReturnValue(null);

      const scope = scopeManager.findPluginScope("test-plugin");
      expect(scope).toBeNull();
    });

    it("should respect priority: local > project > user", () => {
      mockConfigService.loadWaveConfigFromFile.mockImplementation(() => {
        return { enabledPlugins: { "test-plugin": true } };
      });

      const scope = scopeManager.findPluginScope("test-plugin");
      expect(scope).toBe("local");
    });
  });

  describe("enablePlugin", () => {
    it("should enable plugin and refresh manager", async () => {
      await scopeManager.enablePlugin("project", "test-plugin");
      expect(mockConfigService.updateEnabledPlugin).toHaveBeenCalledWith(
        workdir,
        "project",
        "test-plugin",
        true,
      );
      expect(mockPluginManager.updateEnabledPlugins).toHaveBeenCalled();
    });

    it("should log info if logger is provided", async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      const scopeManagerWithLogger = new PluginScopeManager({
        workdir,
        configurationService:
          mockConfigService as unknown as ConfigurationService,
        pluginManager: mockPluginManager as unknown as PluginManager,
        logger,
      });

      await scopeManagerWithLogger.enablePlugin("project", "test-plugin");
      expect(logger.info).toHaveBeenCalledWith(
        "Enabled plugin test-plugin in project scope",
      );
    });
  });

  describe("disablePlugin", () => {
    it("should disable plugin and refresh manager", async () => {
      await scopeManager.disablePlugin("user", "test-plugin");
      expect(mockConfigService.updateEnabledPlugin).toHaveBeenCalledWith(
        workdir,
        "user",
        "test-plugin",
        false,
      );
      expect(mockPluginManager.updateEnabledPlugins).toHaveBeenCalled();
    });

    it("should log info if logger is provided", async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      const scopeManagerWithLogger = new PluginScopeManager({
        workdir,
        configurationService:
          mockConfigService as unknown as ConfigurationService,
        pluginManager: mockPluginManager as unknown as PluginManager,
        logger,
      });

      await scopeManagerWithLogger.disablePlugin("user", "test-plugin");
      expect(logger.info).toHaveBeenCalledWith(
        "Disabled plugin test-plugin in user scope",
      );
    });
  });

  describe("getMergedEnabledPlugins", () => {
    it("should return merged enabled plugins from config service", () => {
      const expected = { p1: true, p2: false };
      mockConfigService.getMergedEnabledPlugins.mockReturnValue(expected);
      const result = scopeManager.getMergedEnabledPlugins();
      expect(result).toBe(expected);
      expect(mockConfigService.getMergedEnabledPlugins).toHaveBeenCalledWith(
        workdir,
      );
    });
  });

  describe("removePluginFromAllScopes", () => {
    it("should remove plugin from all scopes and refresh plugin manager", async () => {
      await scopeManager.removePluginFromAllScopes("test-plugin");

      expect(mockConfigService.removeEnabledPlugin).toHaveBeenCalledTimes(3);
      expect(mockConfigService.removeEnabledPlugin).toHaveBeenCalledWith(
        workdir,
        "user",
        "test-plugin",
      );
      expect(mockConfigService.removeEnabledPlugin).toHaveBeenCalledWith(
        workdir,
        "project",
        "test-plugin",
      );
      expect(mockConfigService.removeEnabledPlugin).toHaveBeenCalledWith(
        workdir,
        "local",
        "test-plugin",
      );
      expect(mockPluginManager.updateEnabledPlugins).toHaveBeenCalled();
    });

    it("should continue removing from other scopes if one fails and log warning", async () => {
      const logger = {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      const scopeManagerWithLogger = new PluginScopeManager({
        workdir,
        configurationService:
          mockConfigService as unknown as ConfigurationService,
        pluginManager: mockPluginManager as unknown as PluginManager,
        logger,
      });

      mockConfigService.removeEnabledPlugin.mockImplementation((_wd, scope) => {
        if (scope === "project") {
          throw new Error("Failed to remove");
        }
        return Promise.resolve();
      });

      await scopeManagerWithLogger.removePluginFromAllScopes("test-plugin");

      expect(mockConfigService.removeEnabledPlugin).toHaveBeenCalledTimes(3);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to remove plugin test-plugin from project scope",
        ),
      );
      expect(mockPluginManager.updateEnabledPlugins).toHaveBeenCalled();
    });

    it("should log warning with string error if error is not an instance of Error", async () => {
      const logger = {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      const scopeManagerWithLogger = new PluginScopeManager({
        workdir,
        configurationService:
          mockConfigService as unknown as ConfigurationService,
        pluginManager: mockPluginManager as unknown as PluginManager,
        logger,
      });

      mockConfigService.removeEnabledPlugin.mockRejectedValue("String error");

      await scopeManagerWithLogger.removePluginFromAllScopes("test-plugin");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to remove plugin test-plugin from user scope: String error",
        ),
      );
    });
  });
});
