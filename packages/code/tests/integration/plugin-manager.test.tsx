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
    updatePlugin: vi.fn(),
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
    const setView = vi.fn(function (view) {
      currentView = view;
    });

    (
      usePluginManager as unknown as {
        mockImplementation: (val: unknown) => void;
      }
    ).mockImplementation(function () {
      return {
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
      };
    });

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
      "project",
    );
  });

  it("manages installed plugins", async () => {
    let currentView = "INSTALLED";
    const setView = vi.fn(function (view) {
      currentView = view;
    });

    (
      usePluginManager as unknown as {
        mockImplementation: (val: unknown) => void;
      }
    ).mockImplementation(function () {
      return {
        state: {
          currentView,
          selectedId:
            currentView === "PLUGIN_DETAIL"
              ? "installed-plugin@official"
              : null,
          isLoading: false,
          error: null,
        },
        marketplaces: [],
        installedPlugins: [
          { name: "installed-plugin", marketplace: "official", enabled: true },
        ],
        discoverablePlugins: [],
        actions: { ...mockActions, setView },
      };
    });

    const { stdin, lastFrame, rerender } = render(<PluginManagerShell />);

    expect(stripAnsiColors(lastFrame() || "")).toContain("installed-plugin");

    // Press Enter to go to detail
    stdin.write("\r");
    expect(setView).toHaveBeenCalledWith("PLUGIN_DETAIL");

    // Rerender with new state
    rerender(<PluginManagerShell />);

    expect(stripAnsiColors(lastFrame() || "")).toContain("Plugin Actions:");

    // Press Down to select uninstall (second action)
    stdin.write("\u001B[B");
    await vi.waitFor(() => {
      // Press Enter to uninstall
      stdin.write("\r");
      expect(mockActions.uninstallPlugin).toHaveBeenCalledWith(
        "installed-plugin",
        "official",
      );
    });
  });
});
