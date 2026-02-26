import { describe, it, expect, vi, beforeEach, Mocked } from "vitest";
import { PluginCore } from "../../src/core/plugin.js";
import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { PluginScopeManager } from "../../src/managers/pluginScopeManager.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { KnownMarketplace } from "../../src/types/index.js";

vi.mock("../../src/services/MarketplaceService.js");
vi.mock("../../src/managers/pluginScopeManager.js");
vi.mock("../../src/services/configurationService.js");
vi.mock("../../src/managers/pluginManager.js");

describe("PluginCore", () => {
  let pluginCore: PluginCore;
  let mockMarketplaceService: Mocked<MarketplaceService>;
  let mockPluginScopeManager: Mocked<PluginScopeManager>;
  let mockConfigurationService: Mocked<ConfigurationService>;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginCore = new PluginCore("/tmp/workdir");

    // Access private members for testing or rely on mocked constructors
    mockMarketplaceService = vi.mocked(
      vi.mocked(MarketplaceService).mock.instances[0],
    );
    mockPluginScopeManager = vi.mocked(
      vi.mocked(PluginScopeManager).mock.instances[0],
    );
    mockConfigurationService = vi.mocked(
      vi.mocked(ConfigurationService).mock.instances[0],
    );
  });

  it("should install a plugin and optionally enable it", async () => {
    const pluginId = "test-plugin@market";
    const installedPlugin = {
      name: "test-plugin",
      marketplace: "market",
      version: "1.0.0",
      cachePath: "/path",
    };
    mockMarketplaceService.installPlugin.mockResolvedValue(installedPlugin);

    // Without scope
    const result1 = await pluginCore.installPlugin(pluginId);
    expect(result1).toEqual(installedPlugin);
    expect(mockMarketplaceService.installPlugin).toHaveBeenCalledWith(pluginId);
    expect(mockPluginScopeManager.enablePlugin).not.toHaveBeenCalled();

    // With scope
    mockPluginScopeManager.findPluginScope.mockReturnValue(null);
    const result2 = await pluginCore.installPlugin(pluginId, "user");
    expect(result2).toEqual(installedPlugin);
    expect(mockPluginScopeManager.enablePlugin).toHaveBeenCalledWith(
      "user",
      pluginId,
    );
  });

  it("should uninstall a plugin and clean up scopes", async () => {
    const pluginId = "test-plugin@market";
    await pluginCore.uninstallPlugin(pluginId);
    expect(mockMarketplaceService.uninstallPlugin).toHaveBeenCalledWith(
      pluginId,
    );
    expect(
      mockPluginScopeManager.removePluginFromAllScopes,
    ).toHaveBeenCalledWith(pluginId);
  });

  it("should enable a plugin with fallback scope logic", async () => {
    const pluginId = "test-plugin@market";

    // Explicit scope
    await pluginCore.enablePlugin(pluginId, "project");
    expect(mockPluginScopeManager.enablePlugin).toHaveBeenCalledWith(
      "project",
      pluginId,
    );

    // Found scope
    mockPluginScopeManager.findPluginScope.mockReturnValue("local");
    await pluginCore.enablePlugin(pluginId);
    expect(mockPluginScopeManager.enablePlugin).toHaveBeenCalledWith(
      "local",
      pluginId,
    );

    // Default scope
    mockPluginScopeManager.findPluginScope.mockReturnValue(null);
    await pluginCore.enablePlugin(pluginId);
    expect(mockPluginScopeManager.enablePlugin).toHaveBeenCalledWith(
      "user",
      pluginId,
    );
  });

  it("should disable a plugin with fallback scope logic", async () => {
    const pluginId = "test-plugin@market";

    // Explicit scope
    await pluginCore.disablePlugin(pluginId, "project");
    expect(mockPluginScopeManager.disablePlugin).toHaveBeenCalledWith(
      "project",
      pluginId,
    );

    // Found scope
    mockPluginScopeManager.findPluginScope.mockReturnValue("local");
    await pluginCore.disablePlugin(pluginId);
    expect(mockPluginScopeManager.disablePlugin).toHaveBeenCalledWith(
      "local",
      pluginId,
    );

    // Default scope
    mockPluginScopeManager.findPluginScope.mockReturnValue(null);
    await pluginCore.disablePlugin(pluginId);
    expect(mockPluginScopeManager.disablePlugin).toHaveBeenCalledWith(
      "user",
      pluginId,
    );
  });

  it("should update a plugin", async () => {
    const pluginId = "test-plugin@market";
    await pluginCore.updatePlugin(pluginId);
    expect(mockMarketplaceService.updatePlugin).toHaveBeenCalledWith(pluginId);
  });

  it("should list plugins from all marketplaces", async () => {
    mockMarketplaceService.getInstalledPlugins.mockResolvedValue({
      plugins: [
        { name: "p1", marketplace: "m1", version: "1.0.0", cachePath: "/p1" },
      ],
    });
    mockMarketplaceService.listMarketplaces.mockResolvedValue([
      { name: "m1", source: { source: "directory", path: "/m1" } },
    ]);
    mockMarketplaceService.getMarketplacePath.mockReturnValue("/m1");
    mockMarketplaceService.loadMarketplaceManifest.mockResolvedValue({
      name: "m1",
      owner: { name: "o1" },
      plugins: [
        { name: "p1", description: "desc1", source: "s1" },
        { name: "p2", description: "desc2", source: "s2" },
      ],
    });
    mockConfigurationService.getMergedEnabledPlugins.mockReturnValue({
      "p1@m1": true,
    });
    mockPluginScopeManager.findPluginScope.mockReturnValue("user");

    const result = await pluginCore.listPlugins();

    expect(result.plugins).toHaveLength(2);
    expect(result.plugins[0]).toMatchObject({
      name: "p1",
      marketplace: "m1",
      installed: true,
      scope: "user",
    });
    expect(result.plugins[1]).toMatchObject({
      name: "p2",
      marketplace: "m1",
      installed: false,
    });
    expect(result.mergedEnabled).toEqual({ "p1@m1": true });
  });

  it("should handle marketplace load failures in listPlugins", async () => {
    mockMarketplaceService.getInstalledPlugins.mockResolvedValue({
      plugins: [],
    });
    mockMarketplaceService.listMarketplaces.mockResolvedValue([
      {
        name: "m1",
        source: { source: "directory", path: "/m1" },
      } as KnownMarketplace,
    ]);
    mockMarketplaceService.loadMarketplaceManifest.mockRejectedValue(
      new Error("Load failed"),
    );

    const result = await pluginCore.listPlugins();
    expect(result.plugins).toHaveLength(0);
  });

  it("should delegate marketplace operations", async () => {
    await pluginCore.addMarketplace("source");
    expect(mockMarketplaceService.addMarketplace).toHaveBeenCalledWith(
      "source",
    );

    await pluginCore.removeMarketplace("m1");
    expect(mockMarketplaceService.removeMarketplace).toHaveBeenCalledWith("m1");

    await pluginCore.updateMarketplace("m1");
    expect(mockMarketplaceService.updateMarketplace).toHaveBeenCalledWith("m1");

    await pluginCore.listMarketplaces();
    expect(mockMarketplaceService.listMarketplaces).toHaveBeenCalled();

    await pluginCore.getInstalledPlugins();
    expect(mockMarketplaceService.getInstalledPlugins).toHaveBeenCalled();

    pluginCore.getMergedEnabledPlugins();
    expect(mockConfigurationService.getMergedEnabledPlugins).toHaveBeenCalled();

    await pluginCore.loadMarketplaceManifest("/path");
    expect(mockMarketplaceService.loadMarketplaceManifest).toHaveBeenCalledWith(
      "/path",
    );

    pluginCore.getMarketplacePath({
      name: "m1",
      source: { source: "directory", path: "/m1" },
    } as KnownMarketplace);
    expect(mockMarketplaceService.getMarketplacePath).toHaveBeenCalled();

    pluginCore.findPluginScope("p1@m1");
    expect(mockPluginScopeManager.findPluginScope).toHaveBeenCalledWith(
      "p1@m1",
    );

    await pluginCore.removeEnabledPlugin("user", "p1@m1");
    expect(mockConfigurationService.removeEnabledPlugin).toHaveBeenCalledWith(
      "/tmp/workdir",
      "user",
      "p1@m1",
    );
  });
});
