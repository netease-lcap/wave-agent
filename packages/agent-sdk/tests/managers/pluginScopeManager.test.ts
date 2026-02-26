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
});
