import { render } from "ink-testing-library";
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePluginManager } from "../../src/hooks/usePluginManager.js";
import { PluginManagerContextType } from "../../src/components/PluginManagerTypes.js";

// Mock wave-agent-sdk
const mockPluginCore = {
  listMarketplaces: vi.fn(),
  getInstalledPlugins: vi.fn(),
  getMergedEnabledPlugins: vi.fn(),
  findPluginScope: vi.fn(),
  loadMarketplaceManifest: vi.fn(),
  getMarketplacePath: vi.fn(),
  addMarketplace: vi.fn(),
  removeMarketplace: vi.fn(),
  updateMarketplace: vi.fn(),
  installPlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  updatePlugin: vi.fn(),
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
};

vi.mock("wave-agent-sdk", () => {
  return {
    PluginCore: vi.fn().mockImplementation(function () {
      return mockPluginCore;
    }),
  };
});

describe("usePluginManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPluginCore.listMarketplaces.mockResolvedValue([]);
    mockPluginCore.getInstalledPlugins.mockResolvedValue({
      plugins: [],
    });
    mockPluginCore.getMergedEnabledPlugins.mockReturnValue({});
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

    // Wait for hook to be called at least once
    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    // Initial state
    expect(lastValue?.state.currentView).toBe("DISCOVER");

    // Wait for data load to complete
    await vi.waitFor(() => {
      expect(lastValue?.state.isLoading).toBe(false);
    });

    expect(mockPluginCore.listMarketplaces).toHaveBeenCalled();
    expect(mockPluginCore.getInstalledPlugins).toHaveBeenCalled();
  });

  it("should handle errors during initial data load", async () => {
    const errorMessage = "Failed to load marketplaces";
    mockPluginCore.listMarketplaces.mockRejectedValue(new Error(errorMessage));

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

      mockPluginCore.addMarketplace.mockResolvedValue(undefined);
      lastValue?.actions.addMarketplace("test/repo");

      await vi.waitFor(() => {
        expect(mockPluginCore.addMarketplace).toHaveBeenCalledWith("test/repo");
        expect(mockPluginCore.listMarketplaces).toHaveBeenCalledTimes(2);
      });
    });

    it("should handle error when adding a marketplace", async () => {
      const errorMessage = "Add failed";
      mockPluginCore.addMarketplace.mockRejectedValue(new Error(errorMessage));

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

      mockPluginCore.installPlugin.mockResolvedValue(undefined);

      lastValue?.actions.installPlugin("my-plugin", "my-marketplace", "user");

      await vi.waitFor(() => {
        expect(mockPluginCore.installPlugin).toHaveBeenCalledWith(
          "my-plugin@my-marketplace",
          "user",
        );
        expect(mockPluginCore.listMarketplaces).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("plugin uninstall", () => {
    it("should uninstall a plugin and refresh", async () => {
      let lastValue: PluginManagerContextType | undefined;
      const onHookValue = (val: PluginManagerContextType) => {
        lastValue = val;
      };

      render(<TestComponent onHookValue={onHookValue} />);

      await vi.waitFor(() => {
        expect(lastValue?.state.isLoading).toBe(false);
      });

      mockPluginCore.uninstallPlugin.mockResolvedValue(undefined);

      lastValue?.actions.uninstallPlugin("my-plugin", "my-marketplace");

      await vi.waitFor(() => {
        expect(mockPluginCore.uninstallPlugin).toHaveBeenCalledWith(
          "my-plugin@my-marketplace",
        );
        expect(mockPluginCore.listMarketplaces).toHaveBeenCalledTimes(2);
      });
    });
  });
});
