import React from "react";
import { render } from "ink-testing-library";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { PluginDetail } from "../../src/components/PluginDetail.js";
import { PluginManagerContext } from "../../src/contexts/PluginManagerContext.js";
import { PluginManagerContextType } from "../../src/components/PluginManagerTypes.js";

describe("PluginDetail", () => {
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

  const mockDiscoverablePlugins: PluginManagerContextType["discoverablePlugins"] =
    [
      {
        name: "plugin1",
        marketplace: "mp1",
        description: "Description 1",
        installed: false,
        version: "1.0.0",
        source: "source1",
      },
    ];

  const mockInstalledPlugins: PluginManagerContextType["installedPlugins"] = [
    {
      name: "plugin2",
      marketplace: "mp2",
      enabled: true,
      version: "2.0.0",
      cachePath: "/path/to/plugin2",
    },
  ];

  const createMockContext = (
    selectedId: string | null = "plugin1@mp1",
    discoverable = mockDiscoverablePlugins,
    installed = mockInstalledPlugins,
  ): PluginManagerContextType => ({
    state: {
      currentView: "PLUGIN_DETAIL",
      selectedId,
      isLoading: false,
      error: null,
      searchQuery: "",
    },
    marketplaces: [],
    installedPlugins: installed,
    discoverablePlugins: discoverable,
    actions: mockActions,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render plugin details for a discoverable plugin", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext("plugin1@mp1")}>
        <PluginDetail />
      </PluginManagerContext.Provider>,
    );
    const output = lastFrame();
    expect(output).toContain("plugin1");
    expect(output).toContain("@mp1");
    expect(output).toContain("Description 1");
    expect(output).toContain("Version: 1.0.0");
    expect(output).toContain("Select Installation Scope:");
  });

  it("should render plugin details for a plugin without description or version", () => {
    const pluginNoDesc: PluginManagerContextType["discoverablePlugins"] = [
      {
        name: "plugin-minimal",
        marketplace: "mp1",
        installed: false,
        source: "source1",
        description: "",
      },
    ];
    const { lastFrame } = render(
      <PluginManagerContext.Provider
        value={createMockContext("plugin-minimal@mp1", pluginNoDesc, [])}
      >
        <PluginDetail />
      </PluginManagerContext.Provider>,
    );
    const output = lastFrame();
    expect(output).toContain("plugin-minimal");
    expect(output).not.toContain("Version:");
  });

  it("should render plugin details for an installed plugin", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext("plugin2@mp2")}>
        <PluginDetail />
      </PluginManagerContext.Provider>,
    );
    const output = lastFrame();
    expect(output).toContain("plugin2");
    expect(output).toContain("@mp2");
    expect(output).toContain("Version: 2.0.0");
    expect(output).toContain("Plugin Actions:");
  });

  it("should render installation scopes for an installed but disabled plugin", () => {
    const disabledPlugin: PluginManagerContextType["installedPlugins"] = [
      {
        ...mockInstalledPlugins[0],
        enabled: false,
      },
    ];
    const { lastFrame } = render(
      <PluginManagerContext.Provider
        value={createMockContext("plugin2@mp2", [], disabledPlugin)}
      >
        <PluginDetail />
      </PluginManagerContext.Provider>,
    );
    const output = lastFrame();
    expect(output).toContain("Select Installation Scope:");
  });

  it("should handle 'Plugin not found' state", () => {
    const { lastFrame } = render(
      <PluginManagerContext.Provider value={createMockContext("unknown@mp")}>
        <PluginDetail />
      </PluginManagerContext.Provider>,
    );
    expect(lastFrame()).toContain("Plugin not found.");
  });

  describe("Installation Flow", () => {
    it("should render installation scopes for non-installed plugins", () => {
      const { lastFrame } = render(
        <PluginManagerContext.Provider value={createMockContext("plugin1@mp1")}>
          <PluginDetail />
        </PluginManagerContext.Provider>,
      );
      const output = lastFrame();
      expect(output).toContain("Select Installation Scope:");
      expect(output).toContain("Install for all collaborators (project scope)");
      expect(output).toContain("Install for you (user scope)");
      expect(output).toContain(
        "Install for you, in this repo only (local scope)",
      );
    });

    it("should navigate scopes with Up/Down arrows", async () => {
      const { stdin, lastFrame } = render(
        <PluginManagerContext.Provider value={createMockContext("plugin1@mp1")}>
          <PluginDetail />
        </PluginManagerContext.Provider>,
      );

      // Initially first scope is selected
      expect(lastFrame()).toContain(
        "> Install for all collaborators (project scope)",
      );

      // Press Down
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("> Install for you (user scope)");
      });

      // Press Down again
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain(
          "> Install for you, in this repo only (local scope)",
        );
      });

      // Press Down again (wrap around)
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain(
          "> Install for all collaborators (project scope)",
        );
      });

      // Press Up (wrap around to last)
      stdin.write("\u001B[A");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain(
          "> Install for you, in this repo only (local scope)",
        );
      });
    });

    it("should install with Enter", async () => {
      const { stdin, lastFrame } = render(
        <PluginManagerContext.Provider value={createMockContext("plugin1@mp1")}>
          <PluginDetail />
        </PluginManagerContext.Provider>,
      );

      // Select second scope (user)
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("> Install for you (user scope)");
      });

      // Press Enter
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockActions.installPlugin).toHaveBeenCalledWith(
          "plugin1",
          "mp1",
          "user",
        );
        expect(mockActions.setView).toHaveBeenCalledWith("INSTALLED");
      });
    });
  });

  describe("Installed Actions Flow", () => {
    it("should render 'Uninstall' and 'Update' actions for installed and enabled plugins", () => {
      const { lastFrame } = render(
        <PluginManagerContext.Provider value={createMockContext("plugin2@mp2")}>
          <PluginDetail />
        </PluginManagerContext.Provider>,
      );
      const output = lastFrame();
      expect(output).toContain("Plugin Actions:");
      expect(output).toContain("Uninstall plugin");
      expect(output).toContain("Update plugin (reinstall)");
    });

    it("should navigate actions with Up/Down arrows", async () => {
      const { stdin, lastFrame } = render(
        <PluginManagerContext.Provider value={createMockContext("plugin2@mp2")}>
          <PluginDetail />
        </PluginManagerContext.Provider>,
      );

      // Initially first action is selected
      expect(lastFrame()).toContain("> Update plugin (reinstall)");

      // Press Down
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("> Uninstall plugin");
      });

      // Press Down again (wrap around)
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("> Update plugin (reinstall)");
      });

      // Press Up (wrap around to last)
      stdin.write("\u001B[A");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("> Uninstall plugin");
      });
    });

    it("should uninstall with Enter", async () => {
      const { stdin, lastFrame } = render(
        <PluginManagerContext.Provider value={createMockContext("plugin2@mp2")}>
          <PluginDetail />
        </PluginManagerContext.Provider>,
      );

      // Select second action (uninstall)
      stdin.write("\u001B[B");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("> Uninstall plugin");
      });

      // Press Enter
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockActions.uninstallPlugin).toHaveBeenCalledWith(
          "plugin2",
          "mp2",
        );
        expect(mockActions.setView).toHaveBeenCalledWith("INSTALLED");
      });
    });

    it("should update with Enter", async () => {
      const { stdin, lastFrame } = render(
        <PluginManagerContext.Provider value={createMockContext("plugin2@mp2")}>
          <PluginDetail />
        </PluginManagerContext.Provider>,
      );

      // Select first action (update) - already selected
      expect(lastFrame()).toContain("> Update plugin (reinstall)");

      // Press Enter
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockActions.updatePlugin).toHaveBeenCalledWith("plugin2", "mp2");
        expect(mockActions.setView).toHaveBeenCalledWith("INSTALLED");
      });
    });
  });

  describe("Navigation Back", () => {
    it("should navigate back to DISCOVER with Escape key if plugin is discoverable", async () => {
      const { stdin } = render(
        <PluginManagerContext.Provider value={createMockContext("plugin1@mp1")}>
          <PluginDetail />
        </PluginManagerContext.Provider>,
      );

      stdin.write("\u001B"); // Escape
      await vi.waitFor(() => {
        expect(mockActions.setView).toHaveBeenCalledWith("DISCOVER");
      });
    });

    it("should navigate back to INSTALLED with Escape key if plugin is only in installed list", async () => {
      const { stdin } = render(
        <PluginManagerContext.Provider
          value={createMockContext("plugin2@mp2", [])}
        >
          <PluginDetail />
        </PluginManagerContext.Provider>,
      );

      stdin.write("\u001B"); // Escape
      await vi.waitFor(() => {
        expect(mockActions.setView).toHaveBeenCalledWith("INSTALLED");
      });
    });
  });
});
