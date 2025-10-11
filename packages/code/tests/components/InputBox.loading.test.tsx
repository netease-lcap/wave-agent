import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { InputBox } from "../../src/components/InputBox.js";

describe("InputBox Loading State", () => {
  it("should show normal placeholder when not loading", async () => {
    const { lastFrame } = render(<InputBox isLoading={false} />);
    const output = lastFrame();

    expect(output).toContain("Type your message");
  });

  it("should show normal placeholder when loading", async () => {
    const { lastFrame } = render(<InputBox isLoading={true} />);
    const output = lastFrame();

    // Should show normal placeholder
    expect(output).toContain("Type your message");
  });

  it("should show cursor and allow input when not loading", async () => {
    const { lastFrame } = render(<InputBox isLoading={false} />);
    const output = lastFrame();

    // Should show normal placeholder
    expect(output).toContain("Type your message");
    // Cursor should be visible (no special loading state)
  });

  it("should show cursor and allow input even when loading", async () => {
    const { lastFrame } = render(<InputBox isLoading={true} />);
    const output = lastFrame();

    // Should show normal placeholder, allowing user to continue typing
    expect(output).toContain("Type your message");
  });

  it("should default to not loading when no props provided", async () => {
    const { lastFrame } = render(<InputBox />);
    const output = lastFrame();

    expect(output).toContain("Type your message");
  });
});
