import { ToolPlugin } from "./types.js";
import {
  AskUserQuestion,
  AskUserQuestionAnnotation,
  AskUserQuestionInput,
} from "../types/tools.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "../constants/tools.js";
import {
  NOTES_ONLY_ANSWER,
  renderAskUserQuestionResultData,
  type AskUserQuestionResultData,
} from "./resultData/askUserQuestion.js";

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
 * Fold the answer values into CC's shape: `answers` is
 * `Record<string, string>`, and a multi-select answer is one comma-separated
 * string (`AskUserQuestionTool.tsx:71`), because CC's UI joins the picked labels
 * with `", "` before submitting (`AskUserQuestionPermissionRequest.tsx:426-429`).
 * Our hosts send `string[]` for multi-select, so the join happens here — the
 * `data` we hand out then matches CC field for field.
 */
function normalizeAnswers(
  answers: Record<string, string | string[]>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [question, answer] of Object.entries(answers)) {
    normalized[question] = Array.isArray(answer) ? answer.join(", ") : answer;
  }
  return normalized;
}

/**
 * Read the confirmation payload, refusing anything a host may have made up.
 *
 * The current shape is `{ answers, annotations? }`. Hosts and the CLI used to
 * send the answers map on its own, so that shape is still accepted: an old
 * client that knows nothing about previews keeps working instead of having its
 * answers read as a single question literally named "answers".
 */
/** CC's ceilings for what an answer payload may carry
 *  (`1005-20922B-mDn.js:73-76`): 32768 per answer, 8192 per notes block. */
const MAX_ANSWER_CHARS = 32768;
const MAX_NOTES_CHARS = 8192;

/**
 * A preview returned byte for byte is always the caller's own. Anything else
 * has to survive CC's 2000-character window to be compared at all
 * (`he()`, `1005-20922B-mDn.js:238`).
 */
const MAX_NORMALISED_PREVIEW_CHARS = 2000;

/** `{ answers, annotations? }` is the only answer shape we accept. */
const DECISION_PAYLOAD_KEYS = ["answers", "annotations"];
/** An annotation may only carry what the user saw and what they typed. */
const ANNOTATION_KEYS = ["preview", "notes"];

/** Characters that render as nothing: zero-width joiners and spaces, bidi
 *  marks, soft hyphens, the BOM. Dropping them is what lets a host return a
 *  rewritten-but-identical preview. */
const INVISIBLE_CHARACTERS =
  /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

interface ParsedDecisionPayload {
  answers: Record<string, string | string[]>;
  annotations?: Record<string, AskUserQuestionAnnotation>;
}

/**
 * Is this the preview the model itself passed for that question?
 *
 * Byte-for-byte is always fine. Anything else means the client rewrote it (a
 * whitespace pass, a display-time scrub); that is acceptable while the
 * original is short enough for the comparison to mean something, so this
 * mirrors CC's `he()`: drop invisible characters from both sides and compare.
 */
function previewIsCallersOwn(
  question: AskUserQuestion,
  preview: string,
): boolean {
  const previews = question.options
    .map((option) => option?.preview)
    .filter((value): value is string => typeof value === "string");
  if (previews.includes(preview)) return true;
  const normalized = preview.replace(INVISIBLE_CHARACTERS, "");
  return previews.some(
    (original) =>
      original.length <= MAX_NORMALISED_PREVIEW_CHARS &&
      original.replace(INVISIBLE_CHARACTERS, "") === normalized,
  );
}

function parseDecisionPayload(
  payload: unknown,
  questions: AskUserQuestion[],
): { ok: true; payload: ParsedDecisionPayload } | { ok: false; error: string } {
  const refuse = (detail: string) => ({
    ok: false as const,
    error: `AskUserQuestion answer rejected: ${detail}`,
  });

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    // Nothing usable came back (an empty message body, say). No answers is a
    // legitimate outcome; it is not a payload anyone mutated.
    return { ok: true, payload: { answers: {} } };
  }

  const record = payload as Record<string, unknown>;
  const questionTexts = new Set(
    questions.map((question) => question?.question),
  );
  const legacyShape = !Object.prototype.hasOwnProperty.call(record, "answers");

  if (!legacyShape) {
    const extra = Object.keys(record).filter(
      (key) => !DECISION_PAYLOAD_KEYS.includes(key),
    );
    if (extra.length > 0) {
      return refuse(
        `unexpected field(s) ${extra.map((key) => `"${key}"`).join(", ")} in the answer payload`,
      );
    }
  }

  const rawAnswers = legacyShape ? record : record.answers;
  if (
    !rawAnswers ||
    typeof rawAnswers !== "object" ||
    Array.isArray(rawAnswers)
  ) {
    return refuse('"answers" must be an object keyed by question text');
  }

  const answers: Record<string, string | string[]> = Object.create(null);
  for (const [questionText, rawAnswer] of Object.entries(
    rawAnswers as Record<string, unknown>,
  )) {
    if (!questionTexts.has(questionText)) {
      return refuse(`unknown question "${questionText}"`);
    }
    if (typeof rawAnswer === "string") {
      if (rawAnswer.length > MAX_ANSWER_CHARS) {
        return refuse(
          `the answer to "${questionText}" is ${rawAnswer.length} characters, the limit is ${MAX_ANSWER_CHARS}`,
        );
      }
      answers[questionText] = rawAnswer;
      continue;
    }
    if (!Array.isArray(rawAnswer) || rawAnswer.length === 0) {
      return refuse(
        `the answer to "${questionText}" must be a string or a list of strings`,
      );
    }
    const selected: string[] = [];
    for (const entry of rawAnswer) {
      if (typeof entry !== "string") {
        return refuse(
          `the answer to "${questionText}" must be a string or a list of strings`,
        );
      }
      selected.push(entry);
    }
    const joined = selected.join(", ");
    if (joined.length > MAX_ANSWER_CHARS) {
      return refuse(
        `the answer to "${questionText}" is ${joined.length} characters, the limit is ${MAX_ANSWER_CHARS}`,
      );
    }
    answers[questionText] = selected;
  }

  const rawAnnotations = legacyShape ? undefined : record.annotations;
  let annotations: Record<string, AskUserQuestionAnnotation> | undefined;
  if (rawAnnotations !== undefined) {
    if (
      !rawAnnotations ||
      typeof rawAnnotations !== "object" ||
      Array.isArray(rawAnnotations)
    ) {
      return refuse('"annotations" must be an object keyed by question text');
    }
    const collected: Record<string, AskUserQuestionAnnotation> = {};
    for (const [questionText, rawAnnotation] of Object.entries(
      rawAnnotations as Record<string, unknown>,
    )) {
      const question = questions.find(
        (candidate) => candidate?.question === questionText,
      );
      if (!question) {
        return refuse(`unknown question "${questionText}" in "annotations"`);
      }
      if (
        !rawAnnotation ||
        typeof rawAnnotation !== "object" ||
        Array.isArray(rawAnnotation)
      ) {
        return refuse(`"annotations" for "${questionText}" must be an object`);
      }
      const entry = rawAnnotation as Record<string, unknown>;
      const extra = Object.keys(entry).filter(
        (key) => !ANNOTATION_KEYS.includes(key),
      );
      if (extra.length > 0) {
        return refuse(
          `unexpected field(s) ${extra.map((key) => `"${key}"`).join(", ")} in "annotations" for "${questionText}"`,
        );
      }
      const annotation: AskUserQuestionAnnotation = {};
      const preview = entry.preview;
      if (preview !== undefined) {
        if (typeof preview !== "string") {
          return refuse(
            `"annotations" for "${questionText}" has a non-string "preview"`,
          );
        }
        if (!previewIsCallersOwn(question, preview)) {
          return refuse(
            `the preview returned for "${questionText}" is not one this call passed for that question`,
          );
        }
        annotation.preview = preview;
      }
      const notes = entry.notes;
      if (notes !== undefined) {
        if (typeof notes !== "string") {
          return refuse(
            `"annotations" for "${questionText}" has non-string "notes"`,
          );
        }
        if (notes.length > MAX_NOTES_CHARS) {
          return refuse(
            `the notes for "${questionText}" are ${notes.length} characters, the limit is ${MAX_NOTES_CHARS}`,
          );
        }
        annotation.notes = notes;
      }
      if (Object.keys(annotation).length > 0) {
        collected[questionText] = annotation;
      }
    }
    if (Object.keys(collected).length > 0) annotations = collected;
  }

  // `(notes only)` is a sentinel, not an answer: it only means anything next to
  // the notes it stands for. Without them the question was not answered.
  for (const [questionText, answer] of Object.entries(answers)) {
    if (answer === NOTES_ONLY_ANSWER && !annotations?.[questionText]?.notes) {
      delete answers[questionText];
    }
  }

  return {
    ok: true,
    payload: { answers, ...(annotations ? { annotations } : {}) },
  };
}

/**
 * 这一题的回答是不是我们给出的某个选项？
 *
 * CC 用同一判据决定外层句子（`mapToolResultToToolResultBlockParam`，
 * `1005-20922B-mDn.js:725`）：只要有一题的答案落在 `option.label` 之外（用户走
 * 「其他」写了自定义答案），模型就得读仔细。多选是按 `", "` 连起来的串，拆回去
 * 逐个比对。
 */
function answerIsOfferedLabel(
  question: AskUserQuestion,
  answer: string | string[],
): boolean {
  const labels = new Set(question.options.map((option) => option?.label));
  if (Array.isArray(answer)) {
    return answer.length > 0 && answer.every((entry) => labels.has(entry));
  }
  // 空串与 `(notes only)` 都不是「答案」，交给备注那条判据。
  if (answer === "" || answer === NOTES_ONLY_ANSWER) return true;
  if (labels.has(answer)) return true;
  if (question.multiSelect !== true) return false;
  const split = answer.split(", ");
  return split.length > 0 && split.every((entry) => labels.has(entry));
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
            description:
              "User answers collected by the permission component. Questions the user left unanswered are omitted; the value `(notes only)` means the user wrote notes instead of picking an option (their text is under `annotations`).",
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
                    "Free-text notes the user added to their selection. Present on preview questions even when no option was picked — then the answer is `(notes only)`.",
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

Preview content is rendered as markdown in a panel beside the option list, following whichever option the user is on. On those questions the "Other" box is replaced by a notes field, and the option you selected plus any notes come back to you in the tool result — so write the preview for a human comparing options, not as prose for yourself. If the user writes notes but picks no option, that question's answer comes back as \`(notes only)\` with their text in \`annotations\`. Do not use previews for simple preference questions where labels and descriptions suffice. Previews are only supported for single-select questions (not multiSelect).

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval.
`,
  leanPrompt: `Use this tool when you need to ask the user questions during execution: preferences, clarifications, decisions on implementation choices, or a choice of direction.

- Users can always select "Other" to provide custom text input.
- \`multiSelect: true\` allows multiple answers to be selected for a question.
- If you recommend an option, put it first and append "(Recommended)" to its label.
- Add \`preview\` (markdown) to options when the user must compare concrete artifacts — layout sketches, code snippets, config samples. Single-select only; on preview questions "Other" becomes a notes field and the selected preview comes back to you. Notes with no option picked come back as \`(notes only)\`.
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
    // Parsing and admitting are separate steps: a payload the host mutated has
    // to fail loudly with a reason, never be silently trimmed.
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(decision.message || "{}");
    } catch {
      return {
        success: false,
        content: "",
        error: "Failed to parse user answers",
      };
    }

    const parsed = parseDecisionPayload(rawPayload, questions);
    if (!parsed.ok) {
      return { success: false, content: "", error: parsed.error };
    }

    // Text is rendered from `data`, never stored as a literal (CC's
    // `mapToolResultToToolResultBlockParam`, `1005-20922B-mDn.js:671`).
    const readCarefully = questions.some((question) => {
      const answer = parsed.payload.answers[question?.question];
      return answer !== undefined && !answerIsOfferedLabel(question, answer);
    });
    const data: AskUserQuestionResultData = {
      answers: normalizeAnswers(parsed.payload.answers),
    };
    if (parsed.payload.annotations) {
      data.annotations = parsed.payload.annotations;
    }
    if (readCarefully) data.readCarefully = true;
    return {
      success: true,
      content: renderAskUserQuestionResultData(data),
      data,
    };
  },
};
