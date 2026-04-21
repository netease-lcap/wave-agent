import React from "react";
import { render } from "ink-testing-library";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MarketplaceAddForm } from "../../src/components/MarketplaceAddForm.js";
import { PluginManagerContext } from "../../src/contexts/PluginManagerContext.js";
import { PluginManagerContextType } from "../../src/components/PluginManagerTypes.js";

describe("MarketplaceAddForm", () => {
  const mockActions = {
    setView: vi.fn(),
    setSelectedId: vi.fn(),
    addMarketplace: vi.fn(),
    removeMarketplace: vi.fn(),
    updateMarketplace: vi.fn(),
    installPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    updatePlugin: vi.fn(),
    toggleAutoUpdate: vi.fn(),
    refresh: vi.fn(),
  };

  const mockContext: PluginManagerContextType = {
    state: {
      currentView: "ADD_MARKETPLACE",
      selectedId: null,
      isLoading: false,
      error: null,
      successMessage: null,
      searchQuery: "",
    },
    marketplaces: [],
    installedPlugins: [],
    discoverablePlugins: [],
    actions: {
      ...mockActions,
      clearPluginFeedback: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render correctly", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceAddForm />
      </PluginManagerContext.Provider>,
    );
    expect(lastFrame()).toContain("Step 1/2");
    expect(lastFrame()).toContain("Source:");
  });

  it("should handle text input", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceAddForm />
      </PluginManagerContext.Provider>,
    );

    stdin.write("h");
    stdin.write("t");
    stdin.write("t");
    stdin.write("p");

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("http");
    });
  });

  it("should handle backspace", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceAddForm />
      </PluginManagerContext.Provider>,
    );

    stdin.write("a");
    stdin.write("b");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("ab");
    });

    stdin.write("\u007F"); // Backspace
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("a");
      expect(lastFrame()).not.toContain("ab");
    });
  });

  it("should navigate to scope step after pressing Enter", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceAddForm />
      </PluginManagerContext.Provider>,
    );

    stdin.write("t");
    stdin.write("e");
    stdin.write("s");
    stdin.write("t");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("test");
    });

    // First Enter moves to scope step
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Step 2/2");
    });
  });

  it("should call addMarketplace after confirming scope selection", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceAddForm />
      </PluginManagerContext.Provider>,
    );

    stdin.write("t");
    stdin.write("e");
    stdin.write("s");
    stdin.write("t");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("test");
    });

    // First Enter moves to scope step
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Step 2/2");
    });

    // Second Enter confirms scope and submits
    stdin.write("\r");

    await vi.waitFor(
      () => {
        expect(mockActions.addMarketplace).toHaveBeenCalledWith("test", "user");
      },
      { timeout: 3000 },
    );
  });

  it("should call setView('MARKETPLACES') when Escape is pressed on step 1", async () => {
    const { stdin } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceAddForm />
      </PluginManagerContext.Provider>,
    );

    stdin.write("\u001B"); // Escape
    await vi.waitFor(() => {
      expect(mockActions.setView).toHaveBeenCalledWith("MARKETPLACES");
    });
  });

  it("should go back to source step when Escape is pressed on step 2", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={mockContext}>
        <MarketplaceAddForm />
      </PluginManagerContext.Provider>,
    );

    stdin.write("t");
    stdin.write("e");
    stdin.write("s");
    stdin.write("t");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("test");
    });

    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Step 2/2");
    });

    stdin.write("\u001B"); // Escape
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Step 1/2");
    });
  });
});
