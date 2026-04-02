import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { KnownMarketplace } from "../../src/types/marketplace.js";
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
    } as never);

    await service.addMarketplace("./some-path");

    const registry = await service.getKnownMarketplaces();
    expect(registry.marketplaces).toHaveLength(2);
    expect(
      registry.marketplaces.find((m) => m.name === "wave-plugins-official"),
    ).toBeDefined();
    expect(
      registry.marketplaces.find((m) => m.name === "custom-mkt"),
    ).toBeDefined();
  });

  it("should allow removing the builtin marketplace", async () => {
    // First, it's there by default
    let registry = await service.getKnownMarketplaces();
    expect(
      registry.marketplaces.find((m) => m.name === "wave-plugins-official"),
    ).toBeDefined();

    // Remove it
    await service.removeMarketplace("wave-plugins-official");

    // Now it should be gone and config file should exist
    registry = await service.getKnownMarketplaces();
    expect(
      registry.marketplaces.find((m) => m.name === "wave-plugins-official"),
    ).toBeUndefined();
    expect(
      existsSync(path.join(mockPluginsDir, "known_marketplaces.json")),
    ).toBe(true);
  });

  describe("Auto-Update Support", () => {
    it("should have autoUpdate: true for builtin marketplace", async () => {
      const registry = await service.getKnownMarketplaces();
      expect(registry.marketplaces[0].autoUpdate).toBe(true);
    });

    it("should have autoUpdate: false for newly added marketplaces", async () => {
      vi.spyOn(
        service,
        "loadMarketplaceManifest" as keyof MarketplaceService,
      ).mockResolvedValue({
        name: "custom-mkt",
        owner: { name: "test" },
        plugins: [],
      } as never);

      await service.addMarketplace("./some-path");
      const registry = await service.getKnownMarketplaces();
      const custom = registry.marketplaces.find((m) => m.name === "custom-mkt");
      expect(custom?.autoUpdate).toBe(false);
    });

    it("should toggle autoUpdate", async () => {
      await service.toggleAutoUpdate("wave-plugins-official", false);
      let registry = await service.getKnownMarketplaces();
      expect(registry.marketplaces[0].autoUpdate).toBe(false);

      await service.toggleAutoUpdate("wave-plugins-official", true);
      registry = await service.getKnownMarketplaces();
      expect(registry.marketplaces[0].autoUpdate).toBe(true);
    });

    it("should call updateMarketplace with updatePlugins: true in autoUpdateAll", async () => {
      const updateSpy = vi
        .spyOn(service, "updateMarketplace")
        .mockResolvedValue();

      // Builtin has autoUpdate: true by default
      await service.autoUpdateAll();

      expect(updateSpy).toHaveBeenCalledWith("wave-plugins-official", {
        updatePlugins: true,
      });
    });

    it("should update plugins when updatePlugins: true is passed to updateMarketplace", async () => {
      // Mock getInstalledPlugins to return a plugin from the marketplace
      vi.spyOn(service, "getInstalledPlugins").mockResolvedValue({
        plugins: [
          {
            name: "test-plugin",
            marketplace: "wave-plugins-official",
            version: "1.0.0",
            cachePath: "/some/path",
          },
        ],
      });

      const installSpy = vi
        .spyOn(service, "installPlugin")
        .mockResolvedValue({} as never);
      vi.spyOn(
        service,
        "loadMarketplaceManifest" as keyof MarketplaceService,
      ).mockResolvedValue({
        name: "wave-plugins-official",
        owner: { name: "test" },
        plugins: [
          { name: "test-plugin", source: "./test", description: "test" },
        ],
      } as never);

      await service.updateMarketplace("wave-plugins-official", {
        updatePlugins: true,
      });

      expect(installSpy).toHaveBeenCalledWith(
        "test-plugin@wave-plugins-official",
        undefined,
      );
    });

    it("should uninstall orphaned plugins when updatePlugins: true is passed to updateMarketplace", async () => {
      // Mock getInstalledPlugins to return a plugin from the marketplace
      vi.spyOn(service, "getInstalledPlugins").mockResolvedValue({
        plugins: [
          {
            name: "orphaned-plugin",
            marketplace: "wave-plugins-official",
            version: "1.0.0",
            cachePath: "/some/path",
          },
        ],
      });

      const uninstallSpy = vi
        .spyOn(service, "uninstallPlugin")
        .mockResolvedValue();
      vi.spyOn(
        service,
        "loadMarketplaceManifest" as keyof MarketplaceService,
      ).mockResolvedValue({
        name: "wave-plugins-official",
        owner: { name: "test" },
        plugins: [], // No plugins in manifest
      } as never);

      await service.updateMarketplace("wave-plugins-official", {
        updatePlugins: true,
      });

      expect(uninstallSpy).toHaveBeenCalledWith(
        "orphaned-plugin@wave-plugins-official",
        undefined,
      );
    });
  });

  describe("Locking Mechanism", () => {
    it("should support re-entrant locking within the same process", async () => {
      vi.spyOn(
        service,
        "loadMarketplaceManifest" as keyof MarketplaceService,
      ).mockResolvedValue({
        name: "test",
        plugins: [],
      } as never);

      // Mock getKnownMarketplaces to return the marketplace
      vi.spyOn(service, "getKnownMarketplaces").mockResolvedValue({
        marketplaces: [
          {
            name: "test",
            source: { source: "directory", path: "/path" },
            autoUpdate: false,
          } as unknown as KnownMarketplace,
        ],
      });

      // Mock saveKnownMarketplaces to call another locked method
      const saveSpy = vi.spyOn(service, "saveKnownMarketplaces");
      saveSpy.mockImplementationOnce(async () => {
        // This call should NOT trigger another fs.open because we're already locked
        // We use mockImplementationOnce to avoid infinite recursion since toggleAutoUpdate calls saveKnownMarketplaces
        await service.toggleAutoUpdate("test", true);
      });

      vi.mocked(fs.open).mockClear();
      await service.addMarketplace("/some/path");

      // fs.open should only be called once for the outer lock
      expect(fs.open).toHaveBeenCalledTimes(1);
    });

    it("should retry acquiring the lock if it already exists", async () => {
      vi.spyOn(
        service,
        "loadMarketplaceManifest" as keyof MarketplaceService,
      ).mockResolvedValue({
        name: "test",
        plugins: [],
      } as never);

      vi.mocked(fs.open)
        .mockRejectedValueOnce({ code: "EEXIST" } as unknown as Error)
        .mockRejectedValueOnce({ code: "EEXIST" } as unknown as Error)
        .mockResolvedValueOnce({ close: vi.fn() } as unknown as Awaited<
          ReturnType<typeof fs.open>
        >);

      // Mock setTimeout to resolve immediately
      const originalSetTimeout = global.setTimeout;
      (
        global as unknown as { setTimeout: (fn: () => void) => void }
      ).setTimeout = (fn: () => void) => fn();

      vi.mocked(fs.open).mockClear();
      const result = await service.addMarketplace("/some/path");

      expect(result).toBeDefined();
      expect(fs.open).toHaveBeenCalledTimes(3);

      global.setTimeout = originalSetTimeout;
    });

    it("should cleanup temporary directories if installation fails", async () => {
      vi.spyOn(service, "getKnownMarketplaces").mockResolvedValue({
        marketplaces: [
          {
            name: "test",
            source: { source: "github", repo: "owner/repo" },
            autoUpdate: false,
          },
        ],
      });

      vi.spyOn(service, "loadMarketplaceManifest").mockResolvedValue({
        name: "test",
        plugins: [
          { name: "plugin", source: "plugin-dir", description: "test" },
        ],
      } as never);

      // Mock git clone to succeed but something else to fail
      vi.spyOn(
        service["gitService"] as unknown as { clone: () => Promise<void> },
        "clone",
      ).mockResolvedValue(undefined);

      // Mock fs.readFile to fail when reading plugin manifest
      vi.mocked(fs.readFile).mockImplementation((path: unknown) => {
        if (String(path).includes("plugin.json")) {
          throw new Error("Read error");
        }
        return Promise.resolve("");
      });

      // Mock existsSync to return true for cleanup check
      vi.mocked(fsModule.existsSync).mockReturnValue(true);

      await expect(
        service.installPlugin("plugin@test", "/project"),
      ).rejects.toThrow(/Failed to install plugin plugin: Read error/);

      // Should attempt to remove tmp dirs
      expect(fs.rm).toHaveBeenCalled();
    });
  });
});
