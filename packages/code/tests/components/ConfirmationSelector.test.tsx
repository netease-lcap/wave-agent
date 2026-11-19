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
import { render } from "../helpers/inkHarness.js";
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

  describe("Bash bypass permissions option", () => {
    it("should show bypass option for Bash tool", async () => {
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="Bash"
          toolInput={{ command: "ls -la" }}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Yes, and bypass permissions",
        );
      });
    });

    it("should not show bypass option for non-Bash tools", async () => {
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="Edit"
          toolInput={{ file_path: "test.ts" }}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("Yes, proceed");
      });
      expect(stripAnsiColors(lastFrame() || "")).not.toContain(
        "bypass permissions",
      );
    });

    it("should allow with bypassPermissions mode when bypass option selected", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="Bash"
          toolInput={{ command: "ls -la" }}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });
      stdin.write("\u001b[B"); // Down to auto
      stdin.write("\u001b[B"); // Down to bypass
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Yes, and bypass permissions",
        );
      });
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalledWith({
          behavior: "allow",
          newPermissionMode: "bypassPermissions",
        });
      });
    });

    it("should show bypass option even when persistent option is hidden", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="Bash"
          toolInput={{ command: "rm -rf temp/" }}
          hidePersistentOption
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        const frame = stripAnsiColors(lastFrame() || "");
        expect(frame).toContain("Yes, and bypass permissions");
        expect(frame).not.toContain("don't ask again");
      });

      stdin.write("\u001b[B"); // Down from allow to bypass (auto hidden)
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Yes, and bypass permissions",
        );
      });
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalledWith({
          behavior: "allow",
          newPermissionMode: "bypassPermissions",
        });
      });
    });

    it("should not show bypass option for Bash in plan mode", async () => {
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="Bash"
          toolInput={{ command: "ls -la" }}
          permissionMode="plan"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("Yes, proceed");
      });
      expect(stripAnsiColors(lastFrame() || "")).not.toContain(
        "bypass permissions",
      );
    });

    it("should navigate from allow straight to alternative for Bash in plan mode", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="Bash"
          toolInput={{ command: "ls -la" }}
          permissionMode="plan"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
      });
      stdin.write("\u001b[B"); // Down to auto
      stdin.write("\u001b[B"); // Down — bypass skipped, lands on alternative
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Type here to tell Wave what to change",
        );
      });
    });
  });

  describe("ExitPlanMode bypass permissions option", () => {
    it("should show bypass option for ExitPlanMode", async () => {
      const { lastFrame } = render(
        <ConfirmationSelector
          toolName="ExitPlanMode"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Yes, and bypass permissions",
        );
      });
    });

    it("should allow with bypassPermissions mode when bypass option selected for ExitPlanMode", async () => {
      const { stdin, lastFrame } = render(
        <ConfirmationSelector
          toolName="ExitPlanMode"
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Yes, manually approve edits",
        );
      });
      stdin.write("\u001b[B"); // Down to auto-accept
      stdin.write("\u001b[B"); // Down to bypass
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "> Yes, and bypass permissions",
        );
      });
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalledWith({
          behavior: "allow",
          newPermissionMode: "bypassPermissions",
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

  describe("Bracketed paste handling", () => {
    it("should strip bracketed paste markers when pasting into alternative text", async () => {
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
      // Navigate to alternative
      stdin.write("\u001b[B");
      stdin.write("\u001b[B");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type here to tell Wave what to change",
        );
      });

      // Paste with bracketed paste markers
      stdin.write("\u001b[200~fix the typo in src/main.ts\u001b[201~");

      await vi.waitFor(() => {
        const frame = stripAnsiColors(lastFrame() || "");
        expect(frame).toContain("fix the typo in src/main.ts");
        expect(frame).not.toContain("[200~");
        expect(frame).not.toContain("[201~");
      });
    });

    it("should strip bracketed paste markers when pasting into AskUserQuestion Other text", async () => {
      const mockQuestions = {
        questions: [
          {
            question: "What color?",
            header: "Color",
            options: [{ label: "Red" }, { label: "Blue" }],
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
        expect(stripAnsiColors(lastFrame() || "")).toContain("What color?");
      });
      // Navigate to Other
      stdin.write("\u001b[B");
      stdin.write("\u001b[B");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("Other");
      });

      // Paste with bracketed paste markers
      stdin.write("\u001b[200~green-ish\u001b[201~");

      await vi.waitFor(() => {
        const frame = stripAnsiColors(lastFrame() || "");
        expect(frame).toContain("green-ish");
        expect(frame).not.toContain("[200~");
        expect(frame).not.toContain("[201~");
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
      const message = JSON.parse(call.message!).answers;
      expect(message["Are you sure?"]).toBe("Yes");
    });

    it("submits with no answer when a multi-select question has no selections", async () => {
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

      // 最后一题回车照常提交：一题都没勾就是「没答」，整条省略而不是写空串。
      stdin.write("\r");

      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalled();
      });
      const payload = JSON.parse(mockOnDecision.mock.calls[0][0].message!);
      expect(payload.answers).toEqual({});
    });

    it("submits from the last question while an earlier one is unanswered", async () => {
      const mockQuestions = {
        questions: [
          {
            question: "Pick a layout",
            header: "Layout",
            options: [
              { label: "紧凑", preview: "预览内容 A" },
              { label: "宽松", preview: "预览内容 B" },
            ],
          },
          {
            question: "Pick a size",
            header: "Size",
            options: [{ label: "S" }, { label: "M" }],
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
        expect(stripAnsiColors(lastFrame() || "")).toContain("Pick a layout");
      });

      // 预览题首屏没有聚焦项，直接 Tab 到最后一题：第一题既没选也没备注。
      stdin.write("\t");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("Pick a size");
      });
      stdin.write("\r"); // 回车不再被未答的第一题拦下

      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalled();
      });
      const payload = JSON.parse(mockOnDecision.mock.calls[0][0].message!);
      expect(payload.answers).toEqual({ "Pick a size": "S" });
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
      const message = JSON.parse(call.message!).answers;
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

  describe("AskUserQuestion option preview", () => {
    const previewInput = {
      questions: [
        {
          question: "选哪个版式？",
          header: "Layout",
          options: [
            { label: "方案 A", preview: "预览内容 A" },
            { label: "方案 B", preview: "预览内容 B" },
          ],
        },
      ],
    };

    const renderPreview = () =>
      render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={previewInput as unknown as Record<string, unknown>}
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

    it("renders the side-by-side preview and drops the Other row", async () => {
      const { lastFrame, settle } = renderPreview();

      await settle();
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("1. 方案 A");
      // 首屏没有聚焦项：没有任何一行高亮，预览区是「先选一个」的占位。
      expect(frame).not.toContain("> 1. 方案 A");
      expect(frame).toContain("(↑↓ 选一个选项查看预览)");
      expect(frame).toContain("Notes:");
      expect(frame).toContain("press n to add notes");
      expect(frame).toContain("↑↓ to select • Enter to confirm");
      expect(frame).not.toContain("Other");
    });

    it("previews an option once an arrow key focuses it", async () => {
      const { stdin, lastFrame } = renderPreview();
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "(↑↓ 选一个选项查看预览)",
        );
      });

      stdin.write("\u001b[B");

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("预览内容 A");
      });
      expect(stripAnsiColors(lastFrame() || "")).toContain("> 1. 方案 A");
    });

    it("switches the preview when the focus moves", async () => {
      const { stdin, lastFrame } = renderPreview();
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "(↑↓ 选一个选项查看预览)",
        );
      });

      stdin.write("\u001b[B");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("预览内容 A");
      });

      stdin.write("\u001b[B");

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("预览内容 B");
      });
    });

    it("submits the notes alone when no option was ever focused", async () => {
      const { stdin, lastFrame } = renderPreview();
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "(↑↓ 选一个选项查看预览)",
        );
      });

      stdin.write("n");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).not.toContain(
          "press n to add notes",
        );
      });

      stdin.write("just notes");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("just notes");
      });

      stdin.write("\r"); // leave the notes field
      stdin.write("\r"); // submit

      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalled();
      });
      const payload = JSON.parse(mockOnDecision.mock.calls[0][0].message!);
      // 备注就是答案，答案位上写明确的「未选选项」哨兵而不是空串。
      expect(payload.answers["选哪个版式？"]).toBe("(notes only)");
      expect(payload.annotations["选哪个版式？"]).toEqual({
        notes: "just notes",
      });
    });

    it("sends the selected preview and notes back as annotations", async () => {
      const { stdin, lastFrame } = renderPreview();
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "(↑↓ 选一个选项查看预览)",
        );
      });

      stdin.write("\u001b[B"); // focus 方案 A
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("预览内容 A");
      });

      stdin.write("n");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).not.toContain(
          "press n to add notes",
        );
      });

      stdin.write("wider columns");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("wider columns");
      });

      stdin.write("\r"); // leave the notes field
      stdin.write("\r"); // submit

      await vi.waitFor(() => {
        expect(mockOnDecision).toHaveBeenCalled();
      });
      const payload = JSON.parse(mockOnDecision.mock.calls[0][0].message!);
      expect(payload.answers["选哪个版式？"]).toBe("方案 A");
      expect(payload.annotations["选哪个版式？"]).toEqual({
        preview: "预览内容 A",
        notes: "wider columns",
      });
    });

    it("truncates a long preview and reports how many lines are hidden", async () => {
      // The harness fixes rows at 24; one option occupies one row and the card
      // spends 10 rows on chrome, so the preview body keeps 13 content lines.
      const lines = Array.from(
        { length: 20 },
        (_, index) => `- 第 ${index + 1} 行`,
      );
      const { lastFrame, settle, stdin } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={
            {
              questions: [
                {
                  question: "选哪个版式？",
                  header: "Layout",
                  options: [{ label: "方案 A", preview: lines.join("\n") }],
                },
              ],
            } as unknown as Record<string, unknown>
          }
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      stdin.write("\u001b[B"); // focus the only option
      await settle();
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("第 1 行");
      expect(frame).not.toContain("第 20 行");
      expect(frame).toContain("还有 7 行");
    });

    it("wraps a long option label instead of truncating it", async () => {
      const label =
        "方案 A：把侧边栏整体挪到左侧，并把预览面板拉到右侧吃满剩余宽度";
      const { lastFrame, settle } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={
            {
              questions: [
                {
                  question: "选哪个版式？",
                  header: "Layout",
                  options: [
                    { label, preview: "预览内容 A" },
                    { label: "方案 B", preview: "预览内容 B" },
                  ],
                },
              ],
            } as unknown as Record<string, unknown>
          }
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await settle();
      const frame = stripAnsiColors(lastFrame() || "");
      // The tail is what a single truncated row would have eaten.
      expect(frame).toContain("剩余宽度");
      expect(frame).not.toContain("…");
    });

    it("drops the option description in preview mode only", async () => {
      const { lastFrame, settle } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={
            {
              questions: [
                {
                  question: "选哪个版式？",
                  header: "Layout",
                  options: [
                    {
                      label: "方案 A",
                      description: "紧凑版侧的预览说明",
                      preview: "预览内容 A",
                    },
                    { label: "方案 B", preview: "预览内容 B" },
                  ],
                },
              ],
            } as unknown as Record<string, unknown>
          }
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await settle();
      expect(stripAnsiColors(lastFrame() || "")).not.toContain(
        "紧凑版侧的预览说明",
      );

      const plain = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={
            {
              questions: [
                {
                  question: "选哪些模块？",
                  header: "Modules",
                  multiSelect: true,
                  options: [
                    {
                      label: "模块 A",
                      description: "紧凑版侧的预览说明",
                      preview: "预览内容 A",
                    },
                    { label: "模块 B", preview: "预览内容 B" },
                  ],
                },
              ],
            } as unknown as Record<string, unknown>
          }
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await plain.settle();
      expect(stripAnsiColors(plain.lastFrame() || "")).toContain(
        "紧凑版侧的预览说明",
      );
    });

    it("shrinks the preview when the option list wraps taller", async () => {
      const preview = Array.from(
        { length: 30 },
        (_, index) => `- 第 ${index + 1} 行`,
      ).join("\n");
      const hiddenLines = (frame: string) => {
        const match = frame.match(/还有 (\d+) 行/);
        return match ? Number(match[1]) : 0;
      };
      const renderWith = async (labels: string[]) => {
        const view = render(
          <ConfirmationSelector
            toolName="AskUserQuestion"
            toolInput={
              {
                questions: [
                  {
                    question: "选哪个版式？",
                    header: "Layout",
                    options: labels.map((label) => ({ label, preview })),
                  },
                ],
              } as unknown as Record<string, unknown>
            }
            onDecision={mockOnDecision}
            onCancel={mockOnCancel}
          />,
        );
        view.stdin.write("\u001b[B"); // focus the first option so its preview renders
        await view.settle();
        return () => hiddenLines(stripAnsiColors(view.lastFrame() || ""));
      };

      const shortLabels = await renderWith(["方案 A", "方案 B"]);
      const longLabels = await renderWith([
        "方案 A：把侧边栏整体挪到左侧并把预览面板拉到右侧吃满剩余宽度",
        "方案 B：保持上下堆叠，选项在上预览在下",
      ]);

      const shortHidden = shortLabels();
      expect(shortHidden).toBeGreaterThan(0);
      // The wrapped labels only show up once the measured height has landed, so
      // this waits on the layout commit rather than on a rendered frame.
      await vi.waitFor(() => expect(longLabels()).toBeGreaterThan(shortHidden));
    });

    it("keeps the fixed option column on a narrow terminal", async () => {
      // 60 columns: 30 for the list, 4 blank, 26 for the preview. The preview's
      // content is truncated only when painting, so its unwrapped width used to
      // make Yoga shrink the fixed column to ~20 columns while ten columns went
      // unused — the label then wrapped a line earlier than 30 columns allow.
      const { lastFrame, settle } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={
            {
              questions: [
                {
                  question: "选哪个版式？",
                  header: "Layout",
                  options: [
                    {
                      label:
                        "方案 A：把侧边栏整体挪到左侧，并把预览面板拉到右侧吃满剩余宽度",
                      preview: Array.from(
                        { length: 10 },
                        (_, index) =>
                          `- 预览第 ${index + 1} 行：这一行够长，用来占住列宽看看会不会换行`,
                      ).join("\n"),
                    },
                    { label: "方案 B", preview: "预览内容 B" },
                  ],
                },
              ],
            } as unknown as Record<string, unknown>
          }
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
        { columns: 60 },
      );

      await settle();
      const frame = stripAnsiColors(lastFrame() || "");
      // 30 cells — exactly what only a 30-column list can hold on one row.
      expect(frame).toContain("预览面板拉到右侧吃满剩余宽度");
    });

    it("shows a placeholder when the focused option has no preview", async () => {
      const { lastFrame, stdin, settle } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={
            {
              questions: [
                {
                  question: "选哪个版式？",
                  header: "Layout",
                  options: [
                    { label: "方案 A", preview: "预览内容 A" },
                    { label: "方案 B" },
                  ],
                },
              ],
            } as unknown as Record<string, unknown>
          }
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await settle();
      // 首屏还没有聚焦项：预览区先给「先选一个」的占位。
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "(↑↓ 选一个选项查看预览)",
      );

      stdin.write("\u001b[B");
      await settle();
      expect(stripAnsiColors(lastFrame() || "")).toContain("预览内容 A");

      stdin.write("\u001b[B");
      await settle();
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "(这个选项没有预览)",
      );
    });

    it("keeps the plain list when the question is multi-select", async () => {
      const { lastFrame, settle } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={
            {
              questions: [
                {
                  question: "选哪些模块？",
                  header: "Modules",
                  multiSelect: true,
                  options: [
                    { label: "模块 A", preview: "预览内容 A" },
                    { label: "模块 B", preview: "预览内容 B" },
                  ],
                },
              ],
            } as unknown as Record<string, unknown>
          }
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await settle();
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).not.toContain("预览内容 A");
      expect(frame).toContain("Other");
    });

    it("decides preview per question instead of per prompt", async () => {
      const { lastFrame, stdin, settle } = render(
        <ConfirmationSelector
          toolName="AskUserQuestion"
          toolInput={
            {
              questions: [
                {
                  question: "选哪个版式？",
                  header: "Layout",
                  options: [{ label: "方案 A", preview: "预览内容 A" }],
                },
                {
                  question: "选哪个范围？",
                  header: "Scope",
                  options: [{ label: "大" }, { label: "小" }],
                },
              ],
            } as unknown as Record<string, unknown>
          }
          onDecision={mockOnDecision}
          onCancel={mockOnCancel}
        />,
      );

      await settle();
      // 预览题首屏无聚焦项，预览区只有占位；切题后整块预览面板消失。
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "(↑↓ 选一个选项查看预览)",
      );

      stdin.write("\t");
      await settle();
      const afterTab = stripAnsiColors(lastFrame() || "");
      expect(afterTab).toContain("选哪个范围？");
      expect(afterTab).toContain("Other");
      expect(afterTab).not.toContain("Notes:");
    });
  });
});
