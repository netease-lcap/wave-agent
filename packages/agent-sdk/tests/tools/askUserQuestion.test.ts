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
    expect(result.content).toBe(
      'Your questions have been answered: "What is your name?"="Alice". You can now continue with these answers in mind.',
    );
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
    expect(result.content).toBe(
      'Your questions have been answered: "Question 1"="Option A", "Question 2"="Option B, Option C". You can now continue with these answers in mind.',
    );
  });

  it("should return error when questions parameter is missing or empty", async () => {
    const context = {
      permissionManager: {},
    } as unknown as ToolContext;

    const args = {
      question: "What is your name?",
      header: "Name",
      options: [{ label: "Alice" }, { label: "Bob" }],
    };

    const result = await askUserQuestionTool.execute(
      args as unknown as Record<string, unknown>,
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "The 'questions' parameter is missing or empty. Please use the correct schema: { questions: [{ question, header, options, multiSelect? }] }",
    );
  });

  describe("option label validation", () => {
    const createContext = () => {
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
      return { mockPermissionManager, context };
    };

    it("should reject an option that is missing its label", async () => {
      const { mockPermissionManager, context } = createContext();

      const args = {
        questions: [
          {
            question: "Which library should we use?",
            header: "Library",
            options: [
              { label: "date-fns", description: "Tree-shakeable" },
              { description: "Only wrote the description" },
            ],
          },
        ],
      };

      const result = await askUserQuestionTool.execute(
        args as unknown as Record<string, unknown>,
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("questions[0].options[1]");
      expect(result.error).toContain("label");
      expect(result.error).toContain("undefined");
      // Validation runs before the permission step, so nothing is rendered.
      expect(mockPermissionManager.createContext).not.toHaveBeenCalled();
      expect(mockPermissionManager.checkPermission).not.toHaveBeenCalled();
    });

    it("should reject an option whose label is an empty string", async () => {
      const { mockPermissionManager, context } = createContext();

      const args = {
        questions: [
          {
            question: "Which library should we use?",
            header: "Library",
            options: [{ label: "" }, { label: "dayjs" }],
          },
        ],
      };

      const result = await askUserQuestionTool.execute(
        args as unknown as Record<string, unknown>,
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("questions[0].options[0]");
      expect(result.error).toContain('(got "")');
      expect(mockPermissionManager.createContext).not.toHaveBeenCalled();
    });

    it("should reject an option whose label is only whitespace", async () => {
      const { mockPermissionManager, context } = createContext();

      const args = {
        questions: [
          {
            question: "Which library should we use?",
            header: "Library",
            options: [{ label: "dayjs" }, { label: "   " }],
          },
        ],
      };

      const result = await askUserQuestionTool.execute(
        args as unknown as Record<string, unknown>,
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("questions[0].options[1]");
      expect(mockPermissionManager.createContext).not.toHaveBeenCalled();
    });

    it("should list every offending option in a single error", async () => {
      const { mockPermissionManager, context } = createContext();

      const args = {
        questions: [
          {
            question: "Which library should we use?",
            header: "Library",
            options: [
              { description: "Missing label" },
              { label: "dayjs" },
              { label: "" },
            ],
          },
        ],
      };

      const result = await askUserQuestionTool.execute(
        args as unknown as Record<string, unknown>,
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("questions[0].options[0]");
      expect(result.error).toContain("questions[0].options[2]");
      expect(mockPermissionManager.createContext).not.toHaveBeenCalled();
    });

    it("should accept labels that are non-empty after trimming", async () => {
      const { mockPermissionManager, context } = createContext();

      const args = {
        questions: [
          {
            question: "What is your name?",
            header: "Name",
            options: [{ label: "  Alice  " }, { label: "Bob" }],
          },
        ],
      };

      const result = await askUserQuestionTool.execute(
        args as unknown as Record<string, unknown>,
        context,
      );

      expect(result.success).toBe(true);
      expect(mockPermissionManager.createContext).toHaveBeenCalled();
    });
  });

  describe("option preview and annotations", () => {
    type JsonSchema = {
      properties: Record<
        string,
        {
          items?: { properties: Record<string, unknown> };
          additionalProperties?: { properties: Record<string, unknown> };
        }
      >;
    };
    const schema = askUserQuestionTool.config.function
      .parameters as unknown as JsonSchema;

    // 选项自带 preview，回执里的 preview 才算「模型自己写的」（准入校验）。
    const PREVIEW = "```\n+-----+\n| A   |\n+-----+\n```";

    const runWith = async (payload: unknown) => {
      const mockPermissionManager = {
        createContext: vi.fn().mockReturnValue({}),
        checkPermission: vi.mocked(vi.fn()).mockResolvedValue({
          behavior: "allow",
          message:
            typeof payload === "string" ? payload : JSON.stringify(payload),
        }),
      };
      const context = {
        permissionManager: mockPermissionManager,
        permissionMode: "default",
      } as unknown as ToolContext;
      return askUserQuestionTool.execute(
        {
          questions: [
            {
              question: "Which layout?",
              options: [{ label: "A", preview: PREVIEW }, { label: "B" }],
            },
          ],
        } as unknown as Record<string, unknown>,
        context,
      );
    };

    it("declares preview on each option and an annotations echo", () => {
      const questionProps = schema.properties.questions.items!.properties as {
        options: { items: { properties: Record<string, unknown> } };
      };
      expect(questionProps.options.items.properties).toHaveProperty("preview");
      expect(schema.properties).toHaveProperty("annotations");
      expect(
        schema.properties.annotations.additionalProperties?.properties,
      ).toHaveProperty("notes");
    });

    it("mentions the preview feature in the tool prompt", () => {
      expect(askUserQuestionTool.prompt?.()).toContain("preview");
    });

    it("returns the selected preview and notes alongside the answers", async () => {
      const result = await runWith({
        answers: { "Which layout?": "A" },
        annotations: {
          "Which layout?": {
            preview: "```\n+-----+\n| A   |\n+-----+\n```",
            notes: "wider columns please",
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe(
        'The user answered: "Which layout?"="A" selected preview:\n' +
          PREVIEW +
          " notes: wider columns please. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.",
      );
    });

    it("still accepts a bare answers map from an older client", async () => {
      const result = await runWith({ "Which layout?": "B" });

      expect(result.success).toBe(true);
      expect(result.content).toBe(
        'Your questions have been answered: "Which layout?"="B". You can now continue with these answers in mind.',
      );
    });

    it("drops an empty annotations object instead of echoing it", async () => {
      const result = await runWith({
        answers: { "Which layout?": "B" },
        annotations: {},
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ answers: { "Which layout?": "B" } });
    });

    it("accepts a preview the host only scrubbed of invisible characters", async () => {
      const scrubbed = PREVIEW + "\u200B";
      const result = await runWith({
        answers: { "Which layout?": "A" },
        annotations: { "Which layout?": { preview: scrubbed } },
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        answers: { "Which layout?": "A" },
        annotations: { "Which layout?": { preview: scrubbed } },
      });
    });

    it("refuses a preview this call never passed for that question", async () => {
      const result = await runWith({
        answers: { "Which layout?": "A" },
        annotations: {
          "Which layout?": { preview: PREVIEW.replace("| A   |", "| Z   |") },
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("AskUserQuestion answer rejected");
      expect(result.error).toContain("not one this call passed");
    });

    it("refuses an answer keyed by a question this call never asked", async () => {
      const result = await runWith({ answers: { "Which framework?": "A" } });

      expect(result.success).toBe(false);
      expect(result.error).toContain("unknown question");
    });

    it("refuses annotations for a question this call never asked", async () => {
      const result = await runWith({
        answers: { "Which layout?": "A" },
        annotations: { "Which framework?": { notes: "hi" } },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("unknown question");
    });

    it("refuses a payload field this call never returned", async () => {
      const result = await runWith({
        answers: { "Which layout?": "A" },
        unanswered: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("unexpected field");
    });

    it("refuses an annotation field that is neither preview nor notes", async () => {
      const result = await runWith({
        answers: { "Which layout?": "A" },
        annotations: { "Which layout?": { label: "A" } },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("unexpected field");
    });

    it("refuses an answer longer than the ceiling the caller was given", async () => {
      const result = await runWith({
        answers: { "Which layout?": "x".repeat(32769) },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("32768");
    });

    it("refuses notes longer than the ceiling the caller was given", async () => {
      const result = await runWith({
        answers: { "Which layout?": "A" },
        annotations: { "Which layout?": { notes: "x".repeat(8193) } },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("8192");
    });

    it("treats the notes-only sentinel without its notes as unanswered", async () => {
      const result = await runWith({
        answers: { "Which layout?": "(notes only)" },
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe("The user did not answer the questions.");
      expect(result.data).toEqual({ answers: {} });
    });

    it("marks the result for a careful read when the answer is not an option", async () => {
      const result = await runWith({
        answers: { "Which layout?": "Neither, use C" },
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        answers: { "Which layout?": "Neither, use C" },
        readCarefully: true,
      });
      expect(result.content).toContain("Read the answers carefully");
    });
  });
});
