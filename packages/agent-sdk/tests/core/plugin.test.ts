import { describe, it, expect, vi, beforeEach, Mocked } from "vitest";
import { PluginCore } from "../../src/core/plugin.js";
import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { PluginScopeManager } from "../../src/managers/pluginScopeManager.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { KnownMarketplace } from "../../src/types/index.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("../../src/services/MarketplaceService.js");
vi.mock("../../src/services/GitService.js");
vi.mock("../../src/managers/pluginScopeManager.js");
vi.mock("../../src/services/configurationService.js");
vi.mock("../../src/managers/pluginManager.js");
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

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
    expect(mockMarketplaceService.installPlugin).toHaveBeenCalledWith(
      pluginId,
      undefined,
    );
    expect(mockPluginScopeManager.enablePlugin).not.toHaveBeenCalled();

    // With scope：安装记录与启用作用域同源（spec plugin A-015）
    mockPluginScopeManager.findPluginScope.mockReturnValue(null);
    mockPluginScopeManager.getInstallLocation.mockReturnValue({
      scope: "user",
    });
    const result2 = await pluginCore.installPlugin(pluginId, "user");
    expect(result2).toEqual(installedPlugin);
    expect(mockMarketplaceService.installPlugin).toHaveBeenLastCalledWith(
      pluginId,
      { scope: "user" },
    );
    expect(mockPluginScopeManager.enablePlugin).toHaveBeenCalledWith(
      "user",
      pluginId,
    );
  });

  it("should uninstall a plugin from the scope it is enabled in", async () => {
    const pluginId = "test-plugin@market";
    mockPluginScopeManager.findPluginScope.mockReturnValue("project");
    mockPluginScopeManager.getInstallLocation.mockReturnValue({
      scope: "project",
      projectPath: "/tmp/workdir",
    });

    await pluginCore.uninstallPlugin(pluginId);

    expect(mockMarketplaceService.uninstallPlugin).toHaveBeenCalledWith(
      pluginId,
      { scope: "project", projectPath: "/tmp/workdir" },
    );
    expect(mockPluginScopeManager.removePluginFromScope).toHaveBeenCalledWith(
      "project",
      pluginId,
    );
    expect(
      mockPluginScopeManager.removePluginFromAllScopes,
    ).not.toHaveBeenCalled();
  });

  it("should throw when the plugin is not enabled in any scope", async () => {
    mockPluginScopeManager.findPluginScope.mockReturnValue(null);

    await expect(
      pluginCore.uninstallPlugin("test-plugin@market"),
    ).rejects.toThrow("Use --scope");
  });

  it("should relocate the install record when the scope changes", async () => {
    const pluginId = "test-plugin@market";
    mockPluginScopeManager.findPluginScope.mockReturnValue("project");
    mockPluginScopeManager.getInstallLocation.mockImplementation((scope) =>
      scope === "user"
        ? { scope: "user" }
        : { scope: "project", projectPath: "/tmp/workdir" },
    );

    await pluginCore.setPluginScope(pluginId, "user");

    // 启用记录换作用域，安装记录跟着搬到新位置（spec plugin A-015）
    expect(
      mockPluginScopeManager.removePluginFromAllScopes,
    ).toHaveBeenCalledWith(pluginId);
    expect(mockPluginScopeManager.enablePlugin).toHaveBeenCalledWith(
      "user",
      pluginId,
    );
    expect(mockMarketplaceService.relocatePlugin).toHaveBeenCalledWith(
      pluginId,
      { scope: "project", projectPath: "/tmp/workdir" },
      { scope: "user" },
    );
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

  it("should treat a plugin installed outside the current workdir as not installed", async () => {
    // 安装产物在本机（曾以项目作用域装在别的项目里），但当前工作目录的配置链里
    // 没有启用记录 → 未安装，且不回传作用域/版本/缓存路径（spec plugin A-012）
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
      plugins: [{ name: "p1", description: "desc1", source: "s1" }],
    });
    mockConfigurationService.getMergedEnabledPlugins.mockReturnValue({});
    mockPluginScopeManager.findPluginScope.mockReturnValue(null);

    const result = await pluginCore.listPlugins();

    expect(result.plugins[0]).toMatchObject({
      name: "p1",
      marketplace: "m1",
      installed: false,
    });
    expect(result.plugins[0].scope).toBeUndefined();
    expect(result.plugins[0].version).toBeUndefined();
    expect(result.plugins[0].cachePath).toBeUndefined();
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

  it("should list marketplace entries that use object sources", async () => {
    // 对象形态的 source（CC 市场清单常见）不能让整个市场列表消失：每个条目都
    // 要照常出现（spec plugin「兼容 Claude Code 生态的市场清单与插件」场景 1/4）
    mockMarketplaceService.getInstalledPlugins.mockResolvedValue({
      plugins: [],
    });
    mockMarketplaceService.listMarketplaces.mockResolvedValue([
      { name: "m1", source: { source: "directory", path: "/m1" } },
    ]);
    mockMarketplaceService.getMarketplacePath.mockReturnValue("/m1");
    mockMarketplaceService.loadMarketplaceManifest.mockResolvedValue({
      name: "m1",
      owner: { name: "o1" },
      plugins: [
        { name: "local-p", description: "d1", source: "plugins/local-p" },
        {
          name: "url-p",
          description: "d2",
          source: { source: "url", url: "https://example.com/a.git" },
        },
        {
          name: "subdir-p",
          description: "d3",
          source: {
            source: "git-subdir",
            url: "https://example.com/a.git",
            path: "plugins/subdir-p",
          },
        },
      ],
    });

    const result = await pluginCore.listPlugins();

    expect(result.plugins.map((p) => p.name)).toEqual([
      "local-p",
      "url-p",
      "subdir-p",
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should not report a latestVersion for sources outside the marketplace checkout", async () => {
    // 对象形态总是指向仓库外的仓库，本机没有可读的副本 ⇒ latestVersion 为空，
    // 而不是抛错或读出一个假版本（spec plugin A-010 / A-021）
    mockMarketplaceService.getInstalledPlugins.mockResolvedValue({
      plugins: [],
    });
    mockMarketplaceService.listMarketplaces.mockResolvedValue([
      { name: "m1", source: { source: "directory", path: "/m1" } },
    ]);
    mockMarketplaceService.getMarketplacePath.mockReturnValue("/m1");
    mockMarketplaceService.loadMarketplaceManifest.mockResolvedValue({
      name: "m1",
      owner: { name: "o1" },
      plugins: [
        {
          name: "url-p",
          description: "d2",
          source: { source: "url", url: "https://example.com/a.git" },
        },
        {
          name: "git-p",
          description: "d3",
          source: "https://example.com/b.git",
        },
        { name: "empty-p", description: "d4", source: "" },
      ],
    });

    const result = await pluginCore.listPlugins();

    expect(result.plugins).toHaveLength(3);
    for (const plugin of result.plugins) {
      expect(plugin.latestVersion).toBeUndefined();
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should warn about a failed marketplace and still list the others", async () => {
    mockMarketplaceService.getInstalledPlugins.mockResolvedValue({
      plugins: [],
    });
    mockMarketplaceService.listMarketplaces.mockResolvedValue([
      { name: "broken", source: { source: "directory", path: "/broken" } },
      { name: "ok", source: { source: "directory", path: "/ok" } },
    ]);
    mockMarketplaceService.getMarketplacePath.mockImplementation(
      (source) => (source as { path: string }).path,
    );
    mockMarketplaceService.loadMarketplaceManifest.mockImplementation(
      async (marketplacePath: string) => {
        if (marketplacePath === "/broken") {
          throw new Error("Unexpected token } in JSON");
        }
        return {
          name: "ok",
          owner: { name: "o1" },
          plugins: [{ name: "p1", description: "desc1", source: "plugins/p1" }],
        };
      },
    );

    const result = await pluginCore.listPlugins();

    expect(result.plugins.map((p) => p.name)).toEqual(["p1"]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to load marketplace broken: Unexpected token } in JSON",
    );
  });

  it("should delegate marketplace operations", async () => {
    await pluginCore.addMarketplace("source");
    expect(mockMarketplaceService.addMarketplace).toHaveBeenCalledWith(
      "source",
      "user",
    );

    await pluginCore.removeMarketplace("m1");
    expect(mockMarketplaceService.removeMarketplace).toHaveBeenCalledWith(
      "m1",
      undefined,
    );

    await pluginCore.updateMarketplace("m1");
    expect(mockMarketplaceService.updateMarketplace).toHaveBeenCalledWith(
      "m1",
      { updatePlugins: true },
    );

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
