import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { BtwDisplay } from "../../src/components/BtwDisplay.js";
import { BtwState } from "../../src/managers/inputReducer.js";

const usageState: BtwState = {
  question: "",
  answer: "Usage: /btw <your question>",
  isLoading: false,
};

const answeredState: BtwState = {
  question: "what is life?",
  answer: "42",
  isLoading: false,
};

const loadingState: BtwState = {
  question: "what is life?",
  answer: undefined,
  isLoading: true,
};

describe("BtwDisplay", () => {
  it("should render nothing when no question and no answer", () => {
    const { lastFrame } = render(
      <BtwDisplay btwState={{ question: "", isLoading: false }} />,
    );
    expect(lastFrame()).toBe("");
  });

  it("should render the usage message with an Escape-only dismiss hint", () => {
    const { lastFrame } = render(<BtwDisplay btwState={usageState} />);
    const frame = lastFrame();
    expect(frame).toContain("Usage: /btw <your question>");
    expect(frame).toContain("Escape to dismiss");
    expect(frame).not.toContain("Space, Enter, or Escape to dismiss");
  });

  it("should render the dismiss hint for an answered question", () => {
    const { lastFrame } = render(<BtwDisplay btwState={answeredState} />);
    const frame = lastFrame();
    expect(frame).toContain("/btw what is life?");
    expect(frame).toContain("Escape to dismiss");
    expect(frame).not.toContain("↑/↓ to scroll");
    expect(frame).not.toContain("Usage: /btw");
  });

  it("should show the loading text below the question before the first content arrives", () => {
    const { lastFrame } = render(<BtwDisplay btwState={loadingState} />);
    const frame = lastFrame();
    expect(frame).toContain("/btw what is life?");
    expect(frame).toContain("✻ Answering...");
    expect(frame).not.toContain("to dismiss");
  });

  it("should render the streaming partial answer with the loading text below it", () => {
    const { lastFrame } = render(
      <BtwDisplay
        btwState={{
          question: "what is life?",
          answer: "42 is the meaning",
          isLoading: true,
        }}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("42 is the meaning");
    expect(frame).toContain("✻ Answering...");
    // The loading text sits below the streaming chunk (chunk first in the frame)
    expect(frame.indexOf("42 is the meaning")).toBeLessThan(
      frame.indexOf("✻ Answering..."),
    );
  });

  it("should truncate a long streaming answer to the last 30 characters", () => {
    const { lastFrame } = render(
      <BtwDisplay
        btwState={{
          question: "what is life?",
          answer: "The meaning of life is a very long answer",
          isLoading: true,
        }}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("…");
    expect(frame).not.toContain("The meaning of life is");
  });

  it("should hide the loading text once the answer has finished streaming", () => {
    const { lastFrame } = render(<BtwDisplay btwState={answeredState} />);
    const frame = lastFrame();
    expect(frame).toContain("42");
    expect(frame).not.toContain("Answering...");
  });
});
