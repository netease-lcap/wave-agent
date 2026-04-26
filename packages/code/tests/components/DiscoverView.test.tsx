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
    toggleAutoUpdate: vi.fn(),
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
      successMessage: null,
      searchQuery: "",
    },
    marketplaces: [],
    installedPlugins: [],
    discoverablePlugins: plugins,
    actions: {
      ...mockActions,
      clearPluginFeedback: vi.fn(),
    },
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

  describe("scrolling", () => {
    const fivePlugins: PluginManagerContextType["discoverablePlugins"] = [
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
      {
        name: "plugin3",
        marketplace: "mp3",
        description: "Description 3",
        installed: false,
        version: "3.0.0",
        source: "source3",
      },
      {
        name: "plugin4",
        marketplace: "mp4",
        description: "Description 4",
        installed: false,
        version: "4.0.0",
        source: "source4",
      },
      {
        name: "plugin5",
        marketplace: "mp5",
        description: "Description 5",
        installed: false,
        version: "5.0.0",
        source: "source5",
      },
    ];

    it("should show max 3 plugins when more than 3 discoverable", () => {
      const { lastFrame } = render(
        <PluginManagerContext.Provider value={createMockContext(fivePlugins)}>
          <DiscoverView />
        </PluginManagerContext.Provider>,
      );
      const frame = lastFrame();
      expect(frame).toContain("plugin1");
      expect(frame).toContain("plugin2");
      expect(frame).toContain("plugin3");
      expect(frame).not.toContain("plugin4");
      expect(frame).not.toContain("plugin5");
    });

    it("should scroll window when navigating down past the third visible plugin", async () => {
      const { stdin, lastFrame } = render(
        <PluginManagerContext.Provider value={createMockContext(fivePlugins)}>
          <DiscoverView />
        </PluginManagerContext.Provider>,
      );

      // Navigate Down 4 times to reach index 4, waiting between each
      stdin.write("\u001B[B");
      await vi.waitFor(() => expect(lastFrame()).toContain("> plugin2"));
      stdin.write("\u001B[B");
      await vi.waitFor(() => expect(lastFrame()).toContain("> plugin3"));
      stdin.write("\u001B[B");
      await vi.waitFor(() => expect(lastFrame()).toContain("> plugin4"));
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain("> plugin5");
        expect(frame).not.toContain("plugin1");
        expect(frame).not.toContain("plugin2");
        expect(frame).toContain("plugin3");
        expect(frame).toContain("plugin4");
      });
    });
  });
});
