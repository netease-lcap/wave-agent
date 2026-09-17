import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MarketplaceService } from "../../src/services/MarketplaceService.js";

vi.mock("../../src/services/GitService.js");

vi.mock("../../src/services/configurationService.js", () => {
  return {
    ConfigurationService: class {
      getMergedMarketplaces = vi.fn(() => ({}));
      getScopedMarketplaces = vi.fn(() => ({}));
      addMarketplaceToScope = vi.fn();
      removeMarketplaceFromScope = vi.fn();
      getMergedEnabledPlugins = vi.fn(() => ({}));
    },
  };
});

describe("MarketplaceService - Update", () => {
  let service: MarketplaceService;

  beforeEach(() => {
    service = new MarketplaceService();
    // 已安装清单是机器级文件：测试里固定为空，行为不依赖本机真实状态
    vi.spyOn(service, "getInstalledPlugins").mockResolvedValue({
      plugins: [],
    });
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

    // 无安装记录可依时按 user 记账（缺省语义）
    expect(uninstallSpy).toHaveBeenCalledWith(pluginId);
    expect(installSpy).toHaveBeenCalledWith(pluginId, { scope: "user" });
    expect(result.version).toBe("1.0.1");

    // Ensure uninstall is called before install
    const uninstallOrder = uninstallSpy.mock.invocationCallOrder[0];
    const installOrder = installSpy.mock.invocationCallOrder[0];
    expect(uninstallOrder).toBeLessThan(installOrder);
  });
});
