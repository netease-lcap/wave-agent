import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { PluginList } from "../../src/components/PluginList.js";

describe("PluginList", () => {
  const mockPlugins = [
    {
      name: "plugin-1",
      marketplace: "official",
      installed: true,
      version: "1.0.0",
      description: "Description for plugin 1",
      source: "github:owner/repo",
    },
    {
      name: "plugin-2",
      marketplace: "community",
      installed: false,
      description: "Description for plugin 2",
      source: "github:owner/repo2",
    },
  ];

  it("should render 'No plugins found.' when the list is empty", () => {
    const { lastFrame } = render(<PluginList plugins={[]} selectedIndex={0} />);
    expect(lastFrame()).toContain("No plugins found.");
  });

  it("should render a list of plugins with correct details", () => {
    const { lastFrame } = render(
      <PluginList plugins={mockPlugins} selectedIndex={0} />,
    );
    const frame = lastFrame();

    expect(frame).toContain("plugin-1");
    expect(frame).toContain("@official");
    expect(frame).toContain("v1.0.0");
    expect(frame).toContain("Description for plugin 1");

    expect(frame).toContain("plugin-2");
    expect(frame).toContain("@community");
    expect(frame).toContain("Description for plugin 2");
    // plugin-2 doesn't have a version, so it shouldn't show 'v'
    expect(frame).not.toContain("@community v");
  });

  it("should highlight the selected plugin", () => {
    const { lastFrame } = render(
      <PluginList plugins={mockPlugins} selectedIndex={1} />,
    );
    const frame = lastFrame();

    // Selected plugin (index 1) should have "> "
    // Non-selected plugin (index 0) should have "  "
    expect(frame).toContain("  plugin-1");
    expect(frame).toContain("> plugin-2");
  });

  it("should handle missing version correctly", () => {
    const pluginsWithoutVersion = [
      {
        name: "no-version-plugin",
        marketplace: "test",
        installed: false,
        description: "No version here",
        source: "github:owner/repo3",
      },
    ];
    const { lastFrame } = render(
      <PluginList plugins={pluginsWithoutVersion} selectedIndex={0} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("no-version-plugin");
    expect(frame).not.toContain("@test v");
  });
});
