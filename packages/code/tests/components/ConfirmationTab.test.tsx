import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render } from "ink-testing-library";
import { ConfirmationSelector } from "../../src/components/ConfirmationSelector.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { PermissionDecision } from "wave-agent-sdk";

describe("Confirmation Tab Navigation", () => {
  let mockOnDecision: Mock<(decision: PermissionDecision) => void>;
  let mockOnCancel: Mock<() => void>;
  let mockOnAbort: Mock<() => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockOnDecision = vi.fn<(decision: PermissionDecision) => void>();
    mockOnCancel = vi.fn<() => void>();
    mockOnAbort = vi.fn<() => void>();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should handle Tab key navigation for normal tools", async () => {
    const { stdin, lastFrame } = render(
      <ConfirmationSelector
        toolName="Edit"
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    // Press Tab 3 times to cycle back to first option
    stdin.write("\t\t\t");

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
    });
  });

  it("should handle Shift+Tab key navigation for normal tools", async () => {
    const { stdin, lastFrame } = render(
      <ConfirmationSelector
        toolName="Edit"
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    // Press Shift+Tab twice to go to "Yes, and auto-accept edits"
    stdin.write("\u001b[Z"); // Shift+Tab to last
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "> Type here to tell Wave what to change",
      );
    });
    stdin.write("\u001b[Z"); // Shift+Tab to second to last

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "> Yes, and auto-accept edits",
      );
    });
  });

  it("should handle Tab key navigation for AskUserQuestion (cycling questions)", async () => {
    const mockQuestions = {
      questions: [
        {
          question: "Question 1",
          header: "Q1",
          options: [{ label: "A" }, { label: "B" }],
        },
        {
          question: "Question 2",
          header: "Q2",
          options: [{ label: "C" }, { label: "D" }],
        },
      ],
    };

    const { stdin, lastFrame } = render(
      <ConfirmationSelector
        toolName="AskUserQuestion"
        toolInput={mockQuestions as unknown as Record<string, unknown>}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    // Select B and cycle through questions
    stdin.write("\u001b[B"); // Down to B
    stdin.write("\t"); // Tab to Q2
    stdin.write("\t"); // Tab back to Q1

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("Question 1");
      expect(frame).toContain("> B");
    });
  });

  it("should preserve 'Other' text when cycling questions", async () => {
    const mockQuestions = {
      questions: [
        {
          question: "Question 1",
          header: "Q1",
          options: [{ label: "A" }],
        },
        {
          question: "Question 2",
          header: "Q2",
          options: [{ label: "B" }],
        },
      ],
    };

    const { stdin, lastFrame } = render(
      <ConfirmationSelector
        toolName="AskUserQuestion"
        toolInput={mockQuestions as unknown as Record<string, unknown>}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    // Select Other, type "Custom", and cycle
    stdin.write("\u001b[B"); // Down to Other
    stdin.write("Custom");
    stdin.write("\t"); // Tab to Q2
    stdin.write("\t"); // Tab back to Q1

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("Question 1");
      expect(frame).toContain("Custom");
    });
  });

  it("should preserve multi-select state when cycling questions", async () => {
    const mockQuestions = {
      questions: [
        {
          question: "Question 1",
          header: "Q1",
          multiSelect: true,
          options: [{ label: "A" }, { label: "B" }],
        },
        {
          question: "Question 2",
          header: "Q2",
          options: [{ label: "C" }],
        },
      ],
    };

    const { stdin, lastFrame } = render(
      <ConfirmationSelector
        toolName="AskUserQuestion"
        toolInput={mockQuestions as unknown as Record<string, unknown>}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    // Toggle A and B, then cycle
    stdin.write(" "); // Toggle A
    stdin.write("\u001b[B"); // Down to B
    stdin.write(" "); // Toggle B
    stdin.write("\t"); // Tab to Q2
    stdin.write("\t"); // Tab back to Q1

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("Question 1");
      expect(frame).toContain("[x] A");
      expect(frame).toContain("[x] B");
    });
  });

  it("should collect all answers when Enter is pressed on the last question after cycling", async () => {
    const mockQuestions = {
      questions: [
        {
          question: "Question 1",
          header: "Q1",
          options: [{ label: "A" }],
        },
        {
          question: "Question 2",
          header: "Q2",
          options: [{ label: "B" }],
        },
      ],
    };

    const { stdin } = render(
      <ConfirmationSelector
        toolName="AskUserQuestion"
        toolInput={mockQuestions as unknown as Record<string, unknown>}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    // Tab to Q2, press Enter (should not submit), Tab back to Q1, press Enter (should move to Q2), press Enter (should submit)
    stdin.write("\t"); // Q2
    stdin.write("\r"); // Enter on Q2 (unanswered Q1)
    stdin.write("\t"); // Q1
    stdin.write("\r"); // Enter on Q1 (select A)
    stdin.write("\r"); // Enter on Q2 (select B)

    await vi.waitFor(() => {
      expect(mockOnDecision).toHaveBeenCalled();
    });

    const call = mockOnDecision.mock.calls[0][0];
    const message = JSON.parse(call.message!);
    expect(message["Question 1"]).toBe("A");
    expect(message["Question 2"]).toBe("B");
  });

  it("should handle Shift+Tab key navigation for AskUserQuestion (cycling questions)", async () => {
    const mockQuestions = {
      questions: [
        {
          question: "Question 1",
          header: "Q1",
          options: [{ label: "A" }, { label: "B" }],
        },
        {
          question: "Question 2",
          header: "Q2",
          options: [{ label: "C" }, { label: "D" }],
        },
      ],
    };

    const { stdin, lastFrame } = render(
      <ConfirmationSelector
        toolName="AskUserQuestion"
        toolInput={mockQuestions as unknown as Record<string, unknown>}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    // Cycle backwards
    stdin.write("\u001b[Z"); // Shift+Tab to Q2
    stdin.write("\u001b[Z"); // Shift+Tab back to Q1

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 1");
    });
  });

  it("should show updated help text", async () => {
    const { lastFrame } = render(
      <ConfirmationSelector
        toolName="Edit"
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "Use ↑↓ or Tab to navigate • ESC to cancel",
      );
    });
  });

  it("should show updated help text for AskUserQuestion", async () => {
    const mockQuestions = {
      questions: [
        {
          question: "What is your favorite color?",
          header: "Color",
          options: [{ label: "Red" }, { label: "Blue" }],
        },
      ],
    };

    const { lastFrame } = render(
      <ConfirmationSelector
        toolName="AskUserQuestion"
        toolInput={mockQuestions as unknown as Record<string, unknown>}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "Use ↑↓ or Tab to navigate • Enter to confirm",
      );
    });
  });
});
