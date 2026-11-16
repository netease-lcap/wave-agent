import { ToolPlugin } from "./types.js";
import {
  AskUserQuestionAnnotation,
  AskUserQuestionInput,
} from "../types/tools.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "../constants/tools.js";

/**
 * Collects every option that lacks a usable `label`, as `questions[i].options[j]`
 * paths plus the value actually received.
 *
 * `label` is declared required, and the generic schema walker
 * (`tools/inputValidation.ts`) now does reach the option object, so a missing or
 * non-string `label` is rejected there. What the walker cannot express is
 * "non-empty after trim" — `label: ""` is a perfectly valid `string` to a
 * schema. That is the gap this check closes. The confirmation card renders
 * `option.label` verbatim, so a blank label shows up as an empty row with no
 * way to tell which field is at fault. Reporting each path in one message lets
 * the model fix all of them in a single retry.
 */
function collectOptionLabelErrors(
  questions: AskUserQuestionInput["questions"],
): string[] {
  const errors: string[] = [];
  questions.forEach((question, questionIndex) => {
    const options: unknown = question?.options;
    if (!Array.isArray(options)) return;
    options.forEach((option: unknown, optionIndex) => {
      const label = (option as { label?: unknown } | undefined)?.label;
      if (typeof label === "string" && label.trim() !== "") return;
      const got = label === undefined ? "undefined" : JSON.stringify(label);
      errors.push(
        `questions[${questionIndex}].options[${optionIndex}] is missing a non-empty "label" (got ${got})`,
      );
    });
  });
  return errors;
}

/**
 * Split the confirmation payload into answers plus optional annotations.
 *
 * The current shape is `{ answers, annotations? }`. Hosts and the CLI used to
 * send the answers map on its own, so that shape is still accepted: an old
 * client that knows nothing about previews keeps working instead of having its
 * answers read as a single question literally named "answers".
 */
function parseDecisionPayload(payload: unknown): {
  answers: Record<string, string | string[]>;
  annotations?: Record<string, AskUserQuestionAnnotation>;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { answers: {} };
  }
  const record = payload as Record<string, unknown>;
  const answers = record.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { answers: record as Record<string, string | string[]> };
  }
  const rawAnnotations = record.annotations;
  const annotations =
    rawAnnotations &&
    typeof rawAnnotations === "object" &&
    !Array.isArray(rawAnnotations)
      ? (rawAnnotations as Record<string, AskUserQuestionAnnotation>)
      : undefined;
  return {
    answers: answers as Record<string, string | string[]>,
    ...(annotations && Object.keys(annotations).length > 0
      ? { annotations }
      : {}),
  };
}

export const askUserQuestionTool: ToolPlugin = {
  name: ASK_USER_QUESTION_TOOL_NAME,
  searchHint: "ask the user a multiple-choice question",
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
                      preview: {
                        type: "string",
                        description:
                          "Optional markdown preview of this option, shown beside the option list so the user can compare concrete artifacts: ASCII layout sketches, code snippets of different implementations, diagram variations, config examples. Single-select questions only — ignored when multiSelect is true. Not a substitute for label/description: the label still carries the choice.",
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
          answers: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "User answers collected by the permission component",
          },
          annotations: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                preview: {
                  type: "string",
                  description:
                    "The preview content of the selected option, if the question used previews.",
                },
                notes: {
                  type: "string",
                  description:
                    "Free-text notes the user added to their selection.",
                },
              },
            },
            description:
              "Per-question annotations returned by the UI (selected option's preview and the user's notes), keyed by question text",
          },
          metadata: {
            type: "object",
            properties: {
              source: {
                type: "string",
                description:
                  'Optional identifier for the source of this question (e.g., "remember" for /remember command). Used for analytics tracking.',
              },
            },
            description: "Optional metadata for the question",
          },
        },
        required: ["questions"],
      },
    },
  },
  prompt:
    () => `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a panel beside the option list, following whichever option the user is on. On those questions the "Other" box is replaced by a notes field, and the option you selected plus any notes come back to you in the tool result — so write the preview for a human comparing options, not as prose for yourself. Do not use previews for simple preference questions where labels and descriptions suffice. Previews are only supported for single-select questions (not multiSelect).

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval.
`,
  leanPrompt: `Use this tool when you need to ask the user questions during execution: preferences, clarifications, decisions on implementation choices, or a choice of direction.

- Users can always select "Other" to provide custom text input.
- \`multiSelect: true\` allows multiple answers to be selected for a question.
- If you recommend an option, put it first and append "(Recommended)" to its label.
- Add \`preview\` (markdown) to options when the user must compare concrete artifacts — layout sketches, code snippets, config samples. Single-select only; on preview questions "Other" becomes a notes field and the selected preview comes back to you.
In plan mode, use it to clarify requirements or choose between approaches before finalizing the plan — never to ask whether the plan is ready; that is what ExitPlanMode is for.`,
  execute: async (args, context) => {
    const {
      questions,
      answers: existingAnswers,
      metadata,
    } = args as unknown as AskUserQuestionInput;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return {
        success: false,
        content: "",
        error:
          "The 'questions' parameter is missing or empty. Please use the correct schema: { questions: [{ question, header, options, multiSelect? }] }",
      };
    }

    // Reject before asking for permission: a question with an unlabelled option
    // cannot be rendered, so the model has to retry instead of the user facing a
    // blank choice.
    const labelErrors = collectOptionLabelErrors(questions);
    if (labelErrors.length > 0) {
      return {
        success: false,
        content: "",
        error: `AskUserQuestion input error: ${labelErrors.join("; ")}`,
      };
    }

    if (!context.permissionManager) {
      throw new Error(
        `Permission manager is required for ${ASK_USER_QUESTION_TOOL_NAME} tool`,
      );
    }

    const permissionContext = context.permissionManager.createContext(
      ASK_USER_QUESTION_TOOL_NAME,
      context.permissionMode || "default",
      context.canUseToolCallback,
      { questions, answers: existingAnswers, metadata },
      context.toolCallId,
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
      const payload = parseDecisionPayload(
        JSON.parse(decision.message || "{}"),
      );
      return {
        success: true,
        content: JSON.stringify(payload),
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
