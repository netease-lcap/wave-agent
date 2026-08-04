import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, afterEach } from "vitest";
import { BtwDisplay } from "../../src/components/BtwDisplay.js";
import type { BtwState } from "../../src/managers/inputReducer.js";

vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useStdout: vi.fn(() => ({ stdout: { rows: 24 } })),
  };
});

const stripAnsi = (str: string) =>
  str.replace(new RegExp("\\x" + "1B\\[[0-9;]*m", "g"), "");

function renderBtw(state: BtwState) {
  return render(<BtwDisplay btwState={state} />);
}

describe("BtwDisplay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when there is no question or answer", () => {
    const { lastFrame } = renderBtw({
      question: "",
      isLoading: false,
    });
    expect(lastFrame() ?? "").toBe("");
  });

  it("shows the question with a loading indicator while answering", () => {
    const { lastFrame } = renderBtw({
      question: "what is 2+2?",
      isLoading: true,
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("/btw");
    expect(frame).toContain("what is 2+2?");
    expect(frame).toContain("Answering...");
  });

  it("renders the markdown answer and the dismiss hint", () => {
    const { lastFrame } = renderBtw({
      question: "what is 2+2?",
      answer: "**4**",
      isLoading: false,
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("4");
    expect(frame).toContain("↑/↓ to scroll");
  });

  it("renders the bare /btw usage answer without the question line", () => {
    const { lastFrame } = renderBtw({
      question: "",
      answer: "Usage: /btw <your question>",
      isLoading: false,
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Usage: /btw");
    expect(frame).not.toContain("↑/↓ to scroll");
  });

  it("renders API error answers in error color", () => {
    const { lastFrame } = renderBtw({
      question: "q",
      answer: "(API error: timeout)",
      isLoading: false,
    });
    expect(stripAnsi(lastFrame() ?? "")).toContain("(API error: timeout)");
  });

  it("renders tool-call refusal answers in error color", () => {
    const { lastFrame } = renderBtw({
      question: "q",
      answer: "(The model tried to call Bash...)",
      isLoading: false,
    });
    expect(stripAnsi(lastFrame() ?? "")).toContain("The model tried to call");
  });

  it("renders empty-response answers in error color", () => {
    const { lastFrame } = renderBtw({
      question: "q",
      answer: "No response received",
      isLoading: false,
    });
    expect(stripAnsi(lastFrame() ?? "")).toContain("No response received");
  });

  it("honors the scroll offset by slicing the answer", () => {
    const answer = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const { lastFrame } = renderBtw({
      question: "q",
      answer,
      isLoading: false,
      scrollOffset: 20,
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("line 20");
    expect(frame).not.toContain("line 0");
  });
});
