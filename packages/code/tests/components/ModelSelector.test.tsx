import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ModelSelector } from "../../src/components/ModelSelector.js";

describe("ModelSelector", () => {
  const defaultProps = {
    onCancel: vi.fn(),
    currentModel: "model-a",
    configuredModels: ["model-a", "model-b"],
    onSelectModel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render list of models and highlight current", () => {
    const { lastFrame } = render(<ModelSelector {...defaultProps} />);
    const output = lastFrame();
    expect(output).toContain("model-a");
    expect(output).toContain("model-b");
    expect(output).toContain("(current)");
  });

  it("should show empty state when no models configured", () => {
    const { lastFrame } = render(
      <ModelSelector {...defaultProps} configuredModels={[]} />,
    );
    expect(lastFrame()).toContain("No models configured");
  });

  it("should call onCancel when Escape is pressed", async () => {
    const { stdin } = render(<ModelSelector {...defaultProps} />);
    stdin.write("\u001B"); // Escape
    await vi.waitFor(() => {
      expect(defaultProps.onCancel).toHaveBeenCalled();
    });
  });

  it("should call onSelectModel and onCancel when Enter is pressed", async () => {
    const { stdin } = render(<ModelSelector {...defaultProps} />);
    stdin.write("\r"); // Enter
    await vi.waitFor(() => {
      expect(defaultProps.onSelectModel).toHaveBeenCalledWith("model-a");
      expect(defaultProps.onCancel).toHaveBeenCalled();
    });
  });

  it("should navigate with arrow keys", async () => {
    const { stdin } = render(<ModelSelector {...defaultProps} />);

    // Move down to model-b
    stdin.write("\u001B[B"); // Down arrow

    await vi.waitFor(() => {
      // Press enter
      stdin.write("\r");
      expect(defaultProps.onSelectModel).toHaveBeenCalledWith("model-b");
    });
  });
});
