import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginService } from "../../src/services/pluginService.js";
import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { PluginManager } from "../../src/managers/pluginManager.js";
import { PluginScopeManager } from "../../src/managers/pluginScopeManager.js";

// Mock the dependencies
vi.mock("../../src/services/MarketplaceService.js");
vi.mock("../../src/services/configurationService.js");
vi.mock("../../src/managers/pluginManager.js");
vi.mock("../../src/managers/pluginScopeManager.js");

describe("PluginService", () => {
  let pluginService: PluginService;
  let mockMarketplaceService: MarketplaceService;
  let mockConfigurationService: ConfigurationService;
  let mockPluginManager: PluginManager;
  let mockScopeManager: PluginScopeManager;
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();

    mockMarketplaceService = {
      installPlugin: vi.fn(),
      uninstallPlugin: vi.fn(),
      getInstalledPlugins: vi.fn(),
      listMarketplaces: vi.fn(),
      loadMarketplaceManifest: vi.fn(),
      getMarketplacePath: vi.fn(),
      addMarketplace: vi.fn(),
      removeMarketplace: vi.fn(),
      updateMarketplace: vi.fn(),
      updatePlugin: vi.fn(),
    } as unknown as MarketplaceService;

    mockConfigurationService = {
      getMergedEnabledPlugins: vi.fn(),
      removeEnabledPlugin: vi.fn(),
      getConfigurationPaths: vi.fn(),
      loadWaveConfigFromFile: vi.fn(),
      updateEnabledPlugin: vi.fn(),
    } as unknown as ConfigurationService;

    mockPluginManager = {
      updateEnabledPlugins: vi.fn(),
    } as unknown as PluginManager;

    mockScopeManager = {
      enablePlugin: vi.fn(),
      disablePlugin: vi.fn(),
      removePluginFromAllScopes: vi.fn(),
      findPluginScope: vi.fn(),
      getMergedEnabledPlugins: vi.fn(),
    } as unknown as PluginScopeManager;

    // Configure mocks to return the mock instances when instantiated
    vi.mocked(MarketplaceService).mockImplementation(function () {
      return mockMarketplaceService;
    });
    vi.mocked(ConfigurationService).mockImplementation(function () {
      return mockConfigurationService;
    });
    vi.mocked(PluginManager).mockImplementation(function () {
      return mockPluginManager;
    });
    vi.mocked(PluginScopeManager).mockImplementation(function () {
      return mockScopeManager;
    });

    pluginService = new PluginService(workdir);
  });

  describe("install", () => {
    it("should install a plugin without scope", async () => {
      const plugin = "test-plugin@test-marketplace";
      const installedPlugin = {
        name: "test-plugin",
        marketplace: "test-marketplace",
      };
      vi.mocked(mockMarketplaceService.installPlugin).mockResolvedValue(
        installedPlugin as unknown as Awaited<
          ReturnType<typeof mockMarketplaceService.installPlugin>
        >,
      );

      const result = await pluginService.install(plugin);

      expect(mockMarketplaceService.installPlugin).toHaveBeenCalledWith(
        plugin,
        workdir,
      );
      expect(mockScopeManager.enablePlugin).not.toHaveBeenCalled();
      expect(result).toEqual(installedPlugin);
    });

    it("should install a plugin and enable it in a scope", async () => {
      const plugin = "test-plugin@test-marketplace";
      const installedPlugin = {
        name: "test-plugin",
        marketplace: "test-marketplace",
      };
      vi.mocked(mockMarketplaceService.installPlugin).mockResolvedValue(
        installedPlugin as unknown as Awaited<
          ReturnType<typeof mockMarketplaceService.installPlugin>
        >,
      );

      const result = await pluginService.install(plugin, "project");

      expect(mockMarketplaceService.installPlugin).toHaveBeenCalledWith(
        plugin,
        workdir,
      );
      expect(mockScopeManager.enablePlugin).toHaveBeenCalledWith(
        "project",
        "test-plugin@test-marketplace",
      );
      expect(result).toEqual(installedPlugin);
    });
  });

  describe("uninstall", () => {
    it("should uninstall a plugin and remove it from all scopes", async () => {
      const plugin = "test-plugin@test-marketplace";

      await pluginService.uninstall(plugin);

      expect(mockMarketplaceService.uninstallPlugin).toHaveBeenCalledWith(
        plugin,
        workdir,
      );
      expect(mockScopeManager.removePluginFromAllScopes).toHaveBeenCalledWith(
        plugin,
      );
    });

    it("should warn but not fail if scope cleanup fails", async () => {
      const plugin = "test-plugin@test-marketplace";
      vi.mocked(mockScopeManager.removePluginFromAllScopes).mockRejectedValue(
        new Error("Cleanup failed"),
      );
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await pluginService.uninstall(plugin);

      expect(mockMarketplaceService.uninstallPlugin).toHaveBeenCalledWith(
        plugin,
        workdir,
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Warning: Could not clean up all plugin configurations",
        ),
      );

      consoleSpy.mockRestore();
    });

    it("should warn with string error if scope cleanup fails with non-Error", async () => {
      const plugin = "test-plugin@test-marketplace";
      vi.mocked(mockScopeManager.removePluginFromAllScopes).mockRejectedValue(
        "String error",
      );
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await pluginService.uninstall(plugin);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("String error"),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("enable", () => {
    it("should enable a plugin in the specified scope", async () => {
      const plugin = "test-plugin@test-marketplace";

      const result = await pluginService.enable(plugin, "project");

      expect(mockScopeManager.enablePlugin).toHaveBeenCalledWith(
        "project",
        plugin,
      );
      expect(result).toBe("project");
    });

    it("should enable a plugin in found scope if not specified", async () => {
      const plugin = "test-plugin@test-marketplace";
      vi.mocked(mockScopeManager.findPluginScope).mockReturnValue("project");

      const result = await pluginService.enable(plugin);

      expect(mockScopeManager.findPluginScope).toHaveBeenCalledWith(plugin);
      expect(mockScopeManager.enablePlugin).toHaveBeenCalledWith(
        "project",
        plugin,
      );
      expect(result).toBe("project");
    });

    it("should default to user scope if no scope found and not specified", async () => {
      const plugin = "test-plugin@test-marketplace";
      vi.mocked(mockScopeManager.findPluginScope).mockReturnValue(null);

      const result = await pluginService.enable(plugin);

      expect(mockScopeManager.enablePlugin).toHaveBeenCalledWith(
        "user",
        plugin,
      );
      expect(result).toBe("user");
    });
  });

  describe("disable", () => {
    it("should disable a plugin in the specified scope", async () => {
      const plugin = "test-plugin@test-marketplace";

      const result = await pluginService.disable(plugin, "project");

      expect(mockScopeManager.disablePlugin).toHaveBeenCalledWith(
        "project",
        plugin,
      );
      expect(result).toBe("project");
    });

    it("should disable a plugin in found scope if not specified", async () => {
      const plugin = "test-plugin@test-marketplace";
      vi.mocked(mockScopeManager.findPluginScope).mockReturnValue("project");

      const result = await pluginService.disable(plugin);

      expect(mockScopeManager.disablePlugin).toHaveBeenCalledWith(
        "project",
        plugin,
      );
      expect(result).toBe("project");
    });

    it("should default to user scope if no scope found and not specified for disable", async () => {
      const plugin = "test-plugin@test-marketplace";
      vi.mocked(mockScopeManager.findPluginScope).mockReturnValue(null);

      const result = await pluginService.disable(plugin);

      expect(mockScopeManager.disablePlugin).toHaveBeenCalledWith(
        "user",
        plugin,
      );
      expect(result).toBe("user");
    });
  });

  describe("list", () => {
    it("should list all plugins from marketplaces and merge with enabled state", async () => {
      const installedPlugins = {
        plugins: [{ name: "plugin1", marketplace: "m1", version: "1.0.0" }],
      };
      const marketplaces = [{ name: "m1" }];
      const manifest = {
        plugins: [{ name: "plugin1" }, { name: "plugin2" }],
      };
      const mergedEnabled = { "plugin1@m1": true };

      vi.mocked(mockMarketplaceService.getInstalledPlugins).mockResolvedValue(
        installedPlugins as unknown as Awaited<
          ReturnType<typeof mockMarketplaceService.getInstalledPlugins>
        >,
      );
      vi.mocked(mockMarketplaceService.listMarketplaces).mockResolvedValue(
        marketplaces as unknown as Awaited<
          ReturnType<typeof mockMarketplaceService.listMarketplaces>
        >,
      );
      vi.mocked(mockMarketplaceService.getMarketplacePath).mockReturnValue(
        "/path/to/m1",
      );
      vi.mocked(
        mockMarketplaceService.loadMarketplaceManifest,
      ).mockResolvedValue(
        manifest as unknown as Awaited<
          ReturnType<typeof mockMarketplaceService.loadMarketplaceManifest>
        >,
      );
      vi.mocked(
        mockConfigurationService.getMergedEnabledPlugins,
      ).mockReturnValue(mergedEnabled);
      vi.mocked(mockScopeManager.findPluginScope).mockImplementation(((
        id: string,
      ) => {
        if (id === "plugin1@m1") return "project";
        return null;
      }) as unknown as typeof mockScopeManager.findPluginScope);

      const result = await pluginService.list();

      expect(result.mergedEnabled).toEqual(mergedEnabled);
      expect(result.plugins).toHaveLength(2);
      expect(result.plugins).toContainEqual({
        name: "plugin1",
        marketplace: "m1",
        installed: true,
        version: "1.0.0",
        scope: "project",
      });
      expect(result.plugins).toContainEqual({
        name: "plugin2",
        marketplace: "m1",
        installed: false,
        version: undefined,
        scope: undefined,
      });
    });

    it("should skip marketplaces that fail to load", async () => {
      vi.mocked(mockMarketplaceService.getInstalledPlugins).mockResolvedValue({
        plugins: [],
      } as unknown as Awaited<
        ReturnType<typeof mockMarketplaceService.getInstalledPlugins>
      >);
      vi.mocked(mockMarketplaceService.listMarketplaces).mockResolvedValue([
        { name: "m1" },
      ] as unknown as Awaited<
        ReturnType<typeof mockMarketplaceService.listMarketplaces>
      >);
      vi.mocked(
        mockMarketplaceService.loadMarketplaceManifest,
      ).mockRejectedValue(new Error("Load failed"));
      vi.mocked(
        mockConfigurationService.getMergedEnabledPlugins,
      ).mockReturnValue({});

      const result = await pluginService.list();

      expect(result.plugins).toHaveLength(0);
    });

    it("should handle marketplaces that fail to load with non-Error exception", async () => {
      vi.mocked(mockMarketplaceService.getInstalledPlugins).mockResolvedValue({
        plugins: [],
      } as unknown as Awaited<
        ReturnType<typeof mockMarketplaceService.getInstalledPlugins>
      >);
      vi.mocked(mockMarketplaceService.listMarketplaces).mockResolvedValue([
        { name: "m1" },
      ] as unknown as Awaited<
        ReturnType<typeof mockMarketplaceService.listMarketplaces>
      >);
      vi.mocked(
        mockMarketplaceService.loadMarketplaceManifest,
      ).mockRejectedValue("Unknown error");
      vi.mocked(
        mockConfigurationService.getMergedEnabledPlugins,
      ).mockReturnValue({});

      const result = await pluginService.list();

      expect(result.plugins).toHaveLength(0);
    });
  });

  describe("Marketplace operations", () => {
    it("should list marketplaces", async () => {
      const marketplaces = [{ name: "m1" }];
      vi.mocked(mockMarketplaceService.listMarketplaces).mockResolvedValue(
        marketplaces as unknown as Awaited<
          ReturnType<typeof mockMarketplaceService.listMarketplaces>
        >,
      );

      const result = await pluginService.listMarketplaces();

      expect(result).toEqual(marketplaces);
    });

    it("should add a marketplace", async () => {
      const source = "https://github.com/user/repo";
      const marketplace = { name: "new-m", source };
      vi.mocked(mockMarketplaceService.addMarketplace).mockResolvedValue(
        marketplace as unknown as Awaited<
          ReturnType<typeof mockMarketplaceService.addMarketplace>
        >,
      );

      const result = await pluginService.addMarketplace(source);

      expect(mockMarketplaceService.addMarketplace).toHaveBeenCalledWith(
        source,
      );
      expect(result).toEqual(marketplace);
    });

    it("should remove a marketplace", async () => {
      await pluginService.removeMarketplace("m1");
      expect(mockMarketplaceService.removeMarketplace).toHaveBeenCalledWith(
        "m1",
      );
    });

    it("should update a marketplace", async () => {
      await pluginService.updateMarketplace("m1");
      expect(mockMarketplaceService.updateMarketplace).toHaveBeenCalledWith(
        "m1",
      );
    });

    it("should update a plugin", async () => {
      await pluginService.updatePlugin("p1@m1");
      expect(mockMarketplaceService.updatePlugin).toHaveBeenCalledWith("p1@m1");
    });
  });

  describe("Other methods", () => {
    it("should get installed plugins", async () => {
      const installed = { plugins: [] };
      vi.mocked(mockMarketplaceService.getInstalledPlugins).mockResolvedValue(
        installed as unknown as Awaited<
          ReturnType<typeof mockMarketplaceService.getInstalledPlugins>
        >,
      );
      const result = await pluginService.getInstalledPlugins();
      expect(result).toEqual(installed);
    });

    it("should get merged enabled plugins", () => {
      const merged = { p1: true };
      vi.mocked(mockScopeManager.getMergedEnabledPlugins).mockReturnValue(
        merged,
      );
      const result = pluginService.getMergedEnabledPlugins();
      expect(result).toEqual(merged);
    });

    it("should find plugin scope", () => {
      vi.mocked(mockScopeManager.findPluginScope).mockReturnValue("project");
      const result = pluginService.findPluginScope("p1");
      expect(result).toBe("project");
    });

    it("should load marketplace manifest", async () => {
      const manifest = { name: "m1", plugins: [] };
      vi.mocked(
        mockMarketplaceService.loadMarketplaceManifest,
      ).mockResolvedValue(
        manifest as unknown as Awaited<
          ReturnType<typeof mockMarketplaceService.loadMarketplaceManifest>
        >,
      );
      const result = await pluginService.loadMarketplaceManifest("/path");
      expect(result).toEqual(manifest);
    });

    it("should get marketplace path", () => {
      const mk = {
        name: "m1",
        source: { source: "github", repo: "r" },
      } as unknown as Parameters<typeof pluginService.getMarketplacePath>[0];
      vi.mocked(mockMarketplaceService.getMarketplacePath).mockReturnValue(
        "/path",
      );
      const result = pluginService.getMarketplacePath(mk);
      expect(result).toBe("/path");
    });

    it("should remove enabled plugin", async () => {
      await pluginService.removeEnabledPlugin("project", "p1");
      expect(mockConfigurationService.removeEnabledPlugin).toHaveBeenCalledWith(
        workdir,
        "project",
        "p1",
      );
    });
  });
});
