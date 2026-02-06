import React from "react";
import { render } from "ink-testing-library";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { DiscoverView } from "../../src/components/DiscoverView.js";
import { PluginManagerContext } from "../../src/contexts/PluginManagerContext.js";
import { PluginManagerContextType } from "../../src/components/PluginManagerTypes.js";

describe("DiscoverView", () => {
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

  const mockPlugins: PluginManagerContextType["discoverablePlugins"] = [
    {
      name: "plugin1",
      marketplace: "mp1",
      description: "Description 1",
      installed: false,
      version: "1.0.0",
      source: "source1",
    },
    {
      name: "plugin2",
      marketplace: "mp2",
      description: "Description 2",
      installed: false,
      version: "2.0.0",
      source: "source2",
    },
  ];

  const createMockContext = (
    plugins = mockPlugins,
  ): PluginManagerContextType => ({
    state: {
      currentView: "DISCOVER",
      selectedId: null,
      isLoading: false,
      error: null,
      searchQuery: "",
    },
    marketplaces: [],
    installedPlugins: [],
    discoverablePlugins: plugins,
    actions: mockActions,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render the list of discoverable plugins", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext()}>
        <DiscoverView />
      </PluginManagerContext.Provider>,
    );
    expect(lastFrame()).toContain("plugin1");
    expect(lastFrame()).toContain("@mp1");
    expect(lastFrame()).toContain("Description 1");
    expect(lastFrame()).toContain("plugin2");
    expect(lastFrame()).toContain("@mp2");
    expect(lastFrame()).toContain("Description 2");
  });

  it("should navigate using Up/Down arrow keys to change selectedIndex", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext()}>
        <DiscoverView />
      </PluginManagerContext.Provider>,
    );

    // Initially first plugin is selected
    expect(lastFrame()).toContain("> plugin1");
    expect(lastFrame()).not.toContain("> plugin2");

    // Press Down
    stdin.write("\u001B[B");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("> plugin2");
      expect(lastFrame()).not.toContain("> plugin1");
    });

    // Press Up
    stdin.write("\u001B[A");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("> plugin1");
      expect(lastFrame()).not.toContain("> plugin2");
    });
  });

  it("should select a plugin with the Enter key", async () => {
    const { stdin } = render(
      <PluginManagerContext.Provider value={createMockContext()}>
        <DiscoverView />
      </PluginManagerContext.Provider>,
    );

    // Select first plugin
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(mockActions.setSelectedId).toHaveBeenCalledWith("plugin1@mp1");
      expect(mockActions.setView).toHaveBeenCalledWith("PLUGIN_DETAIL");
    });
  });

  it("should handle empty plugin list", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext([])}>
        <DiscoverView />
      </PluginManagerContext.Provider>,
    );
    expect(lastFrame()).toContain("No plugins found.");
  });

  it("should not go out of bounds when navigating", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext()}>
        <DiscoverView />
      </PluginManagerContext.Provider>,
    );

    // Press Up at the top
    stdin.write("\u001B[A");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("> plugin1");
    });

    // Press Down twice to reach the end and beyond
    stdin.write("\u001B[B");
    stdin.write("\u001B[B");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("> plugin2");
    });
  });
});
