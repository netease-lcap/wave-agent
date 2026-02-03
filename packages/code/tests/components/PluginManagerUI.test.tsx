import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginManagerUI } from "../../src/components/PluginManagerUI.js";

describe("PluginManagerUI", () => {
  let mockOnClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnClose = vi.fn();
  });

  it("should render the plugin manager header", () => {
    const { lastFrame } = render(<PluginManagerUI onClose={mockOnClose} />);
    const output = lastFrame();

    expect(output).toContain("Plugin Manager");
    expect(output).toContain("Installed");
    expect(output).toContain("Marketplace");
    expect(output).toContain("Marketplaces");
  });

  it("should show navigation instructions", () => {
    const { lastFrame } = render(<PluginManagerUI onClose={mockOnClose} />);
    const output = lastFrame();

    expect(output).toContain("Tab switch tabs");
    expect(output).toContain("↑↓ navigate");
    expect(output).toContain("Enter select");
    expect(output).toContain("Esc close");
  });

  it("should show loading state initially", () => {
    const { lastFrame } = render(<PluginManagerUI onClose={mockOnClose} />);
    const output = lastFrame();
    expect(output).toContain("Loading...");
  });
});
