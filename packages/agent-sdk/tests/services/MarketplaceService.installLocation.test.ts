import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { promises as fs, existsSync } from "fs";
import { getPluginsDir } from "../../src/utils/configPaths.js";
import type { InstalledPluginsRegistry } from "../../src/types/index.js";

vi.mock("../../src/utils/configPaths.js", () => ({
  getPluginsDir: vi.fn(),
}));

vi.mock("../../src/services/GitService.js");

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
      removeMarketplaceFromScope() {
        return Promise.resolve();
      }
      getMergedEnabledPlugins() {
        return {};
      }
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

/**
 * 安装记录（installed_plugins.json）在测试里的内存副本：读走 [registry]，写
 * （含原子写用的 .tmp 文件）回灌到它，使多步流程（卸载 → 安装 → 重建记录）
 * 互相看得到效果。
 */
describe("MarketplaceService - 安装记录按作用域记账（spec plugin A-015）", () => {
  let service: MarketplaceService;
  let registry: InstalledPluginsRegistry;
  const mockPluginsDir = "/mock/plugins";
  const mockExistsSync = vi.mocked(existsSync);
  const mockReadFile = vi.mocked(fs.readFile);
  const mockWriteFile = vi.mocked(fs.writeFile);
  const mockRm = vi.mocked(fs.rm);
  const mockOpen = vi.mocked(fs.open);
  const mockUnlink = vi.mocked(fs.unlink);

  const sharedCache = "/mock/cache/p/1.0.0";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPluginsDir).mockReturnValue(mockPluginsDir);
    mockExistsSync.mockReturnValue(true);
    mockOpen.mockResolvedValue({ close: vi.fn() } as unknown as Awaited<
      ReturnType<typeof fs.open>
    >);
    mockUnlink.mockResolvedValue(undefined);
    registry = { plugins: [] };

    mockReadFile.mockImplementation(async (file) => {
      const target = String(file);
      if (target.includes("installed_plugins.json")) {
        return JSON.stringify(registry);
      }
      if (target.includes("known_marketplaces.json")) {
        return JSON.stringify({ marketplaces: [] });
      }
      throw new Error(`unexpected read: ${target}`);
    });

    mockWriteFile.mockImplementation(async (file, content) => {
      if (String(file).includes("installed_plugins.json")) {
        registry = JSON.parse(String(content)) as InstalledPluginsRegistry;
      }
    });

    service = new MarketplaceService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("卸载只删除指定作用域的记录，其它作用域与其共享产物保留", async () => {
    registry = {
      plugins: [
        {
          name: "p",
          marketplace: "m",
          version: "1.0.0",
          cachePath: sharedCache,
          scope: "user",
        },
        {
          name: "p",
          marketplace: "m",
          version: "1.0.0",
          cachePath: sharedCache,
          scope: "project",
          projectPath: "/repo/a",
        },
      ],
    };
    mockExistsSync.mockReturnValue(true);

    await service.uninstallPlugin("p@m", {
      scope: "project",
      projectPath: "/repo/a",
    });

    expect(registry.plugins).toEqual([
      {
        name: "p",
        marketplace: "m",
        version: "1.0.0",
        cachePath: sharedCache,
        scope: "user",
      },
    ]);
    // 用户作用域仍引用同一份产物 → 缓存目录必须保留
    expect(mockRm).not.toHaveBeenCalled();
  });

  it("指定作用域没有记录时失败，并提示实际的安装位置", async () => {
    registry = {
      plugins: [
        {
          name: "p",
          marketplace: "m",
          version: "1.0.0",
          cachePath: sharedCache,
          scope: "user",
        },
      ],
    };
    mockExistsSync.mockReturnValue(true);

    await expect(
      service.uninstallPlugin("p@m", {
        scope: "project",
        projectPath: "/repo/a",
      }),
    ).rejects.toThrow("Installed at: user");
    expect(registry.plugins).toHaveLength(1);
  });

  it("更换作用域把安装记录搬到新位置", async () => {
    registry = {
      plugins: [
        {
          name: "p",
          marketplace: "m",
          version: "1.0.0",
          cachePath: sharedCache,
          scope: "user",
        },
      ],
    };

    await service.relocatePlugin(
      "p@m",
      { scope: "user" },
      { scope: "project", projectPath: "/repo/a" },
    );

    expect(registry.plugins).toEqual([
      {
        name: "p",
        marketplace: "m",
        version: "1.0.0",
        cachePath: sharedCache,
        scope: "project",
        projectPath: "/repo/a",
      },
    ]);
  });

  it("目标位置已有记录时丢弃被搬的那条", async () => {
    registry = {
      plugins: [
        {
          name: "p",
          marketplace: "m",
          version: "1.0.0",
          cachePath: sharedCache,
          scope: "user",
        },
        {
          name: "p",
          marketplace: "m",
          version: "1.0.0",
          cachePath: sharedCache,
          scope: "project",
          projectPath: "/repo/a",
        },
      ],
    };

    await service.relocatePlugin(
      "p@m",
      { scope: "user" },
      { scope: "project", projectPath: "/repo/a" },
    );

    expect(registry.plugins).toEqual([
      {
        name: "p",
        marketplace: "m",
        version: "1.0.0",
        cachePath: sharedCache,
        scope: "project",
        projectPath: "/repo/a",
      },
    ]);
  });

  it("升级按原作用域重建每条记录（安装作用域保持不变）", async () => {
    // 项目作用域记录在前：升级后仍须落在 project（而不是被折回 user）——
    // 顺序刻意与「先 user」相反，否则固定写回 user 的实现也能通过。
    registry = {
      plugins: [
        {
          name: "p",
          marketplace: "m",
          version: "1.0.0",
          cachePath: sharedCache,
          scope: "project",
          projectPath: "/repo/a",
        },
        {
          name: "p",
          marketplace: "m",
          version: "1.0.0",
          cachePath: sharedCache,
          scope: "user",
        },
      ],
    };

    // 走真实删除/写入语义的替身：卸载省略位置时删该插件全部记录，安装按位置记账
    vi.spyOn(service, "uninstallPlugin").mockImplementation(
      async (_pluginId, location) => {
        registry = {
          plugins: registry.plugins.filter((p) =>
            location
              ? !(
                  p.scope === location.scope &&
                  p.projectPath === location.projectPath
                )
              : false,
          ),
        };
      },
    );
    vi.spyOn(service, "installPlugin").mockImplementation(
      async (_pluginId, location) => {
        const installed = {
          name: "p",
          marketplace: "m",
          version: "2.0.0",
          cachePath: "/mock/cache/p/2.0.0",
          scope: location?.scope,
          projectPath: location?.projectPath,
        };
        registry = { plugins: [...registry.plugins, installed] };
        return installed;
      },
    );

    await service.updatePlugin("p@m");

    expect(registry.plugins).toEqual([
      {
        name: "p",
        marketplace: "m",
        version: "2.0.0",
        cachePath: "/mock/cache/p/2.0.0",
        scope: "project",
        projectPath: "/repo/a",
      },
      {
        name: "p",
        marketplace: "m",
        version: "2.0.0",
        cachePath: "/mock/cache/p/2.0.0",
        scope: "user",
      },
    ]);
  });
});
