import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginManager } from "../../src/managers/pluginManager.js";
import { Container } from "../../src/utils/container.js";
import { PluginLoader } from "../../src/services/pluginLoader.js";
import { PluginManifest } from "../../src/types/index.js";
import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/pluginLoader.js");
vi.mock("../../src/services/MarketplaceService.js");

describe("PluginManager Auto-install", () => {
  let pluginManager: PluginManager;
  let container: Container;
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();

    const mockConfigurationService = {
      getMergedEnabledPlugins: vi.fn().mockReturnValue({}),
    };

    container = new Container();
    container.register(
      "ConfigurationService",
      mockConfigurationService as unknown as Record<string, unknown>,
    );

    pluginManager = new PluginManager(container, {
      workdir,
    });
    // Expose mockConfigurationService for tests
    (
      pluginManager as unknown as {
        mockConfigurationService: typeof mockConfigurationService;
      }
    ).mockConfigurationService = mockConfigurationService;
  });

  it("should auto-install missing enabled plugins if marketplace is known", async () => {
    const pluginId = "test-plugin@official";
    const enabledPlugins = { [pluginId]: true };

    (
      pluginManager as unknown as {
        mockConfigurationService: {
          getMergedEnabledPlugins: ReturnType<typeof vi.fn>;
        };
      }
    ).mockConfigurationService.getMergedEnabledPlugins.mockReturnValue(
      enabledPlugins,
    );

    const installedPlugins = {
      plugins: [] as { name: string; marketplace: string; cachePath: string }[],
    };
    const knownMarketplaces = [{ name: "official" }];

    const mockInstallPlugin = vi.fn().mockImplementation(async () => {
      installedPlugins.plugins.push({
        name: "test-plugin",
        marketplace: "official",
        cachePath: "/path/to/test-plugin",
      });
    });

    vi.mocked(MarketplaceService).mockImplementation(function () {
      return {
        getInstalledPlugins: vi
          .fn()
          .mockImplementation(async () => installedPlugins),
        listMarketplaces: vi.fn().mockResolvedValue(knownMarketplaces),
        installPlugin: mockInstallPlugin,
        autoUpdateAll: vi.fn().mockResolvedValue(undefined),
      } as unknown as MarketplaceService;
    });

    vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
      name: "test-plugin",
      version: "1.0.0",
      description: "desc",
    } as PluginManifest);
    vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
    vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

    await pluginManager.loadPlugins([]);

    expect(mockInstallPlugin).toHaveBeenCalledWith(pluginId);
    expect(pluginManager.getPlugins()).toHaveLength(1);
    expect(pluginManager.getPlugin("test-plugin")).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(`Auto-installing missing plugin: ${pluginId}`),
    );
  });

  it("should NOT auto-install if marketplace is unknown", async () => {
    const pluginId = "test-plugin@unknown";
    const enabledPlugins = { [pluginId]: true };

    (
      pluginManager as unknown as {
        mockConfigurationService: {
          getMergedEnabledPlugins: ReturnType<typeof vi.fn>;
        };
      }
    ).mockConfigurationService.getMergedEnabledPlugins.mockReturnValue(
      enabledPlugins,
    );

    const installedPlugins = {
      plugins: [] as { name: string; marketplace: string; cachePath: string }[],
    };
    const knownMarketplaces = [{ name: "official" }];

    const mockInstallPlugin = vi.fn();

    vi.mocked(MarketplaceService).mockImplementation(function () {
      return {
        getInstalledPlugins: vi
          .fn()
          .mockImplementation(async () => installedPlugins),
        listMarketplaces: vi.fn().mockResolvedValue(knownMarketplaces),
        installPlugin: mockInstallPlugin,
        autoUpdateAll: vi.fn().mockResolvedValue(undefined),
      } as unknown as MarketplaceService;
    });

    await pluginManager.loadPlugins([]);

    expect(mockInstallPlugin).not.toHaveBeenCalled();
    expect(pluginManager.getPlugins()).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `marketplace unknown is unknown. Skipping auto-install.`,
      ),
    );
  });

  it("should handle installation errors gracefully", async () => {
    const pluginId = "test-plugin@official";
    const enabledPlugins = { [pluginId]: true };

    (
      pluginManager as unknown as {
        mockConfigurationService: {
          getMergedEnabledPlugins: ReturnType<typeof vi.fn>;
        };
      }
    ).mockConfigurationService.getMergedEnabledPlugins.mockReturnValue(
      enabledPlugins,
    );

    const installedPlugins = {
      plugins: [] as { name: string; marketplace: string; cachePath: string }[],
    };
    const knownMarketplaces = [{ name: "official" }];

    const error = new Error("Network error");
    const mockInstallPlugin = vi.fn().mockRejectedValue(error);

    vi.mocked(MarketplaceService).mockImplementation(function () {
      return {
        getInstalledPlugins: vi
          .fn()
          .mockImplementation(async () => installedPlugins),
        listMarketplaces: vi.fn().mockResolvedValue(knownMarketplaces),
        installPlugin: mockInstallPlugin,
        autoUpdateAll: vi.fn().mockResolvedValue(undefined),
      } as unknown as MarketplaceService;
    });

    await pluginManager.loadPlugins([]);

    expect(mockInstallPlugin).toHaveBeenCalledWith(pluginId);
    expect(pluginManager.getPlugins()).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to auto-install plugin ${pluginId}:`),
      error,
    );
  });
});
