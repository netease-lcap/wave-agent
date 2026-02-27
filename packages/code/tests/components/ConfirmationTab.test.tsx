import React from "react";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render } from "ink-testing-library";
import { ConfirmationSelector } from "../../src/components/ConfirmationSelector.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { PermissionDecision } from "wave-agent-sdk";

describe("Confirmation Tab Navigation", () => {
  let mockOnDecision: Mock<(decision: PermissionDecision) => void>;
  let mockOnCancel: Mock<() => void>;
  let mockOnAbort: Mock<() => void>;

  beforeEach(() => {
    mockOnDecision = vi.fn<(decision: PermissionDecision) => void>();
    mockOnCancel = vi.fn<() => void>();
    mockOnAbort = vi.fn<() => void>();
    vi.clearAllMocks();
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

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
    });

    // Press Tab to go to next option
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "> Yes, and auto-accept edits",
      );
    });

    // Press Tab again to go to alternative option
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "> Type here to tell Wave what to change",
      );
    });

    // Press Tab again to cycle back to first option
    stdin.write("\t");
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

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
    });

    // Press Shift+Tab to cycle backwards to last option
    stdin.write("\u001b[Z"); // Shift+Tab
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "> Type here to tell Wave what to change",
      );
    });

    // Press Shift+Tab again
    stdin.write("\u001b[Z");
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

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 1");
    });

    // Select B
    stdin.write("\u001b[B");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("> B");
    });

    // Press Tab to go to Question 2
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 2");
    });

    // Press Tab to cycle back to Question 1
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 1");
    });

    // Verify B is still selected
    expect(stripAnsiColors(lastFrame() || "")).toContain("> B");
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

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 1");
    });

    // Select Other and type "Custom"
    stdin.write("\u001b[B"); // Down to Other
    stdin.write("Custom");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Custom");
    });

    // Tab to Q2
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 2");
    });

    // Tab back to Q1
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 1");
    });

    // Verify "Custom" is still there
    expect(stripAnsiColors(lastFrame() || "")).toContain("Custom");
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

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 1");
    });

    // Toggle A and B
    stdin.write(" "); // Toggle A
    stdin.write("\u001b[B"); // Down to B
    stdin.write(" "); // Toggle B
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("[x] A");
      expect(stripAnsiColors(lastFrame() || "")).toContain("[x] B");
    });

    // Tab to Q2
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 2");
    });

    // Tab back to Q1
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 1");
    });

    // Verify A and B are still checked
    expect(stripAnsiColors(lastFrame() || "")).toContain("[x] A");
    expect(stripAnsiColors(lastFrame() || "")).toContain("[x] B");
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

    const { stdin, lastFrame } = render(
      <ConfirmationSelector
        toolName="AskUserQuestion"
        toolInput={mockQuestions as unknown as Record<string, unknown>}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 1");
    });

    // Tab to Q2
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 2");
    });

    // Select B and press Enter
    stdin.write("\r");

    // Should NOT submit yet because Q1 is unanswered
    await vi.waitFor(() => {
      expect(mockOnDecision).not.toHaveBeenCalled();
    });

    // Tab back to Q1
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 1");
    });

    // Select A and press Enter
    stdin.write("\r");

    // Now it should move to Q2 (since Q1 was answered)
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 2");
    });

    // Press Enter on Q2
    stdin.write("\r");

    // Now it should submit both
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

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 1");
    });

    // Press Shift+Tab to cycle backwards to Question 2
    stdin.write("\u001b[Z");
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Question 2");
    });

    // Press Shift+Tab again to Question 1
    stdin.write("\u001b[Z");
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
