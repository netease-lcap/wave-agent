import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { App } from "../../src/components/App.js";
import { waitForText } from "../helpers/waitHelpers.js";

describe("App Component", () => {
  it("should render the main interface with file count", async () => {
    const { lastFrame } = render(<App />);

    // Wait for the component to initialize and render
    await waitForText(lastFrame, "WAVE Code Assistant");
    expect(lastFrame()).toContain("WAVE Code Assistant");
  });

  it("should render the chat interface", async () => {
    const { lastFrame } = render(<App />);

    // Wait for components to initialize and render
    await waitForText(lastFrame, "Type your message");

    // ChatInterface renders MessageList and InputBox, test overall rendering here
    expect(lastFrame()).toBeTruthy();
    // Can test whether it contains UI elements like input box borders
    expect(lastFrame()).toMatch(/[┌┐└┘│─]/); // Check if there are border characters
  });

  it("should wrap components with providers", async () => {
    const { lastFrame } = render(<App />);

    // Wait for the component to initialize and render
    await waitForText(lastFrame, "Type your message");

    // Verify that the component renders without errors
    expect(lastFrame()).toBeTruthy();
  });
});
