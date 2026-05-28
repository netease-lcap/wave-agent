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
vi.mock("../../src/services/GitService.js");

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
        getMarketplacePath: vi.fn().mockReturnValue("/marketplace/path"),
        loadMarketplaceManifest: vi.fn().mockResolvedValue({
          plugins: [{ name: "test-plugin" }],
        }),
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

  it("should skip installPlugin and remove stale enabledPlugin when plugin missing from marketplace manifest", async () => {
    const pluginId = "stale-plugin@official";
    const enabledPlugins = { [pluginId]: true };

    const mockRemoveEnabledPlugin = vi.fn().mockResolvedValue(undefined);
    (
      pluginManager as unknown as {
        mockConfigurationService: {
          getMergedEnabledPlugins: ReturnType<typeof vi.fn>;
          removeEnabledPlugin: ReturnType<typeof vi.fn>;
        };
      }
    ).mockConfigurationService.getMergedEnabledPlugins.mockReturnValue(
      enabledPlugins,
    );
    (
      pluginManager as unknown as {
        mockConfigurationService: {
          removeEnabledPlugin: ReturnType<typeof vi.fn>;
        };
      }
    ).mockConfigurationService.removeEnabledPlugin = mockRemoveEnabledPlugin;

    const installedPlugins = {
      plugins: [] as { name: string; marketplace: string; cachePath: string }[],
    };
    const knownMarketplaces = [
      { name: "official", source: { source: "github", repo: "test/repo" } },
    ];

    const mockInstallPlugin = vi.fn();

    vi.mocked(MarketplaceService).mockImplementation(function () {
      return {
        getInstalledPlugins: vi
          .fn()
          .mockImplementation(async () => installedPlugins),
        listMarketplaces: vi.fn().mockResolvedValue(knownMarketplaces),
        installPlugin: mockInstallPlugin,
        autoUpdateAll: vi.fn().mockResolvedValue(undefined),
        getMarketplacePath: vi.fn().mockReturnValue("/marketplace/path"),
        loadMarketplaceManifest: vi.fn().mockResolvedValue({
          plugins: [{ name: "other-plugin" }], // stale-plugin NOT in manifest
        }),
      } as unknown as MarketplaceService;
    });

    await pluginManager.loadPlugins([]);

    // Should NOT call installPlugin (avoids the 8s lock wait)
    expect(mockInstallPlugin).not.toHaveBeenCalled();
    // Should remove stale entry from enabledPlugins
    expect(mockRemoveEnabledPlugin).toHaveBeenCalledWith(
      workdir,
      "user",
      pluginId,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "no longer exists in marketplace official. Removing from enabledPlugins",
      ),
    );
  });

  it("should fall through to installPlugin when manifest read fails", async () => {
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
    const knownMarketplaces = [
      { name: "official", source: { source: "github", repo: "test/repo" } },
    ];

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
        getMarketplacePath: vi.fn().mockReturnValue("/marketplace/path"),
        loadMarketplaceManifest: vi
          .fn()
          .mockRejectedValue(new Error("Marketplace not cloned yet")),
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

    // Should fall through to installPlugin when manifest read fails
    expect(mockInstallPlugin).toHaveBeenCalledWith(pluginId);
  });

  it("should remove stale enabledPlugin when installPlugin fails with 'not found in marketplace'", async () => {
    const pluginId = "stale-plugin@official";
    const enabledPlugins = { [pluginId]: true };

    const mockRemoveEnabledPlugin = vi.fn().mockResolvedValue(undefined);
    (
      pluginManager as unknown as {
        mockConfigurationService: {
          getMergedEnabledPlugins: ReturnType<typeof vi.fn>;
          removeEnabledPlugin: ReturnType<typeof vi.fn>;
        };
      }
    ).mockConfigurationService.getMergedEnabledPlugins.mockReturnValue(
      enabledPlugins,
    );
    (
      pluginManager as unknown as {
        mockConfigurationService: {
          removeEnabledPlugin: ReturnType<typeof vi.fn>;
        };
      }
    ).mockConfigurationService.removeEnabledPlugin = mockRemoveEnabledPlugin;

    const installedPlugins = {
      plugins: [] as { name: string; marketplace: string; cachePath: string }[],
    };
    const knownMarketplaces = [
      { name: "official", source: { source: "github", repo: "test/repo" } },
    ];

    const mockInstallPlugin = vi
      .fn()
      .mockRejectedValue(
        new Error("Plugin stale-plugin not found in marketplace official"),
      );

    vi.mocked(MarketplaceService).mockImplementation(function () {
      return {
        getInstalledPlugins: vi
          .fn()
          .mockImplementation(async () => installedPlugins),
        listMarketplaces: vi.fn().mockResolvedValue(knownMarketplaces),
        installPlugin: mockInstallPlugin,
        autoUpdateAll: vi.fn().mockResolvedValue(undefined),
        getMarketplacePath: vi.fn().mockReturnValue("/marketplace/path"),
        loadMarketplaceManifest: vi.fn().mockResolvedValue({
          plugins: [{ name: "stale-plugin" }], // Exists in manifest but installPlugin still fails
        }),
      } as unknown as MarketplaceService;
    });

    await pluginManager.loadPlugins([]);

    // Should attempt installPlugin (manifest pre-check passed)
    expect(mockInstallPlugin).toHaveBeenCalledWith(pluginId);
    // Should remove stale entry when installPlugin fails with "not found in marketplace"
    expect(mockRemoveEnabledPlugin).toHaveBeenCalledWith(
      workdir,
      "user",
      pluginId,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "no longer found in marketplace. Removing from enabledPlugins",
      ),
    );
  });
});
