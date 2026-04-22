import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import * as fsModule from "fs";
const fs = fsModule.promises;
const { existsSync } = fsModule;
import * as path from "path";
import { getPluginsDir } from "../../src/utils/configPaths.js";
import type { ConfigurationService } from "../../src/services/configurationService.js";

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
    service = new MarketplaceService();
    // Reset static variable
    (
      MarketplaceService as unknown as { isLockedInProcess: boolean }
    ).isLockedInProcess = false;
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
    vi.restoreAllMocks();
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
  });

  it("should return the builtin marketplace when no config file exists", async () => {
    const registry = await service.getKnownMarketplaces();
    expect(registry.marketplaces).toHaveLength(1);
    expect(registry.marketplaces[0].name).toBe("wave-plugins-official");
    expect(registry.marketplaces[0].isBuiltin).toBe(true);
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

  it("should persist builtin marketplace when adding a custom one for the first time", async () => {
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

    // listMarketplaces combines scoped settings + builtin
    const marketplaces = await service.listMarketplaces();
    expect(marketplaces.length).toBeGreaterThan(0);
    expect(
      marketplaces.some(
        (m) => m.name === "wave-plugins-official" && m.isBuiltin,
      ),
    ).toBe(true);
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
    expect(result).toContain("user/repo");
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
    expect(registry.marketplaces).toHaveLength(1);
    expect(registry.marketplaces[0].isBuiltin).toBe(true);
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

  it("should update existing marketplace with same name", async () => {
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
    // Add again - should update
    const added = await service.addMarketplace("https://github.com/user/repo");
    expect(added.name).toBe("custom-mkt");

    const registry = await service.getKnownMarketplaces();
    const customMkt = registry.marketplaces.find(
      (m) => m.name === "custom-mkt",
    );
    expect(customMkt).toBeDefined();
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
    service = new MarketplaceService();
    (
      MarketplaceService as unknown as { isLockedInProcess: boolean }
    ).isLockedInProcess = false;

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
    vi.restoreAllMocks();
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
  });

  it("should list marketplaces from scoped settings", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "my-marketplace": {
        source: { source: "github", repo: "user/repo" },
        autoUpdate: true,
      },
    });

    const marketplaces = await service.listMarketplaces();
    expect(marketplaces).toHaveLength(2); // builtin + custom
    expect(marketplaces[0].name).toBe("wave-plugins-official");
    expect(marketplaces[1].name).toBe("my-marketplace");
  });

  it("should list marketplaces combining scoped settings with cache fallback", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "scoped-mkt": {
        source: { source: "directory", path: "/scoped/path" },
        autoUpdate: false,
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
            autoUpdate: false,
          },
          {
            name: "scoped-mkt", // already in settings, should not duplicate
            source: { source: "directory", path: "/old/path" },
          },
          {
            name: "wave-plugins-official", // builtin in cache, should skip
            source: {
              source: "github",
              repo: "netease-lcap/wave-plugins-official",
            },
          },
        ],
      }),
    );

    const marketplaces = await service.listMarketplaces();
    // builtin + scoped-mkt(from settings) + cached-mkt(from cache fallback)
    expect(marketplaces).toHaveLength(3);
    expect(marketplaces.some((m) => m.name === "cached-mkt")).toBe(true);
  });

  it("should return declaring scope for a marketplace", () => {
    vi.spyOn(service["configurationService"], "getScopedMarketplaces")
      .mockReturnValueOnce({})
      .mockReturnValueOnce({})
      .mockReturnValueOnce({
        "test-mkt": {
          source: { source: "directory", path: "/test" },
          autoUpdate: false,
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
        autoUpdate: false,
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

  it("should throw when trying to remove builtin marketplace", async () => {
    await expect(
      service.removeMarketplace("wave-plugins-official"),
    ).rejects.toThrow("Cannot remove built-in marketplace");
  });

  it("should remove marketplace with inferred scope", async () => {
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({
      "test-mkt": {
        source: { source: "directory", path: "/test" },
        autoUpdate: false,
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
        autoUpdate: true,
      },
    });

    const marketplaces = await service.listMarketplaces();
    // Should only have one builtin entry
    const builtinCount = marketplaces.filter((m) => m.isBuiltin).length;
    expect(builtinCount).toBe(1);
  });

  it("should toggle auto-update for a marketplace", async () => {
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({
      "test-mkt": {
        source: { source: "directory", path: "/test" },
        autoUpdate: false,
      },
    });

    await service.toggleAutoUpdate("test-mkt", true);
    expect(
      vi.mocked(
        (service["configurationService"] as ConfigurationService)
          .addMarketplaceToScope,
      ),
    ).toHaveBeenCalled();
  });

  it("should throw when toggling auto-update for builtin", async () => {
    await expect(
      service.toggleAutoUpdate("wave-plugins-official", true),
    ).rejects.toThrow("Marketplace wave-plugins-official not found");
  });

  it("should throw when toggling auto-update for unknown marketplace", async () => {
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({});

    await expect(service.toggleAutoUpdate("unknown-mkt", true)).rejects.toThrow(
      "Marketplace unknown-mkt not found",
    );
  });

  it("should auto-update marketplaces with autoUpdate enabled", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "auto-mkt": {
        source: { source: "directory", path: "/auto" },
        autoUpdate: true,
      },
      "no-auto-mkt": {
        source: { source: "directory", path: "/noauto" },
        autoUpdate: false,
      },
    });

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "auto-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    await service.autoUpdateAll();
    // Should have attempted to update auto-mkt
    expect(vi.mocked(fs.writeFile).mock.calls.length).toBeGreaterThan(0);
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
        autoUpdate: false,
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

describe("MarketplaceService - Coverage Targets", () => {
  let service: MarketplaceService;
  const mockPluginsDir = path.join(process.cwd(), "tmp-test-plugins-coverage");

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPluginsDir).mockReturnValue(mockPluginsDir);
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
    service = new MarketplaceService();
    (
      MarketplaceService as unknown as { isLockedInProcess: boolean }
    ).isLockedInProcess = false;

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
    vi.restoreAllMocks();
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
  });

  // Line 105: migration skip for builtin marketplace
  it("should skip builtin marketplace during migration", async () => {
    // Mock fs.readFile for known_marketplaces
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

    // Mock scoped settings as empty so migration triggers
    const addScopeMock = vi
      .spyOn(service["configurationService"], "addMarketplaceToScope")
      .mockClear();
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({});
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({});

    // Call runMigration manually to test the branch
    await (
      service as unknown as { runMigration: () => Promise<void> }
    ).runMigration();

    // Migration should have called addMarketplaceToScope for old-mkt but NOT builtin
    const addCalls = addScopeMock.mock.calls;
    const oldMktCalls = addCalls.filter((c) => c[2] === "old-mkt");
    const builtinCalls = addCalls.filter(
      (c) => c[2] === "wave-plugins-official",
    );
    expect(oldMktCalls).toHaveLength(1);
    expect(builtinCalls).toHaveLength(0);
  });

  // Line 268: updateCacheMarketplace default source fallback
  // This is triggered when updateCacheMarketplace adds a new entry without a source
  // e.g., updateMarketplace calling updateCacheMarketplace with only lastUpdated
  // for a marketplace not yet in the cache
  it("should use default source fallback when updating cache for unknown marketplace", async () => {
    // Ensure no cache file exists
    const knownPath = path.join(mockPluginsDir, "known_marketplaces.json");
    if (fsModule.existsSync(knownPath)) {
      await fs.rm(knownPath, { force: true });
    }

    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "unknown-cache-mkt": {
        source: { source: "directory", path: "/unknown" },
        autoUpdate: false,
      },
    });
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({});

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "unknown-cache-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    // Clear any previous writeFile mock calls
    vi.mocked(fs.writeFile).mockClear();

    // Marketplace is not in the cache (no known_marketplaces.json)
    await service.updateMarketplace("unknown-cache-mkt");

    // Verify writeFile was called for cache update
    const writeCalls = vi.mocked(fs.writeFile).mock.calls;
    const cacheWriteCall = writeCalls.find((c) =>
      String(c[0]).includes("known_marketplaces.json.tmp"),
    );
    expect(cacheWriteCall).toBeDefined();
    const cached = JSON.parse(String(cacheWriteCall![1]));
    // Since updateCacheMarketplace was called with only { lastUpdated },
    // it should use the default source fallback
    expect(cached.marketplaces[0].source).toEqual({
      source: "directory",
      path: "",
    });
  });

  // Line 301: getInstalledPlugins empty content handling
  it("should return empty plugins when file has only whitespace", async () => {
    const installedPath = path.join(mockPluginsDir, "installed_plugins.json");
    await fs.writeFile(installedPath, "   \n\t  ");

    const registry = await service.getInstalledPlugins();
    expect(registry.plugins).toHaveLength(0);
  });

  // Line 333: loadMarketplaceManifest not found
  it("should throw when manifest file does not exist", async () => {
    await expect(
      service.loadMarketplaceManifest("/nonexistent/path"),
    ).rejects.toThrow("Marketplace manifest not found");
  });

  // Line 339: loadMarketplaceManifest invalid manifest
  it("should throw when manifest is missing required fields", async () => {
    const tempDir = path.join(mockPluginsDir, "bad-manifest");
    const manifestDir = path.join(tempDir, ".wave-plugin");
    await fs.mkdir(manifestDir, { recursive: true });
    await fs.writeFile(
      path.join(manifestDir, "marketplace.json"),
      JSON.stringify({ bad: "manifest" }),
    );

    await expect(service.loadMarketplaceManifest(tempDir)).rejects.toThrow(
      "Invalid marketplace manifest",
    );
  });

  // Line 376: buildMarketplaceEntry autoUpdate fallback
  it("should fall back to cache autoUpdate when config has none", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "fallback-auto-mkt": {
        source: { source: "directory", path: "/fallback" },
        // no autoUpdate set
      },
    });

    // Use getCacheRegistry mock instead of readFile
    vi.spyOn(service, "getCacheRegistry").mockResolvedValue({
      marketplaces: [
        {
          name: "fallback-auto-mkt",
          source: { source: "directory", path: "/fallback" },
          autoUpdate: true,
        },
      ],
    });

    const marketplaces = await service.listMarketplaces();
    const entry = marketplaces.find((m) => m.name === "fallback-auto-mkt");
    expect(entry?.autoUpdate).toBe(true);
  });

  // Line 435: addMarketplace existsSync check for target path (exists already)
  it("should skip clone when target path already exists", async () => {
    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "existing-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    // Create the target directory so existsSync returns true
    const targetPath = path.join(
      mockPluginsDir,
      "marketplaces",
      "user",
      "repo",
    );
    await fs.mkdir(targetPath, { recursive: true });

    await service.addMarketplace("user/repo");

    // Clone should not be called since path exists
    expect(
      vi.mocked(
        service["gitService"] as unknown as { clone: () => Promise<void> },
      ).clone,
    ).not.toHaveBeenCalled();
  });

  // Line 440, 450, 469: error message cond-expr (non-Error thrown)
  it("should handle non-Error thrown during git clone in addMarketplace", async () => {
    vi.spyOn(
      service["gitService"] as unknown as { clone: () => Promise<void> },
      "clone",
    ).mockRejectedValue("string error");

    await expect(
      service.addMarketplace("https://github.com/user/repo"),
    ).rejects.toThrow("Failed to add marketplace from Git: string error");
  });

  it("should handle non-Error thrown during manifest load in addMarketplace (git)", async () => {
    vi.spyOn(
      service["gitService"] as unknown as { clone: () => Promise<void> },
      "clone",
    ).mockResolvedValue();
    vi.spyOn(
      service,
      "loadMarketplaceManifest" as keyof MarketplaceService,
    ).mockRejectedValue("manifest error");

    await expect(
      service.addMarketplace("https://github.com/user/repo"),
    ).rejects.toThrow(
      "Failed to load manifest from cloned repository: manifest error",
    );
  });

  it("should handle non-Error thrown during manifest load in addMarketplace (directory)", async () => {
    vi.spyOn(
      service,
      "loadMarketplaceManifest" as keyof MarketplaceService,
    ).mockRejectedValue("dir manifest error");

    await expect(service.addMarketplace("/some/directory")).rejects.toThrow(
      "Failed to load manifest from directory: dir manifest error",
    );
  });

  // Line 540-541: listMarketplaces cache fallback skip conditions
  it("should skip builtin marketplace in cache fallback iteration", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({});

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
    const builtinEntries = marketplaces.filter(
      (m) => m.name === "wave-plugins-official",
    );
    expect(builtinEntries).toHaveLength(1);
    expect(builtinEntries[0].declaredScope).toBe("builtin");
    expect(marketplaces.some((m) => m.name === "cached-only")).toBe(true);
  });

  it("should skip cache entries that are already in scoped settings", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "already-scoped": {
        source: { source: "directory", path: "/scoped" },
        autoUpdate: true,
      },
    });

    const knownPath = path.join(mockPluginsDir, "known_marketplaces.json");
    await fs.writeFile(
      knownPath,
      JSON.stringify({
        marketplaces: [
          {
            name: "already-scoped",
            source: { source: "directory", path: "/old-path" },
            autoUpdate: false,
          },
        ],
      }),
    );

    const marketplaces = await service.listMarketplaces();
    const scopedEntries = marketplaces.filter(
      (m) => m.name === "already-scoped",
    );
    expect(scopedEntries).toHaveLength(1);
    expect(scopedEntries[0].autoUpdate).toBe(true); // from settings, not cache
  });

  // Line 558: removeMarketplace scope inference fallback
  it("should fallback to user scope when marketplace not found in any scope", async () => {
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({});

    await service.removeMarketplace("unknown-mkt");
    expect(
      vi.mocked(
        (service["configurationService"] as ConfigurationService)
          .removeMarketplaceFromScope,
      ).mock.calls[0][1],
    ).toBe("user");
  });

  // Line 584: updateMarketplace filtering by name
  it("should update only the specified marketplace by name", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "mkt-one": {
        source: { source: "directory", path: "/one" },
        autoUpdate: false,
      },
      "mkt-two": {
        source: { source: "directory", path: "/two" },
        autoUpdate: false,
      },
    });

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "mkt-one",
      owner: { name: "test" },
      plugins: [],
    });

    await service.updateMarketplace("mkt-one");

    // Only mkt-one should have been loaded
    expect(
      vi.mocked(
        service["loadMarketplaceManifest"] as unknown as ReturnType<
          typeof vi.fn
        >,
      ).mock.calls.length,
    ).toBe(1);
  });

  // Line 588: updateMarketplace not found
  it("should throw when named marketplace is not found", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({});

    await expect(service.updateMarketplace("nonexistent")).rejects.toThrow(
      "Marketplace nonexistent not found",
    );
  });

  // Line 600: skip update when git not available
  it("should skip git marketplace update when git is not available", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "git-mkt": {
        source: { source: "github", repo: "user/repo" },
        autoUpdate: false,
      },
    });

    vi.spyOn(
      service["gitService"] as unknown as {
        isGitAvailable: () => Promise<boolean>;
      },
      "isGitAvailable",
    ).mockResolvedValue(false);

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "git-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    await service.updateMarketplace("git-mkt");

    // pull and clone should not be called
    expect(
      vi.mocked(
        service["gitService"] as unknown as { pull: () => Promise<void> },
      ).pull,
    ).not.toHaveBeenCalled();
    expect(
      vi.mocked(
        service["gitService"] as unknown as { clone: () => Promise<void> },
      ).clone,
    ).not.toHaveBeenCalled();
  });

  // Line 607-621: clone if target doesn't exist
  it("should clone marketplace if target path does not exist during update", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "git-mkt": {
        source: { source: "github", repo: "user/repo" },
        autoUpdate: false,
      },
    });

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "git-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    // Ensure the marketplace path does NOT exist
    const targetPath = path.join(
      mockPluginsDir,
      "marketplaces",
      "user",
      "repo",
    );
    // Make sure it doesn't exist (clean up if needed)
    if (fsModule.existsSync(targetPath)) {
      await fs.rm(targetPath, { recursive: true, force: true });
    }

    await service.updateMarketplace("git-mkt");

    expect(
      vi.mocked(
        service["gitService"] as unknown as { clone: () => Promise<void> },
      ).clone,
    ).toHaveBeenCalled();
  });

  // Line 634: updatePlugins option branch
  it("should update plugins when updatePlugins option is true", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "plugin-mkt": {
        source: { source: "directory", path: "/pmkt" },
        autoUpdate: false,
      },
    });

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "plugin-mkt",
      owner: { name: "test" },
      plugins: [
        { name: "my-plugin", source: "./plugins/my-plugin", description: "" },
      ],
    });

    // Mock getInstalledPlugins to return an installed plugin
    vi.spyOn(service, "getInstalledPlugins").mockResolvedValue({
      plugins: [
        {
          name: "my-plugin",
          marketplace: "plugin-mkt",
          version: "1.0.0",
          cachePath: "/cache/my-plugin",
          projectPath: "/project",
        },
      ],
    });

    // Mock installPlugin
    vi.spyOn(service, "installPlugin").mockResolvedValue({
      name: "my-plugin",
      marketplace: "plugin-mkt",
      version: "1.0.0",
      cachePath: "/cache/my-plugin",
      projectPath: "/project",
    });

    await service.updateMarketplace("plugin-mkt", { updatePlugins: true });

    expect(vi.mocked(service.installPlugin)).toHaveBeenCalled();
  });

  // Line 643: plugin no longer found in marketplace
  it("should uninstall orphaned plugin when no longer in marketplace", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "orphan-mkt": {
        source: { source: "directory", path: "/orphan" },
        autoUpdate: false,
      },
    });

    // Manifest has no plugins
    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "orphan-mkt",
      owner: { name: "test" },
      plugins: [],
    });

    // Mock getInstalledPlugins to return an orphaned plugin
    vi.spyOn(service, "getInstalledPlugins").mockResolvedValue({
      plugins: [
        {
          name: "orphaned-plugin",
          marketplace: "orphan-mkt",
          version: "1.0.0",
          cachePath: "/cache/orphaned-plugin",
          projectPath: "/project",
        },
      ],
    });

    vi.spyOn(service, "uninstallPlugin").mockResolvedValue(undefined);

    await service.updateMarketplace("orphan-mkt", { updatePlugins: true });

    expect(vi.mocked(service.uninstallPlugin)).toHaveBeenCalled();
  });

  // Line 674: error message cond-expr in updateMarketplace
  it("should handle non-Error during updateMarketplace", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "error-mkt": {
        source: { source: "directory", path: "/error" },
        autoUpdate: false,
      },
    });

    vi.spyOn(service, "loadMarketplaceManifest").mockRejectedValue(
      "load error",
    );

    await expect(service.updateMarketplace("error-mkt")).rejects.toThrow(
      'Some marketplaces failed to update:\nFailed to update marketplace "error-mkt": load error',
    );
  });

  // Line 680: errors array throw
  it("should throw when multiple marketplaces fail to update", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "fail-one": {
        source: { source: "directory", path: "/fail1" },
        autoUpdate: false,
      },
      "fail-two": {
        source: { source: "directory", path: "/fail2" },
        autoUpdate: false,
      },
    });

    vi.spyOn(service, "loadMarketplaceManifest").mockRejectedValue(
      new Error("boom"),
    );

    await expect(service.updateMarketplace()).rejects.toThrow(
      "Some marketplaces failed to update",
    );
  });

  // Line 720, 729: toggleAutoUpdate not found branches
  it("should throw when declaringSource is null for toggleAutoUpdate", async () => {
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({});

    await expect(service.toggleAutoUpdate("nonexistent", true)).rejects.toThrow(
      "Marketplace nonexistent not found",
    );
  });

  it("should throw when config is missing for toggleAutoUpdate", async () => {
    // This tests the case where declaringSource exists but config[name] doesn't
    // Override getMarketplaceDeclaringSource to return "user"
    vi.spyOn(service, "getMarketplaceDeclaringSource").mockReturnValue("user");
    // But user scope doesn't have the marketplace
    vi.spyOn(
      service["configurationService"],
      "getScopedMarketplaces",
    ).mockReturnValue({});

    await expect(service.toggleAutoUpdate("ghost-mkt", true)).rejects.toThrow(
      "Marketplace ghost-mkt not found",
    );
  });

  // Line 755: installPlugin invalid format (no marketplace)
  it("should throw when installPlugin has no marketplace", async () => {
    await expect(service.installPlugin("plugin-only")).rejects.toThrow(
      "Invalid plugin format",
    );
  });

  it("should throw when installPlugin has no plugin name", async () => {
    await expect(service.installPlugin("@marketplace")).rejects.toThrow(
      "Invalid plugin format",
    );
  });

  // Line 761: installPlugin marketplace not found
  it("should throw when marketplace is not found for installPlugin", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({});

    await expect(
      service.installPlugin("some-plugin@nonexistent-market"),
    ).rejects.toThrow("Marketplace nonexistent-market not found");
  });

  // Line 768: installPlugin plugin not found in manifest
  it("should throw when plugin is not found in marketplace manifest", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "test-mkt": {
        source: { source: "directory", path: "/test" },
        autoUpdate: false,
      },
    });

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "test-mkt",
      owner: { name: "test" },
      plugins: [], // no plugins
    });

    await expect(
      service.installPlugin("nonexistent-plugin@test-mkt"),
    ).rejects.toThrow(
      "Plugin nonexistent-plugin not found in marketplace test-mkt",
    );
  });

  // Line 831: installPlugin cache exists and rm
  it("should remove existing cache when installing same version again", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "cache-mkt": {
        source: { source: "directory", path: mockPluginsDir },
        autoUpdate: false,
      },
    });

    // Plugin manifest in the mock plugins dir
    const pluginDir = path.join(mockPluginsDir, ".wave-plugin");
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({ name: "cache-plugin", version: "1.0.0" }),
    );

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "cache-mkt",
      owner: { name: "test" },
      plugins: [{ name: "cache-plugin", source: ".", description: "" }],
    });

    // Pre-existing cache
    const existingCache = path.join(
      mockPluginsDir,
      "cache",
      "cache-mkt",
      "cache-plugin",
      "1.0.0",
    );
    await fs.mkdir(existingCache, { recursive: true });
    await fs.writeFile(path.join(existingCache, "dummy.txt"), "old content");

    // Mock installed plugins file
    const installedPath = path.join(mockPluginsDir, "installed_plugins.json");
    await fs.writeFile(installedPath, JSON.stringify({ plugins: [] }));

    // Mock fs.cp and fs.rename
    vi.mocked(fs.cp).mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof fs.cp>>,
    );
    vi.mocked(fs.rename).mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof fs.rename>>,
    );

    await service.installPlugin("cache-plugin@cache-mkt");

    // rm should have been called to remove the old cache
    const rmCalls = vi.mocked(fs.rm).mock.calls;
    const cacheRmCall = rmCalls.find(
      (c) => typeof c[0] === "string" && c[0].includes("1.0.0"),
    );
    expect(cacheRmCall).toBeDefined();
  });

  // Line 853: installPlugin existing plugin update vs new push
  it("should update existing plugin entry when reinstalling", async () => {
    vi.spyOn(
      service["configurationService"],
      "getMergedMarketplaces",
    ).mockReturnValue({
      "update-mkt": {
        source: { source: "directory", path: mockPluginsDir },
        autoUpdate: false,
      },
    });

    // Plugin manifest in the mock plugins dir
    const pluginDir = path.join(mockPluginsDir, ".wave-plugin");
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({ name: "update-plugin", version: "2.0.0" }),
    );

    vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
      name: "update-mkt",
      owner: { name: "test" },
      plugins: [{ name: "update-plugin", source: ".", description: "" }],
    });

    // Mock getInstalledPlugins to return existing entry
    vi.spyOn(service, "getInstalledPlugins").mockResolvedValue({
      plugins: [
        {
          name: "update-plugin",
          marketplace: "update-mkt",
          version: "1.0.0",
          cachePath: "/old/cache/path",
          projectPath: "/project",
        },
      ],
    });

    // Mock existsSync to return true for the plugin manifest
    vi.mocked(existsSync).mockImplementation((p: import("fs").PathLike) => {
      const str = String(p);
      if (str.includes(".wave-plugin/plugin.json")) return true;
      if (str.startsWith(mockPluginsDir)) return true;
      return false;
    });

    // Mock fs.cp and fs.rename
    vi.mocked(fs.cp).mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof fs.cp>>,
    );
    vi.mocked(fs.rename).mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof fs.rename>>,
    );

    const result = await service.installPlugin(
      "update-plugin@update-mkt",
      "/project",
    );

    // Should have saved installed plugins - the entry should be updated not pushed
    const saveCalls = vi.mocked(fs.writeFile).mock.calls;
    const installedSaveCalls = saveCalls.filter((c) =>
      String(c[0]).includes("installed_plugins.json"),
    );
    const installedSaveCall = installedSaveCalls[installedSaveCalls.length - 1];
    expect(installedSaveCall).toBeDefined();
    const saved = JSON.parse(String(installedSaveCall[1]));
    // Should still be 1 entry (updated), not 2 (pushed)
    expect(saved.plugins).toHaveLength(1);
    expect(saved.plugins[0].version).toBe("2.0.0");
    expect(result.version).toBe("2.0.0");
  });
});
