import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { promises as fs, existsSync } from "fs";
import * as path from "path";
import { getPluginsDir } from "../../src/utils/configPaths.js";

vi.mock("../../src/utils/configPaths.js", () => ({
  getPluginsDir: vi.fn(),
}));

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
    },
  };
});

describe("MarketplaceService - Uninstall", () => {
  let service: MarketplaceService;
  const mockPluginsDir = "/mock/plugins";
  const mockExistsSync = vi.mocked(existsSync);
  const mockReadFile = vi.mocked(fs.readFile);
  const mockWriteFile = vi.mocked(fs.writeFile);
  const mockRm = vi.mocked(fs.rm);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPluginsDir).mockReturnValue(mockPluginsDir);
    mockExistsSync.mockReturnValue(false); // By default, directories don't exist
    service = new MarketplaceService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should uninstall a plugin successfully and remove cache if no references remain", async () => {
    const pluginName = "test-plugin";
    const marketplaceName = "test-marketplace";
    const pluginId = `${pluginName}@${marketplaceName}`;
    const projectPath = "/mock/project";
    const cachePath = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      pluginName,
      "1.0.0",
    );

    const installedPlugins = {
      plugins: [
        {
          name: pluginName,
          marketplace: marketplaceName,
          version: "1.0.0",
          cachePath,
          projectPath,
        },
      ],
    };

    mockReadFile.mockResolvedValue(JSON.stringify(installedPlugins));
    mockExistsSync.mockImplementation((path) => {
      return (
        path.toString().includes("installed_plugins.json") || path === cachePath
      );
    });

    await service.uninstallPlugin(pluginId, projectPath);

    expect(mockRm).toHaveBeenCalledWith(cachePath, {
      recursive: true,
      force: true,
    });
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("installed_plugins.json"),
      JSON.stringify({ plugins: [] }, null, 2),
    );
  });

  it("should NOT remove cache if other projects still reference the plugin", async () => {
    const pluginName = "test-plugin";
    const marketplaceName = "test-marketplace";
    const pluginId = `${pluginName}@${marketplaceName}`;
    const projectPath1 = "/mock/project1";
    const projectPath2 = "/mock/project2";
    const cachePath = "/mock/cache/path";

    const installedPlugins = {
      plugins: [
        {
          name: pluginName,
          marketplace: marketplaceName,
          version: "1.0.0",
          cachePath,
          projectPath: projectPath1,
        },
        {
          name: pluginName,
          marketplace: marketplaceName,
          version: "1.0.0",
          cachePath,
          projectPath: projectPath2,
        },
      ],
    };

    mockReadFile.mockResolvedValue(JSON.stringify(installedPlugins));
    mockExistsSync.mockReturnValue(true);

    await service.uninstallPlugin(pluginId, projectPath1);

    // Should NOT call rm because projectPath2 still references it
    expect(mockRm).not.toHaveBeenCalled();

    // Should have updated the registry to only contain projectPath2
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("installed_plugins.json"),
      expect.stringContaining(projectPath2),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("installed_plugins.json"),
      expect.not.stringContaining(projectPath1),
    );
  });

  it("should throw error if plugin is not installed", async () => {
    const pluginId = "nonexistent@test-marketplace";

    mockReadFile.mockResolvedValue(JSON.stringify({ plugins: [] }));
    mockExistsSync.mockReturnValue(true);

    await expect(service.uninstallPlugin(pluginId)).rejects.toThrow(
      "Plugin nonexistent@test-marketplace is not installed",
    );
  });

  it("should throw error if plugin format is invalid", async () => {
    const pluginId = "invalid-format";

    await expect(service.uninstallPlugin(pluginId)).rejects.toThrow(
      "Invalid plugin format. Use name@marketplace",
    );
  });

  it("should handle multiple installed plugins correctly", async () => {
    const pluginName1 = "plugin1";
    const pluginName2 = "plugin2";
    const marketplaceName = "test-marketplace";
    const pluginId1 = `${pluginName1}@${marketplaceName}`;
    const cachePath1 = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      pluginName1,
      "1.0.0",
    );
    const cachePath2 = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      pluginName2,
      "1.0.0",
    );

    const installedPlugins = {
      plugins: [
        {
          name: pluginName1,
          marketplace: marketplaceName,
          version: "1.0.0",
          cachePath: cachePath1,
        },
        {
          name: pluginName2,
          marketplace: marketplaceName,
          version: "1.0.0",
          cachePath: cachePath2,
        },
      ],
    };

    mockReadFile.mockResolvedValue(JSON.stringify(installedPlugins));
    mockExistsSync.mockReturnValue(true);

    await service.uninstallPlugin(pluginId1);

    expect(mockRm).toHaveBeenCalledWith(cachePath1, {
      recursive: true,
      force: true,
    });
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("installed_plugins.json"),
      expect.stringContaining(pluginName2),
    );
  });

  it("should not fail if cache directory doesn't exist", async () => {
    const pluginName = "test-plugin";
    const marketplaceName = "test-marketplace";
    const pluginId = `${pluginName}@${marketplaceName}`;
    const cachePath = path.join(
      mockPluginsDir,
      "cache",
      marketplaceName,
      pluginName,
      "1.0.0",
    );

    const installedPlugins = {
      plugins: [
        {
          name: pluginName,
          marketplace: marketplaceName,
          version: "1.0.0",
          cachePath,
        },
      ],
    };

    mockReadFile.mockResolvedValue(JSON.stringify(installedPlugins));
    mockExistsSync.mockImplementation((path) => {
      if (path.toString().includes("installed_plugins.json")) return true;
      return false; // Cache directory doesn't exist
    });

    await service.uninstallPlugin(pluginId);

    expect(mockRm).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("installed_plugins.json"),
      JSON.stringify({ plugins: [] }, null, 2),
    );
  });
});
