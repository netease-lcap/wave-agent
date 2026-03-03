import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { HelpView } from "../../src/components/HelpView.js";
import { stripAnsiColors, type SlashCommand } from "wave-agent-sdk";

describe("HelpView", () => {
  it("should render help items", () => {
    const { lastFrame } = render(<HelpView onCancel={() => {}} />);
    const output = stripAnsiColors(lastFrame() || "");
    expect(output).toContain("General");
    expect(output).toContain("Commands");
    expect(output).toContain("@");
    expect(output).toContain("Reference files");
    expect(output).toContain("/");
    expect(output).toContain("Commands");
    expect(output).toContain("Ctrl+R");
    expect(output).toContain("Search history");
    expect(output).toContain("Shift+Tab");
    expect(output).toContain("Cycle permission mode");
  });

  it("should call onCancel when Escape is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(<HelpView onCancel={onCancel} />);

    stdin.write("\u001b"); // Escape

    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it("should not call onCancel when Enter is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(<HelpView onCancel={onCancel} />);

    stdin.write("\r"); // Enter

    // Wait a bit to ensure it's NOT called
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("should switch tabs when Tab is pressed", async () => {
    const { lastFrame, stdin } = render(<HelpView onCancel={() => {}} />);

    // Initially on General tab
    expect(stripAnsiColors(lastFrame() || "")).toContain("Reference files");

    // Press Tab to switch to Commands tab
    stdin.write("\t");

    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("/clear");
      expect(output).not.toContain("Reference files");
    });

    // Press Tab again to switch back to General tab
    stdin.write("\t");

    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("Reference files");
      expect(output).not.toContain("/clear");
    });
  });

  it("should show Custom Commands tab when custom commands are provided", async () => {
    const customCommands = [
      {
        id: "custom",
        name: "custom",
        description: "Custom command description",
        handler: async () => {},
      },
    ];
    const { lastFrame, stdin } = render(
      <HelpView
        onCancel={() => {}}
        commands={customCommands as SlashCommand[]}
      />,
    );

    expect(stripAnsiColors(lastFrame() || "")).toContain("Custom Commands");

    // Press Tab to switch to Commands tab
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("/clear");
    });

    // Press Tab again to switch to Custom Commands tab
    stdin.write("\t");
    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("/custom");
      expect(output).toContain("Custom command description");
    });

    // Press Tab again to switch back to General tab
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Reference files");
    });
  });

  it("should not show Custom Commands tab when no custom commands are provided", () => {
    const { lastFrame } = render(<HelpView onCancel={() => {}} />);
    expect(stripAnsiColors(lastFrame() || "")).not.toContain("Custom Commands");
  });
});
