import React from "react";
import { render } from "ink-testing-library";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MarketplaceView } from "../../src/components/MarketplaceView.js";
import { PluginManagerContext } from "../../src/contexts/PluginManagerContext.js";
import { PluginManagerContextType } from "../../src/components/PluginManagerTypes.js";

describe("MarketplaceView", () => {
  const mockActions = {
    setView: vi.fn(),
    setSelectedId: vi.fn(),
    addMarketplace: vi.fn(),
    removeMarketplace: vi.fn(),
    updateMarketplace: vi.fn(),
    installPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    updatePlugin: vi.fn(),
    refresh: vi.fn(),
  };

  const mockContext: PluginManagerContextType = {
    state: {
      currentView: "MARKETPLACES",
      selectedId: null,
      isLoading: false,
      error: null,
      searchQuery: "",
    },
    marketplaces: [
      {
        name: "mp1",
        source: { source: "directory", path: "/p1" },
        isBuiltin: true,
      },
      {
        name: "mp2",
        source: { source: "github", repo: "r2" },
        isBuiltin: false,
      },
    ],
    installedPlugins: [],
    discoverablePlugins: [],
    actions: mockActions,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render marketplace list", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceView />
      </PluginManagerContext.Provider>,
    );
    expect(lastFrame()).toContain("mp1");
    expect(lastFrame()).toContain("mp2");
    expect(lastFrame()).toContain("Press 'a' to add a new marketplace");
  });

  it("should navigate with arrows", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceView />
      </PluginManagerContext.Provider>,
    );

    // mp1 is selected by default
    expect(lastFrame()).toContain("> mp1");

    stdin.write("\u001B[B"); // Down
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("> mp2");
    });

    stdin.write("\u001B[A"); // Up
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("> mp1");
    });
  });

  it("should go to detail on Enter", async () => {
    const { stdin } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceView />
      </PluginManagerContext.Provider>,
    );

    stdin.write("\r");
    await vi.waitFor(() => {
      expect(mockActions.setSelectedId).toHaveBeenCalledWith("mp1");
      expect(mockActions.setView).toHaveBeenCalledWith("MARKETPLACE_DETAIL");
    });
  });

  it("should go to add form on 'a'", async () => {
    const { stdin } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceView />
      </PluginManagerContext.Provider>,
    );

    stdin.write("a");
    await vi.waitFor(() => {
      expect(mockActions.setView).toHaveBeenCalledWith("ADD_MARKETPLACE");
    });
  });
});
