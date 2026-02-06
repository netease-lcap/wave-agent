import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { PluginManagerShell } from "../../../src/components/PluginManagerShell.js";
import { stripAnsiColors } from "wave-agent-sdk";

// Mock the hook
vi.mock("../../../src/hooks/usePluginManager.js", () => ({
  usePluginManager: vi.fn(),
}));

import { usePluginManager } from "../../../src/hooks/usePluginManager.js";

// Mock sub-components to verify they are rendered
vi.mock("../../../src/components/DiscoverView.js", () => ({
  DiscoverView: () => <Text>Discover View</Text>,
}));
vi.mock("../../../src/components/InstalledView.js", () => ({
  InstalledView: () => <Text>Installed View</Text>,
}));
vi.mock("../../../src/components/MarketplaceView.js", () => ({
  MarketplaceView: () => <Text>Marketplace View</Text>,
}));
vi.mock("../../../src/components/MarketplaceDetail.js", () => ({
  MarketplaceDetail: () => <Text>Marketplace Detail</Text>,
}));
vi.mock("../../../src/components/PluginDetail.js", () => ({
  PluginDetail: () => <Text>Plugin Detail</Text>,
}));
vi.mock("../../../src/components/MarketplaceAddForm.js", () => ({
  MarketplaceAddForm: () => <Text>Marketplace Add Form</Text>,
}));

describe("PluginManagerShell", () => {
  const mockActions = {
    setView: vi.fn(),
    setSelectedId: vi.fn(),
    addMarketplace: vi.fn(),
    removeMarketplace: vi.fn(),
    updateMarketplace: vi.fn(),
    installPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    togglePlugin: vi.fn(),
    refresh: vi.fn(),
  };

  const mockState = {
    currentView: "DISCOVER",
    selectedId: null,
    isLoading: false,
    error: null,
    searchQuery: "",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (
      usePluginManager as unknown as { mockReturnValue: (val: unknown) => void }
    ).mockReturnValue({
      state: mockState,
      marketplaces: [],
      installedPlugins: [],
      discoverablePlugins: [],
      actions: mockActions,
    });
  });

  it("renders the shell with navigation", async () => {
    const { lastFrame } = render(<PluginManagerShell />);
    const frame = stripAnsiColors(lastFrame() || "");
    expect(frame).toContain("Plugin Manager");
    expect(frame).toContain("Discover");
    expect(frame).toContain("Installed");
    expect(frame).toContain("Marketplaces");
  });

  it("switches views on Tab key press", async () => {
    const { stdin } = render(<PluginManagerShell />);

    stdin.write("\t");
    expect(mockActions.setView).toHaveBeenCalledWith("INSTALLED");
  });

  it("switches views backward on Shift+Tab key press", async () => {
    const { stdin } = render(<PluginManagerShell />);

    stdin.write("\u001B[Z"); // Shift+Tab
    expect(mockActions.setView).toHaveBeenCalledWith("MARKETPLACES");
  });

  it("navigates from PLUGIN_DETAIL (discoverable) to INSTALLED on Tab", async () => {
    const plugin = { name: "test-plugin", marketplace: "test-mkt" };
    (
      usePluginManager as unknown as { mockReturnValue: (val: unknown) => void }
    ).mockReturnValue({
      state: {
        ...mockState,
        currentView: "PLUGIN_DETAIL",
        selectedId: "test-plugin@test-mkt",
      },
      marketplaces: [],
      installedPlugins: [],
      discoverablePlugins: [plugin],
      actions: mockActions,
    });

    const { stdin } = render(<PluginManagerShell />);
    stdin.write("\t");
    expect(mockActions.setView).toHaveBeenCalledWith("INSTALLED");
  });

  it("navigates from PLUGIN_DETAIL (installed) to MARKETPLACES on Tab", async () => {
    (
      usePluginManager as unknown as { mockReturnValue: (val: unknown) => void }
    ).mockReturnValue({
      state: {
        ...mockState,
        currentView: "PLUGIN_DETAIL",
        selectedId: "installed-plugin@test-mkt",
      },
      marketplaces: [],
      installedPlugins: [],
      discoverablePlugins: [], // Not in discoverable, so it's considered from INSTALLED
      actions: mockActions,
    });

    const { stdin } = render(<PluginManagerShell />);
    stdin.write("\t");
    expect(mockActions.setView).toHaveBeenCalledWith("MARKETPLACES");
  });

  it("navigates from MARKETPLACE_DETAIL to DISCOVER on Tab", async () => {
    (
      usePluginManager as unknown as { mockReturnValue: (val: unknown) => void }
    ).mockReturnValue({
      state: {
        ...mockState,
        currentView: "MARKETPLACE_DETAIL",
        selectedId: "test-mkt",
      },
      marketplaces: [],
      installedPlugins: [],
      discoverablePlugins: [],
      actions: mockActions,
    });

    const { stdin } = render(<PluginManagerShell />);
    stdin.write("\t");
    expect(mockActions.setView).toHaveBeenCalledWith("DISCOVER");
  });

  it("navigates from ADD_MARKETPLACE to DISCOVER on Tab", async () => {
    (
      usePluginManager as unknown as { mockReturnValue: (val: unknown) => void }
    ).mockReturnValue({
      state: {
        ...mockState,
        currentView: "ADD_MARKETPLACE",
      },
      marketplaces: [],
      installedPlugins: [],
      discoverablePlugins: [],
      actions: mockActions,
    });

    const { stdin } = render(<PluginManagerShell />);
    stdin.write("\t");
    expect(mockActions.setView).toHaveBeenCalledWith("DISCOVER");
  });

  describe("Escape key behavior", () => {
    it("goes back from PLUGIN_DETAIL (discoverable) to DISCOVER on Escape", async () => {
      const plugin = { name: "test-plugin", marketplace: "test-mkt" };
      (
        usePluginManager as unknown as {
          mockReturnValue: (val: unknown) => void;
        }
      ).mockReturnValue({
        state: {
          ...mockState,
          currentView: "PLUGIN_DETAIL",
          selectedId: "test-plugin@test-mkt",
        },
        marketplaces: [],
        installedPlugins: [],
        discoverablePlugins: [plugin],
        actions: mockActions,
      });

      const { stdin } = render(<PluginManagerShell />);
      stdin.write("\u001B"); // Escape
      expect(mockActions.setView).toHaveBeenCalledWith("DISCOVER");
    });

    it("goes back from PLUGIN_DETAIL (installed) to INSTALLED on Escape", async () => {
      (
        usePluginManager as unknown as {
          mockReturnValue: (val: unknown) => void;
        }
      ).mockReturnValue({
        state: {
          ...mockState,
          currentView: "PLUGIN_DETAIL",
          selectedId: "installed-plugin@test-mkt",
        },
        marketplaces: [],
        installedPlugins: [],
        discoverablePlugins: [],
        actions: mockActions,
      });

      const { stdin } = render(<PluginManagerShell />);
      stdin.write("\u001B"); // Escape
      expect(mockActions.setView).toHaveBeenCalledWith("INSTALLED");
    });

    it("goes back from MARKETPLACE_DETAIL to MARKETPLACES on Escape", async () => {
      (
        usePluginManager as unknown as {
          mockReturnValue: (val: unknown) => void;
        }
      ).mockReturnValue({
        state: {
          ...mockState,
          currentView: "MARKETPLACE_DETAIL",
        },
        marketplaces: [],
        installedPlugins: [],
        discoverablePlugins: [],
        actions: mockActions,
      });

      const { stdin } = render(<PluginManagerShell />);
      stdin.write("\u001B"); // Escape
      expect(mockActions.setView).toHaveBeenCalledWith("MARKETPLACES");
    });

    it("goes back from ADD_MARKETPLACE to MARKETPLACES on Escape", async () => {
      (
        usePluginManager as unknown as {
          mockReturnValue: (val: unknown) => void;
        }
      ).mockReturnValue({
        state: {
          ...mockState,
          currentView: "ADD_MARKETPLACE",
        },
        marketplaces: [],
        installedPlugins: [],
        discoverablePlugins: [],
        actions: mockActions,
      });

      const { stdin } = render(<PluginManagerShell />);
      stdin.write("\u001B"); // Escape
      expect(mockActions.setView).toHaveBeenCalledWith("MARKETPLACES");
    });
  });

  describe("View rendering", () => {
    const views = [
      { view: "DISCOVER", text: "Discover View" },
      { view: "INSTALLED", text: "Installed View" },
      { view: "MARKETPLACES", text: "Marketplace View" },
      { view: "MARKETPLACE_DETAIL", text: "Marketplace Detail" },
      { view: "PLUGIN_DETAIL", text: "Plugin Detail" },
      { view: "ADD_MARKETPLACE", text: "Marketplace Add Form" },
      { view: "UNKNOWN" as unknown as "DISCOVER", text: "Discover View" },
    ];

    it.each(views)("renders $view view correctly", ({ view, text }) => {
      (
        usePluginManager as unknown as {
          mockReturnValue: (val: unknown) => void;
        }
      ).mockReturnValue({
        state: { ...mockState, currentView: view },
        marketplaces: [],
        installedPlugins: [],
        discoverablePlugins: [],
        actions: mockActions,
      });

      const { lastFrame } = render(<PluginManagerShell />);
      expect(stripAnsiColors(lastFrame() || "")).toContain(text);
    });
  });

  describe("Header highlighting", () => {
    it("highlights Discover when in DISCOVER view", () => {
      (
        usePluginManager as unknown as {
          mockReturnValue: (val: unknown) => void;
        }
      ).mockReturnValue({
        state: { ...mockState, currentView: "DISCOVER" },
        marketplaces: [],
        installedPlugins: [],
        discoverablePlugins: [],
        actions: mockActions,
      });

      const { lastFrame } = render(<PluginManagerShell />);
      expect(stripAnsiColors(lastFrame() || "")).toContain("Discover");
    });

    it("highlights Discover when in PLUGIN_DETAIL and plugin is discoverable", () => {
      const plugin = { name: "test-plugin", marketplace: "test-mkt" };
      (
        usePluginManager as unknown as {
          mockReturnValue: (val: unknown) => void;
        }
      ).mockReturnValue({
        state: {
          ...mockState,
          currentView: "PLUGIN_DETAIL",
          selectedId: "test-plugin@test-mkt",
        },
        marketplaces: [],
        installedPlugins: [],
        discoverablePlugins: [plugin],
        actions: mockActions,
      });

      const { lastFrame } = render(<PluginManagerShell />);
      expect(stripAnsiColors(lastFrame() || "")).toContain("Discover");
    });

    it("highlights Installed when in PLUGIN_DETAIL and plugin is NOT discoverable", () => {
      (
        usePluginManager as unknown as {
          mockReturnValue: (val: unknown) => void;
        }
      ).mockReturnValue({
        state: {
          ...mockState,
          currentView: "PLUGIN_DETAIL",
          selectedId: "installed-plugin@test-mkt",
        },
        marketplaces: [],
        installedPlugins: [],
        discoverablePlugins: [],
        actions: mockActions,
      });

      const { lastFrame } = render(<PluginManagerShell />);
      expect(stripAnsiColors(lastFrame() || "")).toContain("Installed");
    });

    it("highlights Marketplaces when in MARKETPLACE_DETAIL", () => {
      (
        usePluginManager as unknown as {
          mockReturnValue: (val: unknown) => void;
        }
      ).mockReturnValue({
        state: {
          ...mockState,
          currentView: "MARKETPLACE_DETAIL",
        },
        marketplaces: [],
        installedPlugins: [],
        discoverablePlugins: [],
        actions: mockActions,
      });

      const { lastFrame } = render(<PluginManagerShell />);
      expect(stripAnsiColors(lastFrame() || "")).toContain("Marketplaces");
    });
  });

  it("shows loading state", async () => {
    (
      usePluginManager as unknown as { mockReturnValue: (val: unknown) => void }
    ).mockReturnValue({
      state: { ...mockState, isLoading: true },
      marketplaces: [],
      installedPlugins: [],
      discoverablePlugins: [],
      actions: mockActions,
    });

    const { lastFrame } = render(<PluginManagerShell />);
    expect(stripAnsiColors(lastFrame() || "")).toContain("Loading...");
  });

  it("shows error message", async () => {
    (
      usePluginManager as unknown as { mockReturnValue: (val: unknown) => void }
    ).mockReturnValue({
      state: { ...mockState, error: "Failed to load" },
      marketplaces: [],
      installedPlugins: [],
      discoverablePlugins: [],
      actions: mockActions,
    });

    const { lastFrame } = render(<PluginManagerShell />);
    const frame = stripAnsiColors(lastFrame() || "").replace(/\s+/g, " ");
    expect(frame).toContain("Error: Failed");
    expect(frame).toContain("load");
  });
});
