import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { promises as fs, existsSync } from "fs";
import * as path from "path";
import { getPluginsDir } from "../../src/utils/configPaths.js";

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
    // Mock all git operations by default
    vi.spyOn(service["gitService"], "isGitAvailable").mockResolvedValue(true);
    vi.spyOn(service["gitService"], "clone").mockResolvedValue();
    vi.spyOn(service["gitService"], "pull").mockResolvedValue();
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
});
