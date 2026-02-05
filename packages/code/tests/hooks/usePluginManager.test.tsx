import { render } from "ink-testing-library";
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePluginManager } from "../../src/hooks/usePluginManager.js";
import { PluginManagerContextType } from "../../src/components/PluginManagerTypes.js";

// Mock wave-agent-sdk
const mockMarketplaceService = {
  listMarketplaces: vi.fn(),
  getInstalledPlugins: vi.fn(),
  loadMarketplaceManifest: vi.fn(),
  getMarketplacePath: vi.fn(),
  addMarketplace: vi.fn(),
  removeMarketplace: vi.fn(),
  updateMarketplace: vi.fn(),
  installPlugin: vi.fn(),
  updatePlugin: vi.fn(),
};

const mockConfigurationService = {
  removeEnabledPlugin: vi.fn(),
};

const mockPluginScopeManager = {
  getMergedEnabledPlugins: vi.fn(),
  findPluginScope: vi.fn(),
  enablePlugin: vi.fn(),
};

vi.mock("wave-agent-sdk", () => ({
  MarketplaceService: vi.fn(() => mockMarketplaceService),
  ConfigurationService: vi.fn(() => mockConfigurationService),
  PluginManager: vi.fn(),
  PluginScopeManager: vi.fn(() => mockPluginScopeManager),
}));

describe("usePluginManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarketplaceService.listMarketplaces.mockResolvedValue([]);
    mockMarketplaceService.getInstalledPlugins.mockResolvedValue({
      plugins: [],
    });
    mockPluginScopeManager.getMergedEnabledPlugins.mockReturnValue({});
  });

  // Helper component to test the hook
  function TestComponent({
    onHookValue,
  }: {
    onHookValue: (value: PluginManagerContextType) => void;
  }) {
    const hookValue = usePluginManager();
    useEffect(() => {
      onHookValue(hookValue);
    }, [hookValue, onHookValue]);
    return null;
  }

  it("should initialize with default state and load data on mount", async () => {
    let lastValue: PluginManagerContextType | undefined;
    const onHookValue = (val: PluginManagerContextType) => {
      lastValue = val;
    };

    render(<TestComponent onHookValue={onHookValue} />);

    // Initial state
    expect(lastValue?.state.isLoading).toBe(true);
    expect(lastValue?.state.currentView).toBe("DISCOVER");

    // Wait for data load
    await vi.waitFor(() => {
      expect(lastValue?.state.isLoading).toBe(false);
    });

    expect(mockMarketplaceService.listMarketplaces).toHaveBeenCalled();
    expect(mockMarketplaceService.getInstalledPlugins).toHaveBeenCalled();
  });

  it("should handle errors during initial data load", async () => {
    const errorMessage = "Failed to load marketplaces";
    mockMarketplaceService.listMarketplaces.mockRejectedValue(
      new Error(errorMessage),
    );

    let lastValue: PluginManagerContextType | undefined;
    const onHookValue = (val: PluginManagerContextType) => {
      lastValue = val;
    };

    render(<TestComponent onHookValue={onHookValue} />);

    await vi.waitFor(() => {
      expect(lastValue?.state.isLoading).toBe(false);
      expect(lastValue?.state.error).toBe(errorMessage);
    });
  });

  it("should set the current view", async () => {
    let lastValue: PluginManagerContextType | undefined;
    const onHookValue = (val: PluginManagerContextType) => {
      lastValue = val;
    };

    render(<TestComponent onHookValue={onHookValue} />);

    await vi.waitFor(() => {
      expect(lastValue?.state.isLoading).toBe(false);
    });

    lastValue?.actions.setView("INSTALLED");

    await vi.waitFor(() => {
      expect(lastValue?.state.currentView).toBe("INSTALLED");
    });
  });

  it("should set the selected ID", async () => {
    let lastValue: PluginManagerContextType | undefined;
    const onHookValue = (val: PluginManagerContextType) => {
      lastValue = val;
    };

    render(<TestComponent onHookValue={onHookValue} />);

    await vi.waitFor(() => {
      expect(lastValue?.state.isLoading).toBe(false);
    });

    lastValue?.actions.setSelectedId("my-plugin");

    await vi.waitFor(() => {
      expect(lastValue?.state.selectedId).toBe("my-plugin");
    });
  });

  describe("marketplace actions", () => {
    it("should add a marketplace and refresh", async () => {
      let lastValue: PluginManagerContextType | undefined;
      const onHookValue = (val: PluginManagerContextType) => {
        lastValue = val;
      };

      render(<TestComponent onHookValue={onHookValue} />);

      await vi.waitFor(() => {
        expect(lastValue?.state.isLoading).toBe(false);
      });

      mockMarketplaceService.addMarketplace.mockResolvedValue(undefined);
      lastValue?.actions.addMarketplace("test/repo");

      await vi.waitFor(() => {
        expect(mockMarketplaceService.addMarketplace).toHaveBeenCalledWith(
          "test/repo",
        );
        expect(mockMarketplaceService.listMarketplaces).toHaveBeenCalledTimes(
          2,
        );
      });
    });

    it("should handle error when adding a marketplace", async () => {
      const errorMessage = "Add failed";
      mockMarketplaceService.addMarketplace.mockRejectedValue(
        new Error(errorMessage),
      );

      let lastValue: PluginManagerContextType | undefined;
      const onHookValue = (val: PluginManagerContextType) => {
        lastValue = val;
      };

      render(<TestComponent onHookValue={onHookValue} />);

      await vi.waitFor(() => {
        expect(lastValue?.state.isLoading).toBe(false);
      });

      lastValue?.actions.addMarketplace("test/repo");

      await vi.waitFor(() => {
        expect(lastValue?.state.error).toBe(errorMessage);
        expect(lastValue?.state.isLoading).toBe(false);
      });
    });
  });

  describe("plugin actions", () => {
    it("should install a plugin and refresh", async () => {
      let lastValue: PluginManagerContextType | undefined;
      const onHookValue = (val: PluginManagerContextType) => {
        lastValue = val;
      };

      render(<TestComponent onHookValue={onHookValue} />);

      await vi.waitFor(() => {
        expect(lastValue?.state.isLoading).toBe(false);
      });

      mockMarketplaceService.installPlugin.mockResolvedValue(undefined);
      mockPluginScopeManager.enablePlugin.mockResolvedValue(undefined);

      lastValue?.actions.installPlugin("my-plugin", "my-marketplace", "user");

      await vi.waitFor(() => {
        expect(mockMarketplaceService.installPlugin).toHaveBeenCalledWith(
          "my-plugin@my-marketplace",
        );
        expect(mockPluginScopeManager.enablePlugin).toHaveBeenCalledWith(
          "user",
          "my-plugin@my-marketplace",
        );
        expect(mockMarketplaceService.listMarketplaces).toHaveBeenCalledTimes(
          2,
        );
      });
    });
  });
});
