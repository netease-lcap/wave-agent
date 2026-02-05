import React from "react";
import { render } from "ink-testing-library";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MarketplaceDetail } from "../../src/components/MarketplaceDetail.js";
import { PluginManagerContext } from "../../src/contexts/PluginManagerContext.js";
import { PluginManagerContextType } from "../../src/components/PluginManagerTypes.js";

describe("MarketplaceDetail", () => {
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
      currentView: "MARKETPLACE_DETAIL",
      selectedId: "test-mp",
      isLoading: false,
      error: null,
      searchQuery: "",
    },
    marketplaces: [
      {
        name: "test-mp",
        source: { source: "github", repo: "owner/repo" },
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

  it("should render marketplace details correctly", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceDetail />
      </PluginManagerContext.Provider>,
    );
    expect(lastFrame()).toContain("test-mp");
    expect(lastFrame()).toContain("owner/repo");
    expect(lastFrame()).toContain("Update marketplace");
    expect(lastFrame()).toContain("Remove marketplace");
  });

  it("should render 'Marketplace not found' when marketplace is missing", () => {
    const missingContext = {
      ...mockContext,
      state: { ...mockContext.state, selectedId: "non-existent" },
    };
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={missingContext}>
        <MarketplaceDetail />
      </PluginManagerContext.Provider>,
    );
    expect(lastFrame()).toContain("Marketplace not found.");
  });

  it("should call setView('MARKETPLACES') when Escape is pressed", () => {
    const { stdin } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceDetail />
      </PluginManagerContext.Provider>,
    );
    stdin.write("\u001B"); // Escape
    expect(mockActions.setView).toHaveBeenCalledWith("MARKETPLACES");
  });

  it("should navigate actions with up/down arrows", async () => {
    const { lastFrame, stdin } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceDetail />
      </PluginManagerContext.Provider>,
    );

    // Initially "Update marketplace" is selected (index 0)
    expect(lastFrame()).toContain("> Update marketplace");

    stdin.write("\u001B[B"); // Down arrow
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("> Remove marketplace");
    });

    stdin.write("\u001B[A"); // Up arrow
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("> Update marketplace");
    });
  });

  it("should call updateMarketplace when 'Update' is selected and Enter is pressed", async () => {
    const { stdin } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceDetail />
      </PluginManagerContext.Provider>,
    );

    stdin.write("\r"); // Enter
    await vi.waitFor(() => {
      expect(mockActions.updateMarketplace).toHaveBeenCalledWith("test-mp");
      expect(mockActions.setView).toHaveBeenCalledWith("MARKETPLACES");
    });
  });

  it("should call removeMarketplace when 'Remove' is selected and Enter is pressed", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceDetail />
      </PluginManagerContext.Provider>,
    );

    stdin.write("\u001B[B"); // Down arrow to select "Remove"
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("> Remove marketplace");
    });
    stdin.write("\r"); // Enter
    await vi.waitFor(() => {
      expect(mockActions.removeMarketplace).toHaveBeenCalledWith("test-mp");
      expect(mockActions.setView).toHaveBeenCalledWith("MARKETPLACES");
    });
  });
});
