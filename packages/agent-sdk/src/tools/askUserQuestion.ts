import { ToolPlugin } from "./types.js";
import { AskUserQuestionInput } from "../types/tools.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "../constants/tools.js";
import { ASK_USER_POLICY } from "../constants/prompts.js";

export const askUserQuestionTool: ToolPlugin = {
  name: ASK_USER_QUESTION_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: ASK_USER_QUESTION_TOOL_NAME,
      description:
        "Asks the user multiple choice questions to gather information, clarify ambiguity, understand preferences, make decisions or offer them choices.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            description: "Questions to ask the user (1-4 questions)",
            items: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description:
                    'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
                },
                header: {
                  type: "string",
                  maxLength: 12,
                  description: `Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".`,
                },
                options: {
                  type: "array",
                  minItems: 2,
                  maxItems: 4,
                  description:
                    "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically.",
                  items: {
                    type: "object",
                    properties: {
                      label: {
                        type: "string",
                        description:
                          "The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.",
                      },
                      description: {
                        type: "string",
                        description:
                          "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
                      },
                      isRecommended: {
                        type: "boolean",
                        description: "Whether this option is recommended.",
                      },
                    },
                    required: ["label"],
                  },
                },
                multiSelect: {
                  type: "boolean",
                  default: false,
                  description:
                    "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
                },
              },
              required: ["question", "header", "options"],
            },
          },
        },
        required: ["questions"],
      },
    },
  },
  prompt: () => ASK_USER_POLICY,
  execute: async (args, context) => {
    const { questions } = args as unknown as AskUserQuestionInput;

    if (!context.permissionManager) {
      throw new Error(
        `Permission manager is required for ${ASK_USER_QUESTION_TOOL_NAME} tool`,
      );
    }

    const permissionContext = context.permissionManager.createContext(
      ASK_USER_QUESTION_TOOL_NAME,
      context.permissionMode || "default",
      context.canUseToolCallback,
      { questions },
    );
    permissionContext.hidePersistentOption = true; // Always hide persistent option for questions

    const decision =
      await context.permissionManager.checkPermission(permissionContext);

    if (decision.behavior === "deny") {
      return {
        success: false,
        content: "",
        error: decision.message || "User declined to answer questions",
      };
    }

    // The answers are expected to be returned in the decision message or a specialized field
    // For now, we assume the UI returns the answers as a JSON string in the message
    try {
      const answers = JSON.parse(decision.message || "{}");
      return {
        success: true,
        content: JSON.stringify({ answers }),
      };
    } catch {
      return {
        success: false,
        content: "",
        error: "Failed to parse user answers",
      };
    }
  },
};
