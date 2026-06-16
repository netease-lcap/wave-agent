import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { promises as fs, existsSync } from "fs";
import * as path from "path";
import { getPluginsDir } from "../../src/utils/configPaths.js";

vi.mock("../../src/utils/configPaths.js", () => ({
  getPluginsDir: vi.fn(),
}));

vi.mock("../../src/services/GitService.js");

const mockRemoveMarketplaceFromScope = vi.fn().mockResolvedValue(undefined);
const mockRemoveEnabledPlugin = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/services/configurationService.js", () => {
  return {
    ConfigurationService: class MockConfigService {
      getMergedMarketplaces() {
        return {};
      }
      getScopedMarketplaces() {
        return {};
      }
      addMarketplaceToScope() {
        return Promise.resolve();
      }
      removeMarketplaceFromScope = mockRemoveMarketplaceFromScope;
      getMergedEnabledPlugins() {
        return {};
      }
      removeEnabledPlugin = mockRemoveEnabledPlugin;
    },
  };
});

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rm: vi.fn(),
      mkdir: vi.fn(),
      cp: vi.fn(),
      rename: vi.fn(),
      open: vi.fn(),
      unlink: vi.fn(),
    },
  };
});

describe("MarketplaceService - removeMarketplace", () => {
  let service: MarketplaceService;
  const mockPluginsDir = "/mock/plugins";
  const mockExistsSync = vi.mocked(existsSync);
  const mockReadFile = vi.mocked(fs.readFile);
  const mockWriteFile = vi.mocked(fs.writeFile);
  const mockRm = vi.mocked(fs.rm);
  const mockRename = vi.mocked(fs.rename);
  const mockOpen = vi.mocked(fs.open);
  const mockUnlink = vi.mocked(fs.unlink);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPluginsDir).mockReturnValue(mockPluginsDir);
    mockExistsSync.mockReturnValue(false);
    mockOpen.mockResolvedValue({ close: vi.fn() } as unknown as Awaited<
      ReturnType<typeof fs.open>
    >);
    mockUnlink.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    service = new MarketplaceService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupInstalledPlugins(
    plugins: Array<{
      name: string;
      marketplace: string;
      version: string;
      cachePath: string;
    }>,
  ) {
    const registry = { plugins };
    mockReadFile.mockImplementation(async (filePath) => {
      const p = filePath.toString();
      if (p.includes("installed_plugins.json")) {
        return JSON.stringify(registry);
      }
      if (p.includes("known_marketplaces.json")) {
        return JSON.stringify({
          builtinSeeded: false,
          marketplaces: [
            {
              name: "test-marketplace",
              source: { source: "directory", path: "/tmp" },
            },
          ],
        });
      }
      throw new Error(`ENOENT: ${p}`);
    });
    // installed_plugins.json and known_marketplaces.json exist
    mockExistsSync.mockImplementation((p) => {
      const s = p.toString();
      return (
        s.includes("installed_plugins.json") ||
        s.includes("known_marketplaces.json")
      );
    });
  }

  it("should remove all installed plugins from the marketplace", async () => {
    const marketplaceName = "test-marketplace";
    const cachePath1 = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      "plugin1",
      "1.0.0",
    );
    const cachePath2 = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      "plugin2",
      "1.0.0",
    );

    setupInstalledPlugins([
      {
        name: "plugin1",
        marketplace: marketplaceName,
        version: "1.0.0",
        cachePath: cachePath1,
      },
      {
        name: "plugin2",
        marketplace: marketplaceName,
        version: "1.0.0",
        cachePath: cachePath2,
      },
    ]);

    await service.removeMarketplace(marketplaceName);

    // Both plugins should be removed from the registry
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("installed_plugins.json"),
      JSON.stringify({ plugins: [] }, null, 2),
    );
  });

  it("should delete cache files for removed plugins when no other references exist", async () => {
    const marketplaceName = "test-marketplace";
    const cachePath1 = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      "plugin1",
      "1.0.0",
    );
    const cachePath2 = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      "plugin2",
      "1.0.0",
    );

    setupInstalledPlugins([
      {
        name: "plugin1",
        marketplace: marketplaceName,
        version: "1.0.0",
        cachePath: cachePath1,
      },
      {
        name: "plugin2",
        marketplace: marketplaceName,
        version: "1.0.0",
        cachePath: cachePath2,
      },
    ]);

    // Cache paths exist on disk
    mockExistsSync.mockImplementation((p) => {
      const s = p.toString();
      return (
        s.includes("installed_plugins.json") ||
        s.includes("known_marketplaces.json") ||
        s === cachePath1 ||
        s === cachePath2
      );
    });

    await service.removeMarketplace(marketplaceName);

    expect(mockRm).toHaveBeenCalledWith(cachePath1, {
      recursive: true,
      force: true,
    });
    expect(mockRm).toHaveBeenCalledWith(cachePath2, {
      recursive: true,
      force: true,
    });
  });

  it("should NOT delete cache files still referenced by other plugins", async () => {
    const marketplaceName = "test-marketplace";
    const sharedCachePath = "/mock/cache/shared";

    setupInstalledPlugins([
      {
        name: "plugin1",
        marketplace: marketplaceName,
        version: "1.0.0",
        cachePath: sharedCachePath,
      },
      {
        name: "plugin2",
        marketplace: "other-marketplace",
        version: "1.0.0",
        cachePath: sharedCachePath,
      },
    ]);

    mockExistsSync.mockImplementation((p) => {
      const s = p.toString();
      return (
        s.includes("installed_plugins.json") ||
        s.includes("known_marketplaces.json") ||
        s === sharedCachePath
      );
    });

    await service.removeMarketplace(marketplaceName);

    // Cache should NOT be deleted because plugin2 from other-marketplace still references it
    expect(mockRm).not.toHaveBeenCalledWith(sharedCachePath, expect.anything());
  });

  it("should call removeEnabledPlugin for each plugin across all scopes", async () => {
    const marketplaceName = "test-marketplace";
    const cachePath = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      "plugin1",
      "1.0.0",
    );

    setupInstalledPlugins([
      {
        name: "plugin1",
        marketplace: marketplaceName,
        version: "1.0.0",
        cachePath,
      },
    ]);

    await service.removeMarketplace(marketplaceName);

    // Should be called for each scope: user, project, local
    expect(mockRemoveEnabledPlugin).toHaveBeenCalledWith(
      expect.any(String),
      "user",
      "plugin1@test-marketplace",
    );
    expect(mockRemoveEnabledPlugin).toHaveBeenCalledWith(
      expect.any(String),
      "project",
      "plugin1@test-marketplace",
    );
    expect(mockRemoveEnabledPlugin).toHaveBeenCalledWith(
      expect.any(String),
      "local",
      "plugin1@test-marketplace",
    );
    expect(mockRemoveEnabledPlugin).toHaveBeenCalledTimes(3);
  });

  it("should call removeEnabledPlugin for multiple plugins from the marketplace", async () => {
    const marketplaceName = "test-marketplace";
    const cachePath1 = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      "plugin1",
      "1.0.0",
    );
    const cachePath2 = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      "plugin2",
      "2.0.0",
    );

    setupInstalledPlugins([
      {
        name: "plugin1",
        marketplace: marketplaceName,
        version: "1.0.0",
        cachePath: cachePath1,
      },
      {
        name: "plugin2",
        marketplace: marketplaceName,
        version: "2.0.0",
        cachePath: cachePath2,
      },
    ]);

    await service.removeMarketplace(marketplaceName);

    // 2 plugins x 3 scopes = 6 calls
    expect(mockRemoveEnabledPlugin).toHaveBeenCalledTimes(6);
    expect(mockRemoveEnabledPlugin).toHaveBeenCalledWith(
      expect.any(String),
      "user",
      "plugin1@test-marketplace",
    );
    expect(mockRemoveEnabledPlugin).toHaveBeenCalledWith(
      expect.any(String),
      "user",
      "plugin2@test-marketplace",
    );
  });

  it("should NOT affect plugins from other marketplaces", async () => {
    const marketplaceName = "test-marketplace";
    const otherMarketplace = "other-marketplace";
    const cachePath1 = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      "plugin1",
      "1.0.0",
    );
    const cachePath2 = path.join(
      mockPluginsDir,
      "cache",
      otherMarketplace,
      "plugin2",
      "1.0.0",
    );

    setupInstalledPlugins([
      {
        name: "plugin1",
        marketplace: marketplaceName,
        version: "1.0.0",
        cachePath: cachePath1,
      },
      {
        name: "plugin2",
        marketplace: otherMarketplace,
        version: "1.0.0",
        cachePath: cachePath2,
      },
    ]);

    await service.removeMarketplace(marketplaceName);

    // The registry should still contain plugin2 from other-marketplace
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("installed_plugins.json"),
      JSON.stringify(
        {
          plugins: [
            {
              name: "plugin2",
              marketplace: otherMarketplace,
              version: "1.0.0",
              cachePath: cachePath2,
            },
          ],
        },
        null,
        2,
      ),
    );

    // removeEnabledPlugin should NOT have been called for plugin2
    expect(mockRemoveEnabledPlugin).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "plugin2@other-marketplace",
    );
  });

  it("should work normally when no plugins are installed from the marketplace", async () => {
    const marketplaceName = "test-marketplace";

    setupInstalledPlugins([]);

    await service.removeMarketplace(marketplaceName);

    // No cache deletions
    expect(mockRm).not.toHaveBeenCalled();

    // No removeEnabledPlugin calls
    expect(mockRemoveEnabledPlugin).not.toHaveBeenCalled();

    // removeMarketplaceFromScope should still be called
    expect(mockRemoveMarketplaceFromScope).toHaveBeenCalledWith(
      expect.any(String),
      "user",
      marketplaceName,
    );
  });

  it("should call removeMarketplaceFromScope with the correct scope", async () => {
    const marketplaceName = "test-marketplace";

    setupInstalledPlugins([]);

    await service.removeMarketplace(marketplaceName, "project");

    expect(mockRemoveMarketplaceFromScope).toHaveBeenCalledWith(
      expect.any(String),
      "project",
      marketplaceName,
    );
  });

  it("should remove marketplace from cache registry", async () => {
    const marketplaceName = "test-marketplace";

    setupInstalledPlugins([]);

    await service.removeMarketplace(marketplaceName);

    // removeFromCache writes to known_marketplacesPath via tmp+rename
    // The last tmp write should have the marketplace filtered out
    const writeCalls = mockWriteFile.mock.calls.filter((c) =>
      c[0].toString().includes("known_marketplaces.json.tmp"),
    );
    expect(writeCalls.length).toBeGreaterThanOrEqual(1);
    const lastWrite = writeCalls[writeCalls.length - 1];
    const writtenContent = JSON.parse(lastWrite[1] as string);
    expect(
      writtenContent.marketplaces.find(
        (m: { name: string }) => m.name === marketplaceName,
      ),
    ).toBeUndefined();
  });
});
