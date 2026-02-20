import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { HelpView } from "../../src/components/HelpView.js";
import { stripAnsiColors } from "wave-agent-sdk";

describe("HelpView", () => {
  it("should render help items", () => {
    const { lastFrame } = render(<HelpView onCancel={() => {}} />);
    const output = stripAnsiColors(lastFrame() || "");

    expect(output).toContain("Help & Key Bindings");
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

  it("should call onCancel when Enter is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(<HelpView onCancel={onCancel} />);

    stdin.write("\r"); // Enter

    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });
});
