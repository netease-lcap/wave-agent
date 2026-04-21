import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import * as fsModule from "fs";
const fs = fsModule.promises;
const { existsSync } = fsModule;
import * as path from "path";
import { getPluginsDir } from "../../src/utils/configPaths.js";

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
    },
  };
});

vi.mock("../../src/utils/configPaths.js", () => ({
  getPluginsDir: vi.fn(),
}));

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
