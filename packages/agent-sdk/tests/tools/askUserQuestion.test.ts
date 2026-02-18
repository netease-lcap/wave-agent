import { describe, it, expect, vi } from "vitest";
import { askUserQuestionTool } from "../../src/tools/askUserQuestion.js";
import { ToolContext } from "../../src/tools/types.js";

describe("AskUserQuestion Tool", () => {
  it("should have correct tool configuration", () => {
    expect(askUserQuestionTool.name).toBe("AskUserQuestion");
    expect(askUserQuestionTool.config.function.name).toBe("AskUserQuestion");
    expect(askUserQuestionTool.prompt?.()).toBeDefined();
    expect(typeof askUserQuestionTool.prompt?.()).toBe("string");
  });

  it("should execute successfully when user provides answers", async () => {
    const mockPermissionManager = {
      createContext: vi.fn().mockReturnValue({}),
      checkPermission: vi.mocked(vi.fn()).mockResolvedValue({
        behavior: "allow",
        message: JSON.stringify({ "What is your name?": "Alice" }),
      }),
    };

    const context = {
      permissionManager: mockPermissionManager,
      permissionMode: "default",
    } as unknown as ToolContext;

    const args = {
      questions: [
        {
          question: "What is your name?",
          header: "Name",
          options: [{ label: "Alice" }, { label: "Bob" }],
        },
      ],
    };

    const result = await askUserQuestionTool.execute(
      args as unknown as Record<string, unknown>,
      context,
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toEqual({
      answers: { "What is your name?": "Alice" },
    });
    expect(mockPermissionManager.checkPermission).toHaveBeenCalled();
  });

  it("should return error when user denies", async () => {
    const mockPermissionManager = {
      createContext: vi.fn().mockReturnValue({}),
      checkPermission: vi.mocked(vi.fn()).mockResolvedValue({
        behavior: "deny",
        message: "User cancelled",
      }),
    };

    const context = {
      permissionManager: mockPermissionManager,
      permissionMode: "default",
    } as unknown as ToolContext;

    const args = {
      questions: [
        {
          question: "What is your name?",
          header: "Name",
          options: [{ label: "Alice" }, { label: "Bob" }],
        },
      ],
    };

    const result = await askUserQuestionTool.execute(
      args as unknown as Record<string, unknown>,
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("User cancelled");
  });

  it("should handle multiple questions and multi-select", async () => {
    const mockPermissionManager = {
      createContext: vi.fn().mockReturnValue({}),
      checkPermission: vi.mocked(vi.fn()).mockResolvedValue({
        behavior: "allow",
        message: JSON.stringify({
          "Question 1": "Option A",
          "Question 2": "Option B, Option C",
        }),
      }),
    };

    const context = {
      permissionManager: mockPermissionManager,
      permissionMode: "default",
    } as unknown as ToolContext;

    const args = {
      questions: [
        {
          question: "Question 1",
          options: [{ label: "Option A" }, { label: "Option B" }],
        },
        {
          question: "Question 2",
          multiSelect: true,
          options: [
            { label: "Option A" },
            { label: "Option B" },
            { label: "Option C" },
          ],
        },
      ],
    };

    const result = await askUserQuestionTool.execute(
      args as unknown as Record<string, unknown>,
      context,
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toEqual({
      answers: {
        "Question 1": "Option A",
        "Question 2": "Option B, Option C",
      },
    });
  });
});
