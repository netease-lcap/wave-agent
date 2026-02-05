import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MarketplaceService } from "../../src/services/MarketplaceService.js";

describe("MarketplaceService - Update", () => {
  let service: MarketplaceService;

  beforeEach(() => {
    service = new MarketplaceService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call uninstall and then install during update", async () => {
    const pluginId = "test-plugin@test-marketplace";
    const uninstallSpy = vi
      .spyOn(service, "uninstallPlugin")
      .mockResolvedValue(undefined);
    const installSpy = vi.spyOn(service, "installPlugin").mockResolvedValue({
      name: "test-plugin",
      marketplace: "test-marketplace",
      version: "1.0.1",
      cachePath: "/mock/path",
    });

    const result = await service.updatePlugin(pluginId);

    expect(uninstallSpy).toHaveBeenCalledWith(pluginId);
    expect(installSpy).toHaveBeenCalledWith(pluginId);
    expect(result.version).toBe("1.0.1");

    // Ensure uninstall is called before install
    const uninstallOrder = uninstallSpy.mock.invocationCallOrder[0];
    const installOrder = installSpy.mock.invocationCallOrder[0];
    expect(uninstallOrder).toBeLessThan(installOrder);
  });
});
