import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { PluginManagerShell } from "../../src/components/PluginManagerShell.js";
import { stripAnsiColors } from "wave-agent-sdk";

// Mock the hook
vi.mock("../../src/hooks/usePluginManager.js", () => ({
  usePluginManager: vi.fn(),
}));

import { usePluginManager } from "../../src/hooks/usePluginManager.js";

describe("PluginManager Integration", () => {
  const mockActions = {
    setView: vi.fn(),
    setSelectedId: vi.fn(),
    installPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    togglePlugin: vi.fn(),
    refresh: vi.fn(),
  };

  const mockPlugins = [
    {
      name: "test-plugin",
      marketplace: "official",
      description: "A test plugin",
      installed: false,
    },
    {
      name: "installed-plugin",
      marketplace: "official",
      description: "Already here",
      installed: true,
      version: "1.0.0",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates from Discover to Plugin Detail and installs", async () => {
    let currentView = "DISCOVER";
    const setView = vi.fn((view) => {
      currentView = view;
    });

    (
      usePluginManager as unknown as {
        mockImplementation: (val: unknown) => void;
      }
    ).mockImplementation(() => ({
      state: {
        currentView,
        selectedId:
          currentView === "PLUGIN_DETAIL" ? "test-plugin@official" : null,
        isLoading: false,
        error: null,
      },
      marketplaces: [],
      installedPlugins: [],
      discoverablePlugins: mockPlugins,
      actions: { ...mockActions, setView, setSelectedId: vi.fn() },
    }));

    const { stdin, lastFrame, rerender } = render(<PluginManagerShell />);

    // Should show discoverable plugins
    expect(stripAnsiColors(lastFrame() || "")).toContain("test-plugin");

    // Press Enter to go to detail
    stdin.write("\r");
    expect(setView).toHaveBeenCalledWith("PLUGIN_DETAIL");

    // Rerender with new state (simulating state change in hook)
    rerender(<PluginManagerShell />);

    expect(stripAnsiColors(lastFrame() || "")).toContain(
      "Select Installation Scope",
    );

    // Press Enter to install (default scope)
    stdin.write("\r");
    expect(mockActions.installPlugin).toHaveBeenCalledWith(
      "test-plugin",
      "official",
      "user",
    );
  });

  it("manages installed plugins", async () => {
    (
      usePluginManager as unknown as { mockReturnValue: (val: unknown) => void }
    ).mockReturnValue({
      state: {
        currentView: "INSTALLED",
        selectedId: null,
        isLoading: false,
        error: null,
      },
      marketplaces: [],
      installedPlugins: [
        { name: "installed-plugin", marketplace: "official", enabled: true },
      ],
      discoverablePlugins: [],
      actions: mockActions,
    });

    const { stdin, lastFrame } = render(<PluginManagerShell />);

    expect(stripAnsiColors(lastFrame() || "")).toContain("installed-plugin");
    expect(stripAnsiColors(lastFrame() || "")).toContain("[Enabled]");

    // Press 't' to toggle
    stdin.write("t");
    expect(mockActions.togglePlugin).toHaveBeenCalledWith(
      "installed-plugin",
      "official",
      false,
    );

    // Press 'u' to uninstall
    stdin.write("u");
    expect(mockActions.uninstallPlugin).toHaveBeenCalledWith(
      "installed-plugin",
      "official",
    );
  });
});
