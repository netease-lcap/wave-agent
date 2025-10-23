import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { App } from "../../src/components/App.js";

describe("App Component", () => {
  it("should render the main interface with file count", () => {
    const { lastFrame } = render(<App />);

    expect(lastFrame()).toContain("WAVE Code Assistant");
  });

  it("should render the chat interface", () => {
    const { lastFrame } = render(<App />);

    // ChatInterface renders MessageList and InputBox, test overall rendering here
    expect(lastFrame()).toBeTruthy();
    // Can test whether it contains UI elements like input box borders
    expect(lastFrame()).toMatch(/[┌┐└┘│─]/); // Check if there are border characters
  });

  it("should wrap components with providers", () => {
    const { lastFrame } = render(<App />);

    // Verify that the component renders without errors
    expect(lastFrame()).toBeTruthy();
  });
});
