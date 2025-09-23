import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { InputBox } from "@/components/InputBox";

describe("InputBox Loading State", () => {
  it("should show normal placeholder when not loading", async () => {
    const { lastFrame } = render(<InputBox isLoading={false} />);
    const output = lastFrame();

    expect(output).toContain("Type your message");
    expect(output).not.toContain("Press Esc to abort");
  });

  it("should show normal placeholder and abort hint when loading", async () => {
    const { lastFrame } = render(<InputBox isLoading={true} />);
    const output = lastFrame();

    // Should show normal placeholder
    expect(output).toContain("Type your message");

    // Should show abort hint (may be wrapped)
    expect(output).toMatch(/Press Esc to[\s\S]*abort/);
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
    expect(output).toMatch(/Press Esc to[\s\S]*abort/);
  });

  it("should default to not loading when no props provided", async () => {
    const { lastFrame } = render(<InputBox />);
    const output = lastFrame();

    expect(output).toContain("Type your message");
    expect(output).not.toContain("Press Esc to abort");
  });
});
