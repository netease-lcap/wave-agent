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

describe("ConfirmationSelector Additional Coverage", () => {
  let mockOnDecision: Mock<(decision: PermissionDecision) => void>;
  let mockOnCancel: Mock<() => void>;

  beforeEach(() => {
    mockOnDecision = vi.fn<(decision: PermissionDecision) => void>();
    mockOnCancel = vi.fn<() => void>();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("EnterPlanMode Tests", () => {
    it("should default to 'allow' option for EnterPlanMode", async () => {
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="EnterPlanMode"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });
      const frame = lastFrame();
      expect(frame).toContain("> Yes, proceed");
      expect(frame).not.toContain("Yes, clear context");
    });

    it("should show 'start implementing' placeholder when on alternative option", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="EnterPlanMode"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });
      // Navigate to alternative option
      stdin.write("\u001b[B"); // Down to auto
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Yes, and auto-accept edits",
        );
      });
      stdin.write("\u001b[B"); // Down to alternative
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> No, start implementing now",
        );
      });
    });

    it("should allow EnterPlanMode with newPermissionMode: plan", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="EnterPlanMode"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalledWith({
          behavior: "allow",
          newPermissionMode: "plan",
        });
      });
    });

    it("should auto EnterPlanMode with newPermissionMode: plan", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="EnterPlanMode"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });
      stdin.write("\u001b[B"); // Down to auto
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Yes, and auto-accept edits",
        );
      });
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalledWith({
          behavior: "allow",
          newPermissionMode: "plan",
        });
      });
    });

    it("should deny EnterPlanMode with default message when alternative is empty", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="EnterPlanMode"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });
      // Navigate down twice to reach alternative option
      stdin.write("\u001b[B"); // Down to auto
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Yes, and auto-accept edits",
        );
      });
      stdin.write("\u001b[B"); // Down to alternative
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> No, start implementing now",
        );
      });
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalledWith({
          behavior: "deny",
          message: "User chose not to enter plan mode",
        });
      });
    });
  });

  describe("MCP Tool Tests", () => {
    it("should show correct auto text for mcp__ tools", async () => {
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="mcp__github__create_issue"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Yes, and don't ask again for: mcp__github__create_issue",
        );
      });
    });

    it("should auto-allow mcp__ tool with newPermissionRule", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="mcp__github__create_issue"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });
      stdin.write("\u001b[B"); // Down to auto
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Yes, and don't ask again",
        );
      });
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalledWith({
          behavior: "allow",
          newPermissionRule: "mcp__github__create_issue",
        });
      });
    });
  });

  describe("Bash mkdir Tests", () => {
    it("should show 'auto-accept edits' auto text for mkdir command", async () => {
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="Bash"
          toolInput={{ command: "mkdir -p src/components" }}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Yes, and auto-accept edits",
        );
      });
    });

    it("should auto-allow mkdir with acceptEdits mode", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="Bash"
          toolInput={{ command: "mkdir -p src/components" }}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });
      stdin.write("\u001b[B"); // Down to auto
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Yes, and auto-accept edits",
        );
      });
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalledWith({
          behavior: "allow",
          newPermissionMode: "acceptEdits",
        });
      });
    });
  });

  describe("isExpanded Tests", () => {
    it("should render nothing for non-AskUserQuestion tools when isExpanded is true", () => {
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="Edit"
          isExpanded={true}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );
      const frame = lastFrame();
      expect(frame).toBe("");
    });

    it("should render nothing for AskUserQuestion when isExpanded is true", () => {
      const mockQuestions = {
        questions: [
          {
            question: "What color?",
            header: "Color",
            options: [{ label: "Red" }, { label: "Blue" }],
          },
        ],
      };
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={mockQuestions as unknown as Record<string, unknown>}
          isExpanded={true}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );
      const frame = lastFrame();
      expect(frame).toBe("");
    });
  });

  describe("Ctrl/Meta/Alt key filtering", () => {
    it("should not capture Ctrl key as text input", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="Edit"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });

      // Simulate Ctrl+C (common pattern: input with key.ctrl=true)
      stdin.write("\u0003");

      // Should not switch to alternative or show text
      const frame = lastFrame();
      expect(frame).toContain("> Yes, proceed");
      expect(frame).not.toContain("\u0003");
    });

    it("should not capture Alt key as text input", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="Edit"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });

      // Simulate Alt+key - ink passes this as input with key.alt=true
      stdin.write("\u001b"); // Escape prefix for Alt

      // Should remain on allow option
      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain("> Yes, proceed");
      });
    });
  });

  describe("Delete key in alternative text", () => {
    it("should handle delete key for backward deletion (same as backspace)", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="Edit"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type here to tell Wave what to change",
        );
      });

      // Type "ABC"
      stdin.write("ABC");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> ABC");
      });

      // Move cursor left twice (between A and B, position 1)
      stdin.write("\u001b[D");
      stdin.write("\u001b[D");

      // Press Delete key - component treats delete same as backspace
      // Deletes character before cursor (position 0), removing "A"
      stdin.write("\x1b[3~");

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("BC");
      });
    });
  });

  describe("AskUserQuestion edge cases", () => {
    it("should submit immediately when there is only one question", async () => {
      const mockQuestions = {
        questions: [
          {
            question: "Are you sure?",
            header: "Confirm",
            options: [{ label: "Yes" }, { label: "No" }],
          },
        ],
      };

      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={mockQuestions as unknown as Record<string, unknown>}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("Are you sure?");
      });

      stdin.write("\r"); // Select "Yes" and submit (only question)
      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalled();
      });

      const call = mockOnDecision.mock.calls[0][0];
      expect(call.behavior).toBe("allow");
      const message = JSON.parse(call.message!);
      expect(message["Are you sure?"]).toBe("Yes");
    });

    it("should not submit when multi-select has no selections", async () => {
      const mockQuestions = {
        questions: [
          {
            question: "Pick skills",
            header: "Skills",
            multiSelect: true,
            options: [{ label: "TypeScript" }, { label: "React" }],
          },
        ],
      };

      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={mockQuestions as unknown as Record<string, unknown>}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("Pick skills");
      });

      // Press Enter without selecting anything - should not submit
      stdin.write("\r");

      await vi.waitFor(() => {
        // Verify still on the question, not submitted
        expect(stripAnsiColors(lastFrame() || "")).toContain("Pick skills");
      });
      expect(mockOnDecision).not.toHaveBeenCalled();
    });

    it("should submit multi-select with Other text combined", async () => {
      const mockQuestions = {
        questions: [
          {
            question: "Pick skills",
            header: "Skills",
            multiSelect: true,
            options: [{ label: "TypeScript" }],
          },
        ],
      };

      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={mockQuestions as unknown as Record<string, unknown>}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("Pick skills");
      });

      // Toggle TypeScript (Space on focused option)
      stdin.write(" ");
      // Navigate to Other
      stdin.write("\u001b[B");
      // Type custom skill and confirm via space toggle
      stdin.write(" ");

      // Check Other is checked
      await vi.waitFor(() => {
        const frame = stripAnsiColors(lastFrame() || "");
        expect(frame).toContain("[x] Other");
      });

      // Now type the custom text - in multi-select Other, typing goes into otherText
      stdin.write("Python");

      // Submit
      stdin.write("\r");

      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalled();
      });

      const call = mockOnDecision.mock.calls[0][0];
      const message = JSON.parse(call.message!);
      // Both TypeScript (checked via space) and Python (typed in Other)
      expect(message["Pick skills"]).toContain("TypeScript");
      expect(message["Pick skills"]).toContain("Python");
    });
  });

  describe("getAutoOptionText branches", () => {
    it("should show 'Yes, and auto-accept edits' for generic tools", async () => {
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="Write"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Yes, and auto-accept edits",
        );
      });
    });

    it("should auto-allow generic tools with acceptEdits mode", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="Write"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });
      stdin.write("\u001b[B"); // Down to auto
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Yes, and auto-accept edits",
        );
      });
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalledWith({
          behavior: "allow",
          newPermissionMode: "acceptEdits",
        });
      });
    });
  });

  describe("AskUserQuestion with empty questions", () => {
    it("should not crash when questions array is empty", () => {
      const mockQuestions = { questions: [] };

      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={mockQuestions as unknown as Record<string, unknown>}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );
      const frame = lastFrame();
      // Should render empty since currentQuestion is undefined
      expect(frame).toBe("");
    });

    it("should not crash when toolInput has no questions property", () => {
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={{}}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );
      const frame = lastFrame();
      expect(frame).toBe("");
    });
  });
});
