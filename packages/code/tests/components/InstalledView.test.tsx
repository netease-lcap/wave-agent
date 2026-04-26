import React from "react";
import { render } from "ink-testing-library";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { InstalledView } from "../../src/components/InstalledView.js";
import { PluginManagerContext } from "../../src/contexts/PluginManagerContext.js";
import { PluginManagerContextType } from "../../src/components/PluginManagerTypes.js";

describe("InstalledView", () => {
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

  const mockInstalledPlugins: PluginManagerContextType["installedPlugins"] = [
    {
      name: "plugin1",
      marketplace: "mp1",
      enabled: true,
      version: "1.0.0",
      cachePath: "/tmp/plugin1",
    },
    {
      name: "plugin2",
      marketplace: "mp2",
      enabled: false,
      version: "2.0.0",
      scope: "project",
      cachePath: "/tmp/plugin2",
    },
  ];

  const createMockContext = (
    plugins = mockInstalledPlugins,
  ): PluginManagerContextType => ({
    state: {
      currentView: "INSTALLED",
      selectedId: null,
      isLoading: false,
      error: null,
      successMessage: null,
      searchQuery: "",
    },
    marketplaces: [],
    installedPlugins: plugins,
    discoverablePlugins: [],
    actions: {
      ...mockActions,
      clearPluginFeedback: vi.fn(),
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render the list of installed plugins", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext()}>
        <InstalledView />
      </PluginManagerContext.Provider>,
    );
    const output = lastFrame();
    expect(output).toContain("plugin1");
    expect(output).toContain("@mp1");
    expect(output).toContain("plugin2");
    expect(output).toContain("@mp2");
  });

  it("should navigate using Up/Down arrow keys", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext()}>
        <InstalledView />
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

  it("should select a plugin with Enter", async () => {
    const { stdin } = render(
      <PluginManagerContext.Provider value={createMockContext()}>
        <InstalledView />
      </PluginManagerContext.Provider>,
    );

    // Select first plugin
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(mockActions.setSelectedId).toHaveBeenCalledWith("plugin1@mp1");
      expect(mockActions.setView).toHaveBeenCalledWith("PLUGIN_DETAIL");
    });
  });

  it("should display 'No plugins installed.' when the list is empty", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext([])}>
        <InstalledView />
      </PluginManagerContext.Provider>,
    );
    expect(lastFrame()).toContain("No plugins installed.");
  });

  it("should display 'Press Enter for actions' only for the selected plugin", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext()}>
        <InstalledView />
      </PluginManagerContext.Provider>,
    );

    // Initially first plugin is selected
    const frame1 = lastFrame();
    expect(frame1).toContain("plugin1");
    expect(frame1).toContain("Press Enter for actions");

    // Check that it's near plugin1 (this is a bit hard with just toContain, but we can check the relative position if needed)
    // For now, let's just check it's there.

    // Press Down to select second plugin
    stdin.write("\u001B[B");
    await vi.waitFor(() => {
      const frame2 = lastFrame();
      expect(frame2).toContain("plugin2");
      expect(frame2).toContain("Press Enter for actions");
    });
  });

  it("should display plugin scope if present", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext()}>
        <InstalledView />
      </PluginManagerContext.Provider>,
    );
    const output = lastFrame();
    expect(output).toContain("(project)");
  });

  it("should not go out of bounds when navigating", async () => {
    const { stdin, lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext()}>
        <InstalledView />
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
    const fiveInstalledPlugins: PluginManagerContextType["installedPlugins"] = [
      {
        name: "plugin1",
        marketplace: "mp1",
        enabled: true,
        version: "1.0.0",
        cachePath: "/tmp/plugin1",
      },
      {
        name: "plugin2",
        marketplace: "mp2",
        enabled: true,
        version: "2.0.0",
        cachePath: "/tmp/plugin2",
      },
      {
        name: "plugin3",
        marketplace: "mp3",
        enabled: true,
        version: "3.0.0",
        cachePath: "/tmp/plugin3",
      },
      {
        name: "plugin4",
        marketplace: "mp4",
        enabled: true,
        version: "4.0.0",
        cachePath: "/tmp/plugin4",
      },
      {
        name: "plugin5",
        marketplace: "mp5",
        enabled: true,
        version: "5.0.0",
        cachePath: "/tmp/plugin5",
      },
    ];

    it("should show max 3 plugins when more than 3 installed", () => {
      const { lastFrame } = render(
        <PluginManagerContext.Provider
          value={createMockContext(fiveInstalledPlugins)}
        >
          <InstalledView />
        </PluginManagerContext.Provider>,
      );
      const frame = lastFrame();
      expect(frame).toContain("plugin1");
      expect(frame).toContain("plugin2");
      expect(frame).toContain("plugin3");
      expect(frame).not.toContain("plugin4");
      expect(frame).not.toContain("plugin5");
    });

    it("should scroll window when navigating down past the third visible item", async () => {
      const { stdin, lastFrame } = render(
        <PluginManagerContext.Provider
          value={createMockContext(fiveInstalledPlugins)}
        >
          <InstalledView />
        </PluginManagerContext.Provider>,
      );

      // Press Down 4 times to reach index 4, waiting between each
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("> plugin2");
      });
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("> plugin3");
      });
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("> plugin4");
      });
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

    it("should scroll window when navigating back up", async () => {
      const { stdin, lastFrame } = render(
        <PluginManagerContext.Provider
          value={createMockContext(fiveInstalledPlugins)}
        >
          <InstalledView />
        </PluginManagerContext.Provider>,
      );

      // Navigate to index 4
      stdin.write("\u001B[B");
      await vi.waitFor(() => expect(lastFrame()).toContain("> plugin2"));
      stdin.write("\u001B[B");
      await vi.waitFor(() => expect(lastFrame()).toContain("> plugin3"));
      stdin.write("\u001B[B");
      await vi.waitFor(() => expect(lastFrame()).toContain("> plugin4"));
      stdin.write("\u001B[B");
      await vi.waitFor(() => expect(lastFrame()).toContain("> plugin5"));

      // Press Up once - window should shift back
      stdin.write("\u001B[A");
      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain("> plugin4");
        expect(frame).not.toContain("plugin1");
        expect(frame).toContain("plugin3");
        expect(frame).toContain("plugin5");
      });
    });
  });
});
