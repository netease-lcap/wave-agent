import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { PluginScopeManager } from "../../src/managers/pluginScopeManager.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { PluginManager } from "../../src/managers/pluginManager.js";

describe("PluginScopeManager", () => {
  let scopeManager: PluginScopeManager;
  let mockConfigService: Record<string, unknown>;
  let mockPluginManager: Record<string, unknown>;
  const workdir = "/test/workdir";

  beforeEach(() => {
    mockConfigService = {
      updateEnabledPlugin: vi.fn().mockResolvedValue(undefined),
      getMergedEnabledPlugins: vi.fn().mockReturnValue({}),
      findPluginScope: vi.fn(),
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

  describe("enablePlugin", () => {
    it("should find existing scope", async () => {
      (mockConfigService.findPluginScope as Mock).mockReturnValue("local");
      await scopeManager.enablePlugin("test-plugin");
      expect(mockConfigService.updateEnabledPlugin).toHaveBeenCalledWith(
        workdir,
        "local",
        "test-plugin",
        true,
      );
    });

    it("should default to user scope if not found", async () => {
      (mockConfigService.findPluginScope as Mock).mockReturnValue(null);
      await scopeManager.enablePlugin("test-plugin");
      expect(mockConfigService.updateEnabledPlugin).toHaveBeenCalledWith(
        workdir,
        "user",
        "test-plugin",
        true,
      );
    });
  });

  describe("disablePlugin", () => {
    it("should find existing scope", async () => {
      (mockConfigService.findPluginScope as Mock).mockReturnValue("local");
      await scopeManager.disablePlugin("test-plugin");
      expect(mockConfigService.updateEnabledPlugin).toHaveBeenCalledWith(
        workdir,
        "local",
        "test-plugin",
        false,
      );
    });

    it("should default to user scope if not found", async () => {
      (mockConfigService.findPluginScope as Mock).mockReturnValue(null);
      await scopeManager.disablePlugin("test-plugin");
      expect(mockConfigService.updateEnabledPlugin).toHaveBeenCalledWith(
        workdir,
        "user",
        "test-plugin",
        false,
      );
    });
  });
});
