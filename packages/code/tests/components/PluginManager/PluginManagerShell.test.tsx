import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { PluginManagerShell } from "../../../src/components/PluginManagerShell.js";
import { stripAnsiColors } from "wave-agent-sdk";

// Mock the hook
vi.mock("../../../src/hooks/usePluginManager.js", () => ({
  usePluginManager: vi.fn(),
}));

import { usePluginManager } from "../../../src/hooks/usePluginManager.js";

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
