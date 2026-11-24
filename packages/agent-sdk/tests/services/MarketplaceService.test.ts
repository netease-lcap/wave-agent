import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";

import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import * as fsModule from "fs";
const fs = fsModule.promises;
const { existsSync } = fsModule;
import * as path from "path";
import { getPluginsDir } from "../../src/utils/configPaths.js";
import type { ConfigurationService } from "../../src/services/configurationService.js";
import type { MarketplaceConfig } from "../../src/types/configuration.js";
import type { MarketplaceManifest } from "../../src/types/marketplace.js";

vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const promises = actual.promises as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync as (...args: unknown[]) => boolean),
    promises: {
      ...promises,
      open: vi.fn(promises.open as (...args: unknown[]) => Promise<unknown>),
      readdir: vi.fn(
        promises.readdir as (...args: unknown[]) => Promise<unknown>,
      ),
      rm: vi.fn(promises.rm as (...args: unknown[]) => Promise<unknown>),
      mkdir: vi.fn(promises.mkdir as (...args: unknown[]) => Promise<unknown>),
      rename: vi.fn(
        promises.rename as (...args: unknown[]) => Promise<unknown>,
      ),
      writeFile: vi.fn(
        promises.writeFile as (...args: unknown[]) => Promise<unknown>,
      ),
      readFile: vi.fn(
        promises.readFile as (...args: unknown[]) => Promise<unknown>,
      ),
      unlink: vi.fn(
        promises.unlink as (...args: unknown[]) => Promise<unknown>,
      ),
      cp: vi.fn(promises.cp as (...args: unknown[]) => Promise<unknown>),
    },
  };
});

vi.mock("../../src/utils/configPaths.js", () => ({
  getPluginsDir: vi.fn(),
}));

vi.mock("../../src/services/configurationService.js", () => {
  return {
    ConfigurationService: class MockConfigService {
      getMergedMarketplaces = vi.fn(() => ({}));
      getScopedMarketplaces = vi.fn(() => ({}));
      addMarketplaceToScope = vi.fn(() => Promise.resolve());
      removeMarketplaceFromScope = vi.fn(() => Promise.resolve());
      getMergedEnabledPlugins = vi.fn(() => ({}));
    },
  };
});

describe("MarketplaceService - Builtin Marketplace", () => {
  let service: MarketplaceService;
  const mockPluginsDir = path.join(process.cwd(), "tmp-test-plugins");

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPluginsDir).mockReturnValue(mockPluginsDir);
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
    // Pre-create directory and seed cache so constructor's async seed is a no-op
    await fs.mkdir(mockPluginsDir, { recursive: true });
    await fs.writeFile(
      path.join(mockPluginsDir, "known_marketplaces.json"),
      JSON.stringify({ builtinSeeded: true, marketplaces: [] }),
    );
    service = new MarketplaceService();
    await (service as unknown as { _seedComplete: Promise<void> })
      ._seedComplete;
    // Reset static variable
    // Mock all git operations by default
    vi.spyOn(
      service["gitService"] as unknown as {
        isGitAvailable: () => Promise<boolean>;
      },
      "isGitAvailable",
    ).mockResolvedValue(true);
    vi.spyOn(
      service["gitService"] as unknown as { clone: () => Promise<void> },
      "clone",
    ).mockResolvedValue();
    vi.spyOn(
      service["gitService"] as unknown as { pull: () => Promise<void> },
      "pull",
    ).mockResolvedValue();

    // Spy on fs methods
    vi.mocked(fs.open).mockResolvedValue({
      close: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof fs.open>>);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    try {
      if (existsSync(mockPluginsDir)) {
        await fs.rm(mockPluginsDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors from race conditions with async constructor operations
    }
    vi.restoreAllMocks();
  });

  it("should return empty list when no config file exists", async () => {
    const registry = await service.getKnownMarketplaces();
    expect(registry.marketplaces).toHaveLength(0);
  });

  it("should return empty list if builtin is explicitly removed (config file exists but empty)", async () => {
    const knownMarketplacesPath = path.join(
      mockPluginsDir,
      "known_marketplaces.json",
    );
    await fs.writeFile(
      knownMarketplacesPath,
      JSON.stringify({ marketplaces: [] }),
    );

    const registry = await service.getKnownMarketplaces();
    expect(registry.marketplaces).toHaveLength(0);
  });

  it("should persist custom marketplace when adding for the first time", async () => {
    // Mock git clone and manifest loading
    vi.spyOn(
      service,
      "loadMarketplaceManifest" as keyof MarketplaceService,
    ).mockResolvedValue({
      name: "custom-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    const added = await service.addMarketplace("custom-mkt");
    expect(added.name).toBe("custom-mkt");

    // listMarketplaces returns the custom marketplace
    const marketplaces = await service.listMarketplaces();
    expect(marketplaces.length).toBeGreaterThan(0);
    expect(marketplaces.some((m) => m.name === "custom-mkt")).toBe(true);
  });

  it("should not duplicate builtin marketplace if it already exists", async () => {
    const knownMarketplacesPath = path.join(
      mockPluginsDir,
      "known_marketplaces.json",
    );
    await fs.writeFile(
      knownMarketplacesPath,
      JSON.stringify({
        marketplaces: [
          {
            name: "wave-plugins-official",
            source: {
              source: "github",
              repo: "netease-lcap/wave-plugins-official",
            },
            isBuiltin: true,
          },
          {
            name: "custom",
            source: { source: "directory", path: "/some/path" },
          },
        ],
      }),
    );

    const registry = await service.getKnownMarketplaces();
    const builtinCount = registry.marketplaces.filter(
      (m) => m.name === "wave-plugins-official",
    ).length;
    expect(builtinCount).toBe(1);
  });

  it("should return correct marketplace path for github source", () => {
    const marketplace = {
      name: "test",
      source: { source: "github" as const, repo: "user/repo" },
    };
    const result = service.getMarketplacePath(marketplace.source);
    expect(result).toContain("marketplaces");
    expect(result).toContain(path.join("user", "repo"));
  });

  it("should return correct marketplace path for directory source", () => {
    const marketplace = {
      name: "test",
      source: { source: "directory" as const, path: "/some/path" },
    };
    const result = service.getMarketplacePath(marketplace.source);
    expect(result).toBe("/some/path");
  });

  it("should return correct marketplace path for git source", () => {
    const marketplace = {
      name: "test",
      source: { source: "git" as const, url: "https://example.com/repo" },
    };
    const result = service.getMarketplacePath(marketplace.source);
    expect(result).toContain("marketplaces");
  });

  it("should handle known marketplaces file with only whitespace", async () => {
    const knownMarketplacesPath = path.join(
      mockPluginsDir,
      "known_marketplaces.json",
    );
    await fs.writeFile(knownMarketplacesPath, "   \n\t  ");

    const registry = await service.getKnownMarketplaces();
    expect(registry.marketplaces).toHaveLength(0);
  });

  it("should handle known marketplaces file with empty array", async () => {
    const knownMarketplacesPath = path.join(
      mockPluginsDir,
      "known_marketplaces.json",
    );
    await fs.writeFile(
      knownMarketplacesPath,
      JSON.stringify({ marketplaces: [] }),
    );

    const registry = await service.getKnownMarketplaces();
    expect(registry.marketplaces).toHaveLength(0);
  });

  it("should throw error when git clone fails during addMarketplace", async () => {
    vi.spyOn(
      service["gitService"] as unknown as { clone: () => Promise<void> },
      "clone",
    ).mockRejectedValue(new Error("Clone failed"));

    await expect(
      service.addMarketplace("https://github.com/user/repo"),
    ).rejects.toThrow("Failed to add marketplace from Git");
  });

  it("should throw error when manifest loading fails during addMarketplace", async () => {
    vi.spyOn(
      service["gitService"] as unknown as { clone: () => Promise<void> },
      "clone",
    ).mockResolvedValue();
    vi.spyOn(
      service,
      "loadMarketplaceManifest" as keyof MarketplaceService,
    ).mockRejectedValue(new Error("No manifest"));

    await expect(
      service.addMarketplace("https://github.com/user/repo"),
    ).rejects.toThrow("Failed to load manifest from cloned repository");
  });

  it("should reject re-adding the same source (来源重复)", async () => {
    vi.spyOn(
      service,
      "loadMarketplaceManifest" as keyof MarketplaceService,
    ).mockResolvedValue({
      name: "custom-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    // Add first time
    await service.addMarketplace("https://github.com/user/repo");
    // 来源重复不允许添加（spec ecosystem/plugin 场景 16）
    await expect(
      service.addMarketplace("https://github.com/user/repo"),
    ).rejects.toThrow("该市场来源已添加：custom-mkt");

    // 判重发生在克隆前：第二次不再 Clone
    expect(
      vi.mocked(
        service["gitService"] as unknown as { clone: () => Promise<void> },
      ).clone,
    ).toHaveBeenCalledTimes(1);
  });

  it("should reject the same local directory twice (来源重复)", async () => {
    vi.spyOn(
      service,
      "loadMarketplaceManifest" as keyof MarketplaceService,
    ).mockResolvedValue({
      name: "disk-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    await service.addMarketplace("/work/team-plugins");
    await expect(service.addMarketplace("/work/team-plugins")).rejects.toThrow(
      "该市场来源已添加：disk-mkt",
    );
  });

  it("should reject a different source declaring an existing name (同名市场)", async () => {
    vi.spyOn(
      service,
      "loadMarketplaceManifest" as keyof MarketplaceService,
    ).mockResolvedValue({
      name: "custom-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    await service.addMarketplace("https://github.com/user/repo");
    // 另一个来源但清单声明同名 → 不允许添加
    await expect(
      service.addMarketplace("https://github.com/other/repo"),
    ).rejects.toThrow("同名市场已存在：custom-mkt");
  });

  it("should still allow a different source with a different name", async () => {
    const manifest = vi.spyOn(
      service,
      "loadMarketplaceManifest" as keyof MarketplaceService,
    );
    manifest.mockResolvedValue({
      name: "custom-mkt",
      owner: { name: "test" },
      plugins: [],
    });
    await service.addMarketplace("https://github.com/user/repo");

    manifest.mockResolvedValue({
      name: "other-mkt",
      owner: { name: "test" },
      plugins: [],
    });
    const added = await service.addMarketplace("https://github.com/other/repo");
    expect(added.name).toBe("other-mkt");

    const registry = await service.getKnownMarketplaces();
    const names = registry.marketplaces.map((m) => m.name);
    expect(names).toContain("custom-mkt");
    expect(names).toContain("other-mkt");
  });
});

describe("MarketplaceService - Scoped Marketplace", () => {
  let service: MarketplaceService;
  const mockPluginsDir = path.join(process.cwd(), "tmp-test-plugins-scoped");

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPluginsDir).mockReturnValue(mockPluginsDir);
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
    // Pre-create directory and seed cache so constructor's async seed is a no-op
    await fs.mkdir(mockPluginsDir, { recursive: true });
    await fs.writeFile(
      path.join(mockPluginsDir, "known_marketplaces.json"),
      JSON.stringify({ builtinSeeded: true, marketplaces: [] }),
    );
    service = new MarketplaceService();
    await (service as unknown as { _seedComplete: Promise<void> })
      ._seedComplete;
    vi.spyOn(
      service["gitService"] as unknown as {
        isGitAvailable: () => Promise<boolean>;
      },
      "isGitAvailable",
    ).mockResolvedValue(true);
    vi.spyOn(
      service["gitService"] as unknown as { clone: () => Promise<void> },
      "clone",
    ).mockResolvedValue();
    vi.spyOn(
      service["gitService"] as unknown as { pull: () => Promise<void> },
      "pull",
    ).mockResolvedValue();

    vi.mocked(fs.open).mockResolvedValue({
      close: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof fs.open>>);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    try {
      if (existsSync(mockPluginsDir)) {
        await fs.rm(mockPluginsDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors from race conditions with async constructor operations
    }
    vi.restoreAllMocks();
  });

  it("should list marketplaces from scoped settings", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "my-marketplace": {
        source: { source: "github", repo: "user/repo" },
      },
    });

    const marketplaces = await service.listMarketplaces();
    expect(marketplaces).toHaveLength(1);
    expect(marketplaces[0].name).toBe("my-marketplace");
  });

  it("should list marketplaces combining scoped settings with cache fallback", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "scoped-mkt": {
        source: { source: "directory", path: "/scoped/path" },
      },
    });

    const knownPath = path.join(mockPluginsDir, "known_marketplaces.json");
    await fs.writeFile(
      knownPath,
      JSON.stringify({
        marketplaces: [
          {
            name: "cached-mkt",
            source: { source: "directory", path: "/cached/path" },
          },
          {
            name: "scoped-mkt", // already in settings, should not duplicate
            source: { source: "directory", path: "/old/path" },
          },
          {
            name: "wave-plugins-official", // builtin in cache
            source: {
              source: "github",
              repo: "netease-lcap/wave-plugins-official",
            },
          },
        ],
      }),
    );

    const marketplaces = await service.listMarketplaces();
    // scoped-mkt(from settings) + cached-mkt(from cache) + wave-plugins-official(from cache)
    expect(marketplaces).toHaveLength(3);
    expect(marketplaces.some((m) => m.name === "cached-mkt")).toBe(true);
    expect(marketplaces.some((m) => m.name === "wave-plugins-official")).toBe(
      true,
    );
  });

  it("should return declaring scope for a marketplace", () => {
    vi.spyOn(service["configurationService"], "getScopedMarketplaces")
      .mockReturnValueOnce({})
      .mockReturnValueOnce({})
      .mockReturnValueOnce({
        "test-mkt": {
          source: { source: "directory", path: "/test" },
        },
      });

    const scope = service.getMarketplaceDeclaringSource("test-mkt");
    expect(scope).toBe("user");
  });

  it("should return builtin for builtin marketplace", () => {
    const scope = service.getMarketplaceDeclaringSource(
      "wave-plugins-official",
    );
    expect(scope).toBe("builtin");
  });

  it("should return null for unknown marketplace", () => {
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({});

    const scope = service.getMarketplaceDeclaringSource("unknown-mkt");
    expect(scope).toBeNull();
  });

  it("should remove marketplace from correct scope", async () => {
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({
      "test-mkt": {
        source: { source: "directory", path: "/test" },
      },
    });
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({});

    await service.removeMarketplace("test-mkt", "user");
    expect(
      vi.mocked(
        (service["configurationService"] as ConfigurationService)
          .removeMarketplaceFromScope,
      ),
    ).toHaveBeenCalled();
  });

  it("should remove builtin marketplace from cache", async () => {
    // Pre-populate cache with builtin marketplace
    const registry = {
      marketplaces: [
        {
          name: "wave-plugins-official",
          source: {
            source: "github",
            repo: "netease-lcap/wave-plugins-official",
          },
          isBuiltin: true,
          declaredScope: "builtin",
        },
      ],
    };
    vi.spyOn(
      service as unknown as {
        getCacheRegistry: () => Promise<typeof registry>;
      },
      "getCacheRegistry",
    ).mockResolvedValue(registry);
    const removeFromCacheSpy = vi
      .spyOn(
        service as unknown as {
          removeFromCache: (name: string) => Promise<void>;
        },
        "removeFromCache",
      )
      .mockResolvedValue(undefined);

    await service.removeMarketplace("wave-plugins-official");
    expect(removeFromCacheSpy).toHaveBeenCalledWith("wave-plugins-official");
  });

  it("should remove marketplace with inferred scope", async () => {
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({
      "test-mkt": {
        source: { source: "directory", path: "/test" },
      },
    });
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({});

    await service.removeMarketplace("test-mkt");
    expect(
      vi.mocked(
        (service["configurationService"] as ConfigurationService)
          .removeMarketplaceFromScope,
      ),
    ).toHaveBeenCalled();
  });

  it("should add marketplace with project scope", async () => {
    vi.spyOn(
      service,
      "loadMarketplaceManifest" as keyof MarketplaceService,
    ).mockResolvedValue({
      name: "project-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    const added = await service.addMarketplace("/some/path", "project");
    expect(added.name).toBe("project-mkt");
  });

  it("should add marketplace with local scope", async () => {
    vi.spyOn(
      service,
      "loadMarketplaceManifest" as keyof MarketplaceService,
    ).mockResolvedValue({
      name: "local-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    const added = await service.addMarketplace("/local/path", "local");
    expect(added.name).toBe("local-mkt");
  });

  it("should skip builtin marketplace in scoped iteration", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "wave-plugins-official": {
        source: {
          source: "github",
          repo: "netease-lcap/wave-plugins-official",
        },
      },
    });

    const marketplaces = await service.listMarketplaces();
    // Should only have one builtin entry
    const builtinCount = marketplaces.filter((m) => m.isBuiltin).length;
    expect(builtinCount).toBe(1);
  });

  it("should refresh every registered marketplace, ignoring legacy autoUpdate values", async () => {
    // 存量 settings.json 里可能还留着 autoUpdate 键（已不是 WaveConfiguration 的字段），
    // 它不再影响任何行为：所有市场一律刷新清单。
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "legacy-off-mkt": {
        source: { source: "directory", path: "/legacy-off" },
        autoUpdate: false,
      },
      "never-configured-mkt": {
        source: { source: "directory", path: "/never-configured" },
      },
    } as unknown as Record<string, MarketplaceConfig>);

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "mkt",
      owner: { name: "test" },
      plugins: [],
    });

    const updateSpy = vi.spyOn(service, "updateMarketplace");

    await service.refreshMarketplaces();

    const refreshed = updateSpy.mock.calls.map(([name]) => name);
    expect(refreshed).toContain("legacy-off-mkt");
    expect(refreshed).toContain("never-configured-mkt");
  });

  it("should not reinstall installed plugins while refreshing marketplaces", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "test-mkt": {
        source: { source: "directory", path: "/test" },
      },
    });

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "test-mkt",
      owner: { name: "test" },
      plugins: [],
    });
    vi.spyOn(service, "getInstalledPlugins").mockResolvedValue({
      plugins: [
        {
          name: "plugin1",
          marketplace: "test-mkt",
          version: "1.0.0",
          cachePath: "/tmp/plugin1",
        },
      ],
    });

    const installSpy = vi.spyOn(service, "installPlugin");
    const uninstallSpy = vi.spyOn(service, "uninstallPlugin");

    await service.refreshMarketplaces();

    expect(installSpy).not.toHaveBeenCalled();
    expect(uninstallSpy).not.toHaveBeenCalled();
  });

  it("should keep refreshing other marketplaces when one fails", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "bad-mkt": {
        source: { source: "directory", path: "/bad" },
      },
      "good-mkt": {
        source: { source: "directory", path: "/good" },
      },
    });

    vi.spyOn(service, "loadMarketplaceManifest").mockImplementation(
      async (marketplacePath: string) => {
        if (marketplacePath === "/bad") throw new Error("boom");
        return { name: "good-mkt", owner: { name: "test" }, plugins: [] };
      },
    );

    const updateSpy = vi.spyOn(service, "updateMarketplace");

    await expect(service.refreshMarketplaces()).resolves.toBeUndefined();

    expect(updateSpy.mock.calls.map(([name]) => name)).toContain("good-mkt");
  });

  it("should reuse an in-flight refresh instead of pulling every checkout twice", async () => {
    // 打开插件市场界面的刷新是重复可达的（重复打开 / 界面重挂），同一进程内
    // 进行中的那次刷新被复用（spec 插件市场场景 13）。
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "test-mkt": {
        source: { source: "directory", path: "/test" },
      },
    });

    let releaseAll: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    const updateSpy = vi
      .spyOn(service, "updateMarketplace")
      .mockImplementation(async () => {
        await gate;
        return 0;
      });

    const first = service.refreshMarketplaces();
    const second = service.refreshMarketplaces();
    releaseAll?.();
    await Promise.all([first, second]);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // 刷新结束后再调用 → 发起新的一轮（单飞只覆盖进行中的那次）
    await service.refreshMarketplaces();
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  it("should serialize concurrent marketplace operations instead of running them in parallel", async () => {
    // 连点「批量更新插件」会并发到达同一个进程：锁内的重入短路必须只对同一条
    // 调用链生效，另一条调用链要在文件锁上排队（spec 插件市场场景 14）——否则
    // 两个 git pull 会撞同一个检出（必然失败）。
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "git-mkt": { source: { source: "github", repo: "user/repo" } },
    });
    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "git-mkt",
      owner: { name: "test" },
      plugins: [],
    });
    // 检出目录已存在 → 走 pull 分支（不存在会走 clone，两者都要下载，取前者）
    await fs.mkdir(path.join(mockPluginsDir, "marketplaces", "user", "repo"), {
      recursive: true,
    });

    // 本套件默认把 fs.open 修成「永远拿到锁」，那样测不出互斥；这里用排他创建
    // 语义（O_CREAT|O_EXCL 的等价物）忠实模拟锁文件。
    let lockHeld = false;
    vi.mocked(fs.open).mockImplementation(async () => {
      if (lockHeld) {
        throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      }
      lockHeld = true;
      return {
        close: async () => {
          lockHeld = false;
        },
      } as unknown as Awaited<ReturnType<typeof fs.open>>;
    });

    let releasePull: (() => void) | undefined;
    const pullGate = new Promise<void>((resolve) => {
      releasePull = resolve;
    });
    let activePulls = 0;
    let maxActivePulls = 0;
    const pullSpy = vi.spyOn(
      service["gitService"] as unknown as { pull: () => Promise<void> },
      "pull",
    );
    pullSpy.mockImplementation(async () => {
      activePulls += 1;
      maxActivePulls = Math.max(maxActivePulls, activePulls);
      await pullGate;
      activePulls -= 1;
    });

    const first = service.updateMarketplace("git-mkt");
    // 给第二条调用链留出「加锁失败 → 排队重试」的机会（重试间隔 100ms）
    await new Promise((resolve) => setTimeout(resolve, 150));
    const second = service.updateMarketplace("git-mkt");
    releasePull?.();
    await Promise.all([first, second]);

    // 两次调用都执行了，但没有任何时刻在并发拉同一个检出
    expect(pullSpy).toHaveBeenCalledTimes(2);
    expect(maxActivePulls).toBe(1);
  });

  it("should throw when updating nonexistent marketplace", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({});

    await expect(service.updateMarketplace("nonexistent")).rejects.toThrow(
      "Marketplace nonexistent not found",
    );
  });

  it("should update all marketplaces when no name specified", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "test-mkt": {
        source: { source: "directory", path: "/test" },
      },
    });

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "test-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    await service.updateMarketplace();
    expect(vi.mocked(fs.writeFile).mock.calls.length).toBeGreaterThan(0);
  });

  it("should get known marketplaces with declaredScope for entries", async () => {
    const knownPath = path.join(mockPluginsDir, "known_marketplaces.json");
    await fs.writeFile(
      knownPath,
      JSON.stringify({
        marketplaces: [
          {
            name: "custom-mkt",
            source: { source: "directory", path: "/custom" },
          },
        ],
      }),
    );

    const registry = await service.getKnownMarketplaces();
    expect(registry.marketplaces[0].declaredScope).toBe("user");
  });
});

describe("MarketplaceService - 边界与错误路径", () => {
  let service: MarketplaceService;
  const mockPluginsDir = path.join(process.cwd(), "tmp-test-plugins-coverage");

  // git / 配置 / 迁移都在 service 的私有面上，借出来当探针。
  let gitSpies: Record<"isGitAvailable" | "clone" | "pull", MockInstance>;
  const git = () => gitSpies;
  const config = () => service["configurationService"];

  const settings = (entries: Record<string, MarketplaceConfig>) =>
    vi.spyOn(config(), "getMergedMarketplaces").mockReturnValue(entries);

  const manifest = (entry: Partial<MarketplaceManifest> = {}) =>
    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "test-mkt",
      owner: { name: "test" },
      plugins: [],
      ...entry,
    });

  const installed = (name: string, marketplace: string, version = "1.0.0") => ({
    name,
    marketplace,
    version,
    cachePath: "/cache/" + name,
    projectPath: "/project",
  });

  // installPlugin 把插件从市场目录拷进缓存并落 installed_plugins.json；
  // 这些用例只钉「拷贝前后的判断」，拷贝本身用桩顶掉。
  const stubCopyIntoCache = () => {
    vi.mocked(fs.cp).mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof fs.cp>>,
    );
    vi.mocked(fs.rename).mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof fs.rename>>,
    );
  };

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPluginsDir).mockReturnValue(mockPluginsDir);
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
    // Pre-create directory and seed cache so constructor's async seed is a no-op
    await fs.mkdir(mockPluginsDir, { recursive: true });
    await fs.writeFile(
      path.join(mockPluginsDir, "known_marketplaces.json"),
      JSON.stringify({ builtinSeeded: true, marketplaces: [] }),
    );
    service = new MarketplaceService();
    await (service as unknown as { _seedComplete: Promise<void> })
      ._seedComplete;
    const gitService = service["gitService"] as unknown as {
      isGitAvailable: () => Promise<boolean>;
      clone: (...args: unknown[]) => Promise<void>;
      pull: (...args: unknown[]) => Promise<void>;
    };
    gitSpies = {
      isGitAvailable: vi
        .spyOn(gitService, "isGitAvailable")
        .mockResolvedValue(true),
      clone: vi.spyOn(gitService, "clone").mockResolvedValue(undefined),
      pull: vi.spyOn(gitService, "pull").mockResolvedValue(undefined),
    };

    vi.mocked(fs.open).mockResolvedValue({
      close: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof fs.open>>);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    try {
      if (existsSync(mockPluginsDir)) {
        await fs.rm(mockPluginsDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors from race conditions with async constructor operations
    }
    vi.restoreAllMocks();
  });

  describe("缓存与迁移", () => {
    it("迁移时跳过内置市场，其余迁进 user 设置", async () => {
      vi.spyOn(service, "getCacheRegistry").mockResolvedValue({
        marketplaces: [
          {
            name: "wave-plugins-official",
            source: {
              source: "github",
              repo: "netease-lcap/wave-plugins-official",
            },
          },
          { name: "old-mkt", source: { source: "directory", path: "/old" } },
        ],
      });
      settings({});
      vi.spyOn(config(), "getScopedMarketplaces").mockReturnValue({});

      await (
        service as unknown as { runMigration: () => Promise<void> }
      ).runMigration();

      const migrated = vi
        .mocked(config().addMarketplaceToScope)
        .mock.calls.map((call) => call[2]);
      expect(migrated).toEqual(["old-mkt"]);
    });

    it("缓存里没有这个市场时，按空目录来源补一条", async () => {
      vi.spyOn(service, "getCacheRegistry").mockResolvedValue(null);
      settings({
        "unknown-cache-mkt": {
          source: { source: "directory", path: "/unknown" },
        },
      });
      vi.spyOn(config(), "getScopedMarketplaces").mockReturnValue({});
      manifest({ name: "unknown-cache-mkt" });
      vi.mocked(fs.writeFile).mockClear();

      await service.updateMarketplace("unknown-cache-mkt");

      const cacheWrite = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) =>
          String(call[0]).includes("known_marketplaces.json.tmp"),
        );
      expect(cacheWrite).toBeDefined();
      expect(JSON.parse(String(cacheWrite![1])).marketplaces[0].source).toEqual(
        { source: "directory", path: "" },
      );
    });

    it("缓存兜底：内置市场标 builtin，只剩在缓存里的市场也列出来", async () => {
      settings({});
      vi.spyOn(service, "getCacheRegistry").mockResolvedValue({
        marketplaces: [
          {
            name: "wave-plugins-official",
            source: {
              source: "github",
              repo: "netease-lcap/wave-plugins-official",
            },
          },
          {
            name: "cached-only",
            source: { source: "directory", path: "/cached" },
          },
        ],
      });

      const marketplaces = await service.listMarketplaces();

      const builtin = marketplaces.filter(
        (marketplace) => marketplace.name === "wave-plugins-official",
      );
      expect(builtin).toHaveLength(1);
      expect(builtin[0].declaredScope).toBe("builtin");
      expect(
        marketplaces.some((marketplace) => marketplace.name === "cached-only"),
      ).toBe(true);
    });

    it("设置里的来源优先于缓存", async () => {
      settings({
        "already-scoped": {
          source: { source: "directory", path: "/scoped" },
        },
      });
      await fs.writeFile(
        path.join(mockPluginsDir, "known_marketplaces.json"),
        JSON.stringify({
          marketplaces: [
            {
              name: "already-scoped",
              source: { source: "directory", path: "/old-path" },
            },
          ],
        }),
      );

      const marketplaces = await service.listMarketplaces();

      const scopedEntry = marketplaces.find(
        (marketplace) => marketplace.name === "already-scoped",
      );
      expect(scopedEntry?.source).toEqual({
        source: "directory",
        path: "/scoped",
      });
    });
  });

  describe("已装插件与市场清单", () => {
    it("已装插件文件只有空白时按空列表处理", async () => {
      await fs.writeFile(
        path.join(mockPluginsDir, "installed_plugins.json"),
        "   \n\t  ",
      );

      const registry = await service.getInstalledPlugins();

      expect(registry.plugins).toHaveLength(0);
    });

    it("清单缺失或缺字段时都拒绝", async () => {
      await expect(
        service.loadMarketplaceManifest("/nonexistent/path"),
      ).rejects.toThrow("Marketplace manifest not found");

      const manifestDir = path.join(mockPluginsDir, "bad-manifest");
      await fs.mkdir(path.join(manifestDir, ".wave-plugin"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(manifestDir, ".wave-plugin", "marketplace.json"),
        JSON.stringify({ bad: "manifest" }),
      );

      await expect(
        service.loadMarketplaceManifest(manifestDir),
      ).rejects.toThrow("Invalid marketplace manifest");
    });
  });

  describe("addMarketplace", () => {
    it("目标目录已存在时不再 clone", async () => {
      manifest({ name: "existing-mkt" });
      await fs.mkdir(
        path.join(mockPluginsDir, "marketplaces", "user", "repo"),
        { recursive: true },
      );

      await service.addMarketplace("user/repo");

      expect(git().clone).not.toHaveBeenCalled();
    });

    // 三处 catch 都是「Error 取 message，其余 String()」，各钉一条实际消息。
    it.each([
      {
        name: "clone 失败",
        input: "https://github.com/user/repo",
        prepare: () => git().clone.mockRejectedValue("string error"),
        message: "Failed to add marketplace from Git: string error",
      },
      {
        name: "克隆后读清单失败",
        input: "https://github.com/user/repo",
        prepare: () => manifest().mockRejectedValue("manifest error"),
        message:
          "Failed to load manifest from cloned repository: manifest error",
      },
      {
        name: "本地目录读清单失败",
        input: "/some/directory",
        prepare: () => manifest().mockRejectedValue("dir manifest error"),
        message: "Failed to load manifest from directory: dir manifest error",
      },
    ])(
      "非 Error 抛出也带上原因（$name）",
      async ({ input, prepare, message }) => {
        prepare();
        await expect(service.addMarketplace(input)).rejects.toThrow(message);
      },
    );
  });

  it("removeMarketplace 找不到归属作用域时按 user 移除", async () => {
    vi.spyOn(config(), "getScopedMarketplaces").mockReturnValue({});

    await service.removeMarketplace("unknown-mkt");

    expect(
      vi.mocked(config().removeMarketplaceFromScope).mock.calls[0][1],
    ).toBe("user");
  });

  describe("updateMarketplace", () => {
    it("只更新指定的那个市场", async () => {
      settings({
        "mkt-one": { source: { source: "directory", path: "/one" } },
        "mkt-two": { source: { source: "directory", path: "/two" } },
      });
      const loadManifest = manifest({ name: "mkt-one" });

      await service.updateMarketplace("mkt-one");

      expect(loadManifest).toHaveBeenCalledTimes(1);
    });

    it("市场不存在时抛错", async () => {
      settings({});

      await expect(service.updateMarketplace("nonexistent")).rejects.toThrow(
        "Marketplace nonexistent not found",
      );
    });

    it("git 不可用时既不拉取也不克隆", async () => {
      settings({
        "git-mkt": { source: { source: "github", repo: "user/repo" } },
      });
      manifest({ name: "git-mkt" });
      git().isGitAvailable.mockResolvedValue(false);

      await service.updateMarketplace("git-mkt");

      expect(git().pull).not.toHaveBeenCalled();
      expect(git().clone).not.toHaveBeenCalled();
    });

    it("本地没有检出时先 clone", async () => {
      settings({
        "git-mkt": { source: { source: "github", repo: "user/repo" } },
      });
      manifest({ name: "git-mkt" });

      await service.updateMarketplace("git-mkt");

      expect(git().clone).toHaveBeenCalled();
    });

    it("updatePlugins 时重装清单里的已装插件", async () => {
      settings({
        "plugin-mkt": { source: { source: "directory", path: "/pmkt" } },
      });
      manifest({
        name: "plugin-mkt",
        plugins: [
          { name: "my-plugin", source: "./plugins/my-plugin", description: "" },
        ],
      });
      vi.spyOn(service, "getInstalledPlugins").mockResolvedValue({
        plugins: [installed("my-plugin", "plugin-mkt")],
      });
      vi.spyOn(service, "installPlugin").mockResolvedValue(
        installed("my-plugin", "plugin-mkt"),
      );

      await service.updateMarketplace("plugin-mkt", { updatePlugins: true });

      expect(vi.mocked(service.installPlugin)).toHaveBeenCalled();
    });

    // 交互界面的「批量更新插件」：只按当前清单升级，不拉检出（spec plugin A-013）
    it("批量更新插件时不刷检出", async () => {
      settings({
        "plugin-mkt": { source: { source: "github", repo: "user/repo" } },
      });
      manifest({
        name: "plugin-mkt",
        plugins: [
          { name: "my-plugin", source: "./plugins/my-plugin", description: "" },
        ],
      });

      const upgraded = installed("my-plugin", "plugin-mkt", "2.0.0");
      vi.spyOn(service, "getInstalledPlugins")
        .mockResolvedValueOnce({
          plugins: [installed("my-plugin", "plugin-mkt")],
        })
        .mockResolvedValue({ plugins: [upgraded] });
      vi.spyOn(service, "installPlugin").mockResolvedValue(upgraded);
      const cacheSpy = vi.spyOn(
        service as unknown as {
          updateCacheMarketplace: () => Promise<void>;
        },
        "updateCacheMarketplace",
      );

      const updated = await service.updateMarketplacePlugins("plugin-mkt");

      expect(updated).toBe(1);
      expect(vi.mocked(service.installPlugin)).toHaveBeenCalled();
      expect(git().pull).not.toHaveBeenCalled();
      expect(git().clone).not.toHaveBeenCalled();
      // 没刷检出就不该把 lastUpdated 顶到当前时间（CLI 市场列表会显示它）
      expect(cacheSpy).not.toHaveBeenCalled();
    });

    it("清单里消失的插件会被卸载", async () => {
      settings({
        "orphan-mkt": { source: { source: "directory", path: "/orphan" } },
      });
      manifest({ name: "orphan-mkt" });
      vi.spyOn(service, "getInstalledPlugins").mockResolvedValue({
        plugins: [installed("orphaned-plugin", "orphan-mkt")],
      });
      vi.spyOn(service, "uninstallPlugin").mockResolvedValue(undefined);

      await service.updateMarketplace("orphan-mkt", { updatePlugins: true });

      expect(vi.mocked(service.uninstallPlugin)).toHaveBeenCalled();
    });

    it("非 Error 的失败也报出来", async () => {
      settings({
        "error-mkt": { source: { source: "directory", path: "/error" } },
      });
      manifest().mockRejectedValue("load error");

      await expect(service.updateMarketplace("error-mkt")).rejects.toThrow(
        'Some marketplaces failed to update:\nFailed to update marketplace "error-mkt": load error',
      );
    });

    it("多个市场失败时汇总成一条错误", async () => {
      settings({
        "fail-one": { source: { source: "directory", path: "/fail1" } },
        "fail-two": { source: { source: "directory", path: "/fail2" } },
      });
      manifest().mockRejectedValue(new Error("boom"));

      await expect(service.updateMarketplace()).rejects.toThrow(
        "Some marketplaces failed to update",
      );
    });
  });

  describe("installPlugin", () => {
    it.each([
      { input: "plugin-only", case: "没有市场名" },
      { input: "@marketplace", case: "没有插件名" },
    ])("插件标识 $case 时抛错", async ({ input }) => {
      await expect(service.installPlugin(input)).rejects.toThrow(
        "Invalid plugin format",
      );
    });

    it("市场不存在时抛错", async () => {
      settings({});

      await expect(
        service.installPlugin("some-plugin@nonexistent-market"),
      ).rejects.toThrow("Marketplace nonexistent-market not found");
    });

    it("清单里没有这个插件时抛错", async () => {
      settings({
        "test-mkt": { source: { source: "directory", path: "/test" } },
      });
      manifest({ name: "test-mkt" });

      await expect(
        service.installPlugin("nonexistent-plugin@test-mkt"),
      ).rejects.toThrow(
        "Plugin nonexistent-plugin not found in marketplace test-mkt",
      );
    });

    it("插件清单回退到 .claude-plugin/plugin.json（CC 生态兼容）", async () => {
      settings({
        "compat-mkt": { source: { source: "directory", path: mockPluginsDir } },
      });
      await fs.mkdir(path.join(mockPluginsDir, ".claude-plugin"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(mockPluginsDir, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "compat-plugin", version: "3.0.0" }),
      );
      manifest({
        name: "compat-mkt",
        plugins: [{ name: "compat-plugin", source: ".", description: "" }],
      });
      await fs.writeFile(
        path.join(mockPluginsDir, "installed_plugins.json"),
        JSON.stringify({ plugins: [] }),
      );
      stubCopyIntoCache();

      const result = await service.installPlugin("compat-plugin@compat-mkt");

      expect(result.version).toBe("3.0.0");
    });

    it("同版本重装时先清掉旧缓存", async () => {
      settings({
        "cache-mkt": { source: { source: "directory", path: mockPluginsDir } },
      });
      await fs.mkdir(path.join(mockPluginsDir, ".wave-plugin"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(mockPluginsDir, ".wave-plugin", "plugin.json"),
        JSON.stringify({ name: "cache-plugin", version: "1.0.0" }),
      );
      manifest({
        name: "cache-mkt",
        plugins: [{ name: "cache-plugin", source: ".", description: "" }],
      });
      const existingCache = path.join(
        mockPluginsDir,
        "cache",
        "cache-mkt",
        "cache-plugin",
        "1.0.0",
      );
      await fs.mkdir(existingCache, { recursive: true });
      await fs.writeFile(path.join(existingCache, "dummy.txt"), "old content");
      await fs.writeFile(
        path.join(mockPluginsDir, "installed_plugins.json"),
        JSON.stringify({ plugins: [] }),
      );
      stubCopyIntoCache();

      await service.installPlugin("cache-plugin@cache-mkt");

      const removed = vi
        .mocked(fs.rm)
        .mock.calls.some((call) => String(call[0]).includes("1.0.0"));
      expect(removed).toBe(true);
    });

    it("重装时更新已装条目而不是追加", async () => {
      settings({
        "update-mkt": {
          source: { source: "directory", path: mockPluginsDir },
        },
      });
      await fs.mkdir(path.join(mockPluginsDir, ".wave-plugin"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(mockPluginsDir, ".wave-plugin", "plugin.json"),
        JSON.stringify({ name: "update-plugin", version: "2.0.0" }),
      );
      manifest({
        name: "update-mkt",
        plugins: [{ name: "update-plugin", source: ".", description: "" }],
      });
      vi.spyOn(service, "getInstalledPlugins").mockResolvedValue({
        plugins: [installed("update-plugin", "update-mkt")],
      });
      stubCopyIntoCache();

      const result = await service.installPlugin("update-plugin@update-mkt", {
        scope: "project",
        projectPath: "/project",
      });

      const installedSaves = vi
        .mocked(fs.writeFile)
        .mock.calls.filter((call) =>
          String(call[0]).includes("installed_plugins.json"),
        );
      const saved = JSON.parse(String(installedSaves.at(-1)![1]));
      // 已被 1.0.0 占着的那条要被改写，而不是多出一条
      expect(saved.plugins).toHaveLength(1);
      expect(saved.plugins[0].version).toBe("2.0.0");
      expect(result.version).toBe("2.0.0");
    });
  });
});

describe("MarketplaceService - Builtin Seeding", () => {
  const mockPluginsDir = path.join(process.cwd(), "tmp-test-plugins-seed");
  const knownMarketplacesPath = path.join(
    mockPluginsDir,
    "known_marketplaces.json",
  );

  beforeEach(async () => {
    // Re-establish fs mock implementations after previous describe's restoreAllMocks
    const actualFs = await vi.importActual<typeof import("fs")>("fs");
    vi.mocked(fs.writeFile).mockImplementation(
      actualFs.promises.writeFile as unknown as typeof fs.writeFile,
    );
    vi.mocked(fs.readFile).mockImplementation(
      actualFs.promises.readFile as unknown as typeof fs.readFile,
    );
    vi.mocked(fs.rename).mockImplementation(
      actualFs.promises.rename as unknown as typeof fs.rename,
    );
    vi.mocked(fs.mkdir).mockImplementation(
      actualFs.promises.mkdir as unknown as typeof fs.mkdir,
    );
    vi.mocked(fs.rm).mockImplementation(
      actualFs.promises.rm as unknown as typeof fs.rm,
    );
    vi.mocked(existsSync).mockImplementation(
      actualFs.existsSync as typeof existsSync,
    );

    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPluginsDir).mockReturnValue(mockPluginsDir);
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
  });

  function createService(): MarketplaceService {
    const svc = new MarketplaceService();
    vi.spyOn(
      svc["gitService"] as unknown as {
        isGitAvailable: () => Promise<boolean>;
      },
      "isGitAvailable",
    ).mockResolvedValue(true);
    vi.spyOn(
      svc["gitService"] as unknown as { clone: () => Promise<void> },
      "clone",
    ).mockResolvedValue();
    vi.spyOn(
      svc["gitService"] as unknown as { pull: () => Promise<void> },
      "pull",
    ).mockResolvedValue();
    vi.mocked(fs.open).mockResolvedValue({
      close: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof fs.open>>);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
    return svc;
  }

  it("should seed builtin on first run when no cache exists", async () => {
    // No cache file exists — constructor should trigger seeding
    const service = createService();

    // Wait for async seed to complete
    await vi.waitFor(
      async () => {
        const registry = await service.getCacheRegistry();
        expect(registry?.builtinSeeded).toBe(true);
      },
      { timeout: 2000 },
    );

    // Verify addMarketplaceToScope was called for the builtin
    expect(
      vi.mocked(
        (service["configurationService"] as ConfigurationService)
          .addMarketplaceToScope,
      ),
    ).toHaveBeenCalledWith(
      expect.any(String),
      "user",
      "wave-plugins-official",
      expect.objectContaining({
        source: {
          source: "github",
          repo: "netease-lcap/wave-plugins-official",
        },
      }),
    );

    // Verify cache has the builtin entry
    const registry = await service.getCacheRegistry();
    expect(registry?.builtinSeeded).toBe(true);
    expect(
      registry?.marketplaces.some((m) => m.name === "wave-plugins-official"),
    ).toBe(true);
  });

  it("should not re-seed when cache already has builtinSeeded true", async () => {
    // Pre-write cache with builtinSeeded: true
    await fs.mkdir(mockPluginsDir, { recursive: true });
    await fs.writeFile(
      knownMarketplacesPath,
      JSON.stringify({
        builtinSeeded: true,
        marketplaces: [
          {
            name: "wave-plugins-official",
            source: {
              source: "github",
              repo: "netease-lcap/wave-plugins-official",
            },
          },
        ],
      }),
    );

    const service = createService();

    // Wait for the seed to complete (it should return early)
    await (service as unknown as { _seedComplete: Promise<void> })
      ._seedComplete;

    // addMarketplaceToScope should NOT have been called for the builtin
    expect(
      vi.mocked(
        (service["configurationService"] as ConfigurationService)
          .addMarketplaceToScope,
      ),
    ).not.toHaveBeenCalledWith(
      expect.any(String),
      "user",
      "wave-plugins-official",
      expect.anything(),
    );
  });

  it("should not re-seed after builtin removal", async () => {
    // Pre-write cache with builtinSeeded: true and the builtin entry
    await fs.mkdir(mockPluginsDir, { recursive: true });
    await fs.writeFile(
      knownMarketplacesPath,
      JSON.stringify({
        builtinSeeded: true,
        marketplaces: [
          {
            name: "wave-plugins-official",
            source: {
              source: "github",
              repo: "netease-lcap/wave-plugins-official",
            },
          },
        ],
      }),
    );

    const service1 = createService();

    // Remove builtin from cache
    await (
      service1 as unknown as {
        removeFromCache: (name: string) => Promise<void>;
      }
    ).removeFromCache("wave-plugins-official");

    // Verify it was removed
    const registry = await service1.getCacheRegistry();
    expect(
      registry?.marketplaces.some((m) => m.name === "wave-plugins-official"),
    ).toBe(false);
    // But builtinSeeded flag should still be true
    expect(registry?.builtinSeeded).toBe(true);

    // Construct a new service — should NOT re-seed
    const service2 = createService();
    await (service2 as unknown as { _seedComplete: Promise<void> })
      ._seedComplete;

    expect(
      vi.mocked(
        (service2["configurationService"] as ConfigurationService)
          .addMarketplaceToScope,
      ),
    ).not.toHaveBeenCalledWith(
      expect.any(String),
      "user",
      "wave-plugins-official",
      expect.anything(),
    );
  });

  it("should seed when cache exists but builtinSeeded is undefined", async () => {
    // Pre-write cache WITHOUT builtinSeeded flag
    await fs.mkdir(mockPluginsDir, { recursive: true });
    await fs.writeFile(
      knownMarketplacesPath,
      JSON.stringify({
        marketplaces: [
          {
            name: "some-other-mkt",
            source: { source: "directory", path: "/some/path" },
          },
        ],
      }),
    );

    const service = createService();

    // Wait for async seed to complete
    await vi.waitFor(
      async () => {
        const registry = await service.getCacheRegistry();
        expect(registry?.builtinSeeded).toBe(true);
      },
      { timeout: 2000 },
    );

    // addMarketplaceToScope should have been called for the builtin
    expect(
      vi.mocked(
        (service["configurationService"] as ConfigurationService)
          .addMarketplaceToScope,
      ),
    ).toHaveBeenCalledWith(
      expect.any(String),
      "user",
      "wave-plugins-official",
      expect.anything(),
    );

    // Cache should now have both entries and the flag
    const registry = await service.getCacheRegistry();
    expect(registry?.builtinSeeded).toBe(true);
    expect(
      registry?.marketplaces.some((m) => m.name === "wave-plugins-official"),
    ).toBe(true);
    expect(
      registry?.marketplaces.some((m) => m.name === "some-other-mkt"),
    ).toBe(true);
  });

  it("should preserve builtinSeeded flag when removeFromCache is called", async () => {
    // Pre-write cache with builtinSeeded: true and multiple entries
    await fs.mkdir(mockPluginsDir, { recursive: true });
    await fs.writeFile(
      knownMarketplacesPath,
      JSON.stringify({
        builtinSeeded: true,
        marketplaces: [
          {
            name: "wave-plugins-official",
            source: {
              source: "github",
              repo: "netease-lcap/wave-plugins-official",
            },
          },
          {
            name: "custom-mkt",
            source: { source: "directory", path: "/custom" },
          },
        ],
      }),
    );

    const service = createService();

    // Remove one entry from cache
    await (
      service as unknown as {
        removeFromCache: (name: string) => Promise<void>;
      }
    ).removeFromCache("custom-mkt");

    // Read back the written file and verify builtinSeeded is preserved
    const registry = await service.getCacheRegistry();
    expect(registry?.builtinSeeded).toBe(true);
    expect(registry?.marketplaces).toHaveLength(1);
    expect(registry?.marketplaces[0].name).toBe("wave-plugins-official");
  });
});
