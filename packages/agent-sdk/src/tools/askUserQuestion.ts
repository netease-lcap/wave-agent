import { ToolPlugin } from "./types.js";
import { AskUserQuestionInput } from "../types/tools.js";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
} from "../constants/tools.js";

export const askUserQuestionTool: ToolPlugin = {
  name: ASK_USER_QUESTION_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: ASK_USER_QUESTION_TOOL_NAME,
      description: `Asks the user multiple choice questions to gather information, clarify ambiguity, understand preferences, make decisions or offer them choices.
Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ${EXIT_PLAN_MODE_TOOL_NAME} for plan approval.`,
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description: "The complete question to ask the user.",
                },
                header: {
                  type: "string",
                  maxLength: 12,
                  description:
                    "Very short label displayed as a chip/tag (max 12 chars).",
                },
                options: {
                  type: "array",
                  minItems: 2,
                  maxItems: 4,
                  items: {
                    type: "object",
                    properties: {
                      label: {
                        type: "string",
                        description: "The display text for this option.",
                      },
                      description: {
                        type: "string",
                        description: "Explanation of what this option means.",
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
                  description: "Allow multiple answers to be selected.",
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
