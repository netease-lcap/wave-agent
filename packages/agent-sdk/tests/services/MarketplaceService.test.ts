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
    vi.mocked(getPluginsDir).mockReturnValue(mockPluginsDir);
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
    service = new MarketplaceService();
  });

  afterEach(async () => {
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
});
