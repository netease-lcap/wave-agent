import { Key } from "ink";
import type { PermissionDecision } from "wave-agent-sdk";

/** The single-select-only "Other" row appended after the real options. */
export const OTHER_OPTION_LABEL = "Other";

export interface QuestionOption {
  label: string;
  description?: string;
  preview?: string;
}

/** The subset of an AskUserQuestion question the reducer needs. */
export interface QuestionLike {
  question: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

/**
 * Whether this question switches to the side-by-side preview layout: single
 * select only, and only when at least one option carries a non-blank preview
 * (spec `ask-user-tool.md`「选项预览与备注」场景 1 / 12).
 */
export const isPreviewQuestion = (q: {
  options: QuestionOption[];
  multiSelect?: boolean;
}): boolean =>
  !q.multiSelect &&
  q.options.some(
    (o) => typeof o.preview === "string" && o.preview.trim() !== "",
  );

/** Options the user can navigate: real options, plus "Other" when not previewing. */
const navigableOptions = (q: QuestionLike): QuestionOption[] =>
  isPreviewQuestion(q)
    ? q.options
    : [...q.options, { label: OTHER_OPTION_LABEL }];

/** Per-question buffers restored when navigating to a question for the first time. */
const emptyQuestionState = (): QuestionSavedState => ({
  selectedOptionIndex: 0,
  selectedOptionIndices: new Set<number>(),
  otherText: "",
  otherCursorPosition: 0,
  notesText: "",
  notesCursorPosition: 0,
});

export interface QuestionSavedState {
  selectedOptionIndex: number;
  selectedOptionIndices: Set<number>;
  otherText: string;
  otherCursorPosition: number;
  notesText: string;
  notesCursorPosition: number;
}

export interface QuestionState {
  currentQuestionIndex: number;
  selectedOptionIndex: number;
  selectedOptionIndices: Set<number>;
  userAnswers: Record<string, string>;
  otherText: string;
  otherCursorPosition: number;
  /** Free-text notes on a preview question, sent back as annotations. */
  notesText: string;
  notesCursorPosition: number;
  /** Whether keystrokes currently go into the notes field (preview only). */
  isEditingNotes: boolean;
  savedStates: Record<number, QuestionSavedState>;
  decision: PermissionDecision | null;
}

export type QuestionAction =
  | { type: "SELECT_OPTION"; index: number }
  | { type: "MOVE_OPTION_UP"; maxIndex: number }
  | { type: "MOVE_OPTION_DOWN"; maxIndex: number }
  | {
      type: "TOGGLE_MULTI_SELECT";
      optionsLength: number;
    }
  | { type: "CYCLE_QUESTION"; shift: boolean; questionCount: number }
  | { type: "INSERT_OTHER"; text: string; optionsLength: number }
  | { type: "DELETE_OTHER"; optionsLength: number }
  | { type: "MOVE_OTHER_LEFT"; optionsLength: number }
  | { type: "MOVE_OTHER_RIGHT"; optionsLength: number }
  | {
      type: "CONFIRM_ANSWER";
      currentQuestion: QuestionLike;
      options: Array<{ label: string }>;
      isMultiSelect: boolean;
      questions: QuestionLike[];
    }
  | { type: "CLEAR_DECISION" }
  | {
      type: "HANDLE_KEY";
      input: string;
      key: Key;
      questions: QuestionLike[];
    };

function buildAnswerFromSavedState(
  q: QuestionLike,
  s: QuestionSavedState,
): string {
  const opts = navigableOptions(q);
  let a = "";
  if (q.multiSelect) {
    const selectedLabels = Array.from(s.selectedOptionIndices)
      .filter((i) => i < q.options.length)
      .map((i) => q.options[i].label);
    const isOtherChecked = s.selectedOptionIndices.has(opts.length - 1);
    if (isOtherChecked && s.otherText.trim()) {
      selectedLabels.push(s.otherText.trim());
    }
    a = selectedLabels.join(", ");
  } else {
    if (s.selectedOptionIndex === opts.length - 1) {
      a = s.otherText.trim();
    } else {
      a = opts[s.selectedOptionIndex]?.label ?? "";
    }
  }
  return a;
}

/**
 * Collect per-question notes (indexed by question) from the live buffer plus
 * the states saved when switching questions.
 */
function collectNotes(state: QuestionState): Record<number, string> {
  const notes: Record<number, string> = {};
  for (const [idxStr, s] of Object.entries(state.savedStates)) {
    if (s.notesText.trim()) notes[parseInt(idxStr, 10)] = s.notesText.trim();
  }
  if (state.notesText.trim()) {
    notes[state.currentQuestionIndex] = state.notesText.trim();
  }
  return notes;
}

/**
 * Build the confirmation message body: `{ answers, annotations? }`. Annotations
 * carry the full preview text of the selected option plus the user's notes —
 * the model wrote the previews, so it needs them back to reason about what the
 * user actually compared (spec「选项预览与备注」场景 10).
 * `annotations` is omitted entirely when no preview question produced one,
 * which keeps old hosts (that only understand a bare answers map) working
 * unchanged.
 */
function buildDecisionMessage(
  questions: QuestionLike[],
  answers: Record<string, string>,
  notes: Record<number, string>,
): string {
  const annotations: Record<string, { preview?: string; notes?: string }> = {};
  questions.forEach((q, index) => {
    if (!isPreviewQuestion(q)) return;
    const selected = q.options.find((o) => o.label === answers[q.question]);
    const preview =
      typeof selected?.preview === "string" ? selected.preview : "";
    const note = notes[index];
    const entry: { preview?: string; notes?: string } = {};
    if (preview.trim()) entry.preview = preview;
    if (note) entry.notes = note;
    if (Object.keys(entry).length > 0) annotations[q.question] = entry;
  });
  return JSON.stringify({
    answers,
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  });
}

/** Snapshot of the current question's buffers, for `savedStates`. */
const currentSave = (state: QuestionState): QuestionSavedState => ({
  selectedOptionIndex: state.selectedOptionIndex,
  selectedOptionIndices: state.selectedOptionIndices,
  otherText: state.otherText,
  otherCursorPosition: state.otherCursorPosition,
  notesText: state.notesText,
  notesCursorPosition: state.notesCursorPosition,
});

/** The answer implied by the current focus, or "" when nothing is answerable. */
function deriveAnswer(
  state: QuestionState,
  q: QuestionLike,
  options: QuestionOption[],
): string {
  if (q.multiSelect) {
    const selectedLabels = Array.from(state.selectedOptionIndices)
      .filter((i) => i < q.options.length)
      .map((i) => q.options[i].label);
    const isOtherChecked = state.selectedOptionIndices.has(options.length - 1);
    if (isOtherChecked && state.otherText.trim()) {
      selectedLabels.push(state.otherText.trim());
    }
    return selectedLabels.join(", ");
  }
  // The last row is "Other" only when the question is not in preview mode —
  // a preview question's last row is a real option.
  if (
    !isPreviewQuestion(q) &&
    state.selectedOptionIndex === options.length - 1
  ) {
    return state.otherText.trim();
  }
  return options[state.selectedOptionIndex]?.label ?? "";
}

/**
 * Answer the current question: record it, then either advance to the next one
 * or, on the last question, emit the decision once every question is answered.
 */
function commitAnswer(
  state: QuestionState,
  questions: QuestionLike[],
  cq: QuestionLike,
  options: QuestionOption[],
): QuestionState {
  const answer = deriveAnswer(state, cq, options);
  if (!answer) return state;

  const newAnswers = { ...state.userAnswers, [cq.question]: answer };
  const savedStates = {
    ...state.savedStates,
    [state.currentQuestionIndex]: currentSave(state),
  };

  if (state.currentQuestionIndex < questions.length - 1) {
    const nextIndex = state.currentQuestionIndex + 1;
    const nextState = savedStates[nextIndex] || emptyQuestionState();
    return {
      ...state,
      currentQuestionIndex: nextIndex,
      ...nextState,
      isEditingNotes: false,
      userAnswers: newAnswers,
      savedStates,
    };
  }

  const finalAnswers = { ...newAnswers };
  for (const [idxStr, s] of Object.entries(savedStates)) {
    const idx = parseInt(idxStr, 10);
    const q = questions[idx];
    if (q && !finalAnswers[q.question]) {
      const a = buildAnswerFromSavedState(q, s);
      if (a) finalAnswers[q.question] = a;
    }
  }
  if (!questions.every((q) => finalAnswers[q.question])) return state;
  return {
    ...state,
    userAnswers: finalAnswers,
    savedStates,
    decision: {
      behavior: "allow",
      message: buildDecisionMessage(
        questions,
        finalAnswers,
        collectNotes({ ...state, savedStates }),
      ),
    },
  };
}

export function questionReducer(
  state: QuestionState,
  action: QuestionAction,
): QuestionState {
  switch (action.type) {
    case "SELECT_OPTION":
      return { ...state, selectedOptionIndex: action.index };
    case "MOVE_OPTION_UP":
      return {
        ...state,
        selectedOptionIndex: Math.max(0, state.selectedOptionIndex - 1),
      };
    case "MOVE_OPTION_DOWN":
      return {
        ...state,
        selectedOptionIndex: Math.min(
          action.maxIndex,
          state.selectedOptionIndex + 1,
        ),
      };
    case "TOGGLE_MULTI_SELECT": {
      const nextIndices = new Set(state.selectedOptionIndices);
      if (nextIndices.has(state.selectedOptionIndex))
        nextIndices.delete(state.selectedOptionIndex);
      else nextIndices.add(state.selectedOptionIndex);
      return { ...state, selectedOptionIndices: nextIndices };
    }
    case "CYCLE_QUESTION": {
      const direction = action.shift ? -1 : 1;
      let nextIndex = state.currentQuestionIndex + direction;
      if (nextIndex < 0) nextIndex = action.questionCount - 1;
      if (nextIndex >= action.questionCount) nextIndex = 0;
      if (nextIndex === state.currentQuestionIndex) return state;
      const savedStates = {
        ...state.savedStates,
        [state.currentQuestionIndex]: {
          selectedOptionIndex: state.selectedOptionIndex,
          selectedOptionIndices: state.selectedOptionIndices,
          otherText: state.otherText,
          otherCursorPosition: state.otherCursorPosition,
          notesText: state.notesText,
          notesCursorPosition: state.notesCursorPosition,
        },
      };
      const nextState = savedStates[nextIndex] || emptyQuestionState();
      return {
        ...state,
        currentQuestionIndex: nextIndex,
        ...nextState,
        isEditingNotes: false,
        savedStates,
      };
    }
    case "INSERT_OTHER": {
      if (state.selectedOptionIndex !== action.optionsLength - 1) return state;
      const sanitized = action.text.replace(/\r\n?|\n/g, " ");
      const newText =
        state.otherText.slice(0, state.otherCursorPosition) +
        sanitized +
        state.otherText.slice(state.otherCursorPosition);
      return {
        ...state,
        otherText: newText,
        otherCursorPosition: state.otherCursorPosition + sanitized.length,
      };
    }
    case "DELETE_OTHER":
      if (state.selectedOptionIndex !== action.optionsLength - 1) return state;
      if (state.otherCursorPosition > 0) {
        return {
          ...state,
          otherText:
            state.otherText.slice(0, state.otherCursorPosition - 1) +
            state.otherText.slice(state.otherCursorPosition),
          otherCursorPosition: state.otherCursorPosition - 1,
        };
      }
      return state;
    case "MOVE_OTHER_LEFT":
      if (state.selectedOptionIndex !== action.optionsLength - 1) return state;
      return {
        ...state,
        otherCursorPosition: Math.max(0, state.otherCursorPosition - 1),
      };
    case "MOVE_OTHER_RIGHT":
      if (state.selectedOptionIndex !== action.optionsLength - 1) return state;
      return {
        ...state,
        otherCursorPosition: Math.min(
          state.otherText.length,
          state.otherCursorPosition + 1,
        ),
      };
    case "CONFIRM_ANSWER":
      return commitAnswer(
        state,
        action.questions,
        action.currentQuestion,
        action.options,
      );
    case "CLEAR_DECISION":
      return { ...state, decision: null };
    case "HANDLE_KEY": {
      const { input, key, questions } = action;
      const currentQuestion = questions[state.currentQuestionIndex];
      if (!currentQuestion) return state;

      const options = navigableOptions(currentQuestion);
      const isMultiSelect = currentQuestion.multiSelect;

      // Notes editing takes every keystroke: it is a text field, so only Enter
      // and Esc leave it (matching Claude Code's CLI preview view).
      if (state.isEditingNotes) {
        if (key.return || key.escape) {
          return { ...state, isEditingNotes: false };
        }
        if (key.leftArrow) {
          return {
            ...state,
            notesCursorPosition: Math.max(0, state.notesCursorPosition - 1),
          };
        }
        if (key.rightArrow) {
          return {
            ...state,
            notesCursorPosition: Math.min(
              state.notesText.length,
              state.notesCursorPosition + 1,
            ),
          };
        }
        if (key.backspace || key.delete) {
          if (state.notesCursorPosition === 0) return state;
          return {
            ...state,
            notesText:
              state.notesText.slice(0, state.notesCursorPosition - 1) +
              state.notesText.slice(state.notesCursorPosition),
            notesCursorPosition: state.notesCursorPosition - 1,
          };
        }
        if (input && !key.ctrl && !key.meta) {
          const sanitized = input.replace(/\r\n?|\n/g, " ");
          return {
            ...state,
            notesText:
              state.notesText.slice(0, state.notesCursorPosition) +
              sanitized +
              state.notesText.slice(state.notesCursorPosition),
            notesCursorPosition: state.notesCursorPosition + sanitized.length,
          };
        }
        return state;
      }

      // `n` opens the notes field on a preview question. Every other letter is
      // inert here, so it cannot collide with navigation.
      if (
        input === "n" &&
        !key.ctrl &&
        !key.meta &&
        isPreviewQuestion(currentQuestion)
      ) {
        return { ...state, isEditingNotes: true };
      }

      if (key.return) {
        return commitAnswer(state, questions, currentQuestion, options);
      }

      if (input === " ") {
        const isOtherFocused = state.selectedOptionIndex === options.length - 1;
        if (
          isMultiSelect &&
          (!isOtherFocused ||
            !state.selectedOptionIndices.has(state.selectedOptionIndex))
        ) {
          const nextIndices = new Set(state.selectedOptionIndices);
          if (nextIndices.has(state.selectedOptionIndex))
            nextIndices.delete(state.selectedOptionIndex);
          else nextIndices.add(state.selectedOptionIndex);
          return { ...state, selectedOptionIndices: nextIndices };
        }
      }

      if (key.upArrow) {
        return {
          ...state,
          selectedOptionIndex: Math.max(0, state.selectedOptionIndex - 1),
        };
      }
      if (key.downArrow) {
        return {
          ...state,
          selectedOptionIndex: Math.min(
            options.length - 1,
            state.selectedOptionIndex + 1,
          ),
        };
      }

      if (key.tab) {
        const direction = key.shift ? -1 : 1;
        let nextIndex = state.currentQuestionIndex + direction;
        if (nextIndex < 0) nextIndex = questions.length - 1;
        if (nextIndex >= questions.length) nextIndex = 0;
        if (nextIndex === state.currentQuestionIndex) return state;
        const savedStates = {
          ...state.savedStates,
          [state.currentQuestionIndex]: currentSave(state),
        };
        const nextState = savedStates[nextIndex] || emptyQuestionState();
        return {
          ...state,
          currentQuestionIndex: nextIndex,
          ...nextState,
          isEditingNotes: false,
          savedStates,
        };
      }

      // Text editing on the "Other" row. Preview questions have no Other row,
      // so their last row is a plain option and never enters this branch.
      if (
        !isPreviewQuestion(currentQuestion) &&
        state.selectedOptionIndex === options.length - 1
      ) {
        if (key.leftArrow) {
          return {
            ...state,
            otherCursorPosition: Math.max(0, state.otherCursorPosition - 1),
          };
        }
        if (key.rightArrow) {
          return {
            ...state,
            otherCursorPosition: Math.min(
              state.otherText.length,
              state.otherCursorPosition + 1,
            ),
          };
        }
        if (key.backspace || key.delete) {
          if (state.otherCursorPosition > 0) {
            return {
              ...state,
              otherText:
                state.otherText.slice(0, state.otherCursorPosition - 1) +
                state.otherText.slice(state.otherCursorPosition),
              otherCursorPosition: state.otherCursorPosition - 1,
            };
          }
          return state;
        }
        if (input && !key.ctrl && !key.meta) {
          const sanitized = input.replace(/\r\n?|\n/g, " ");
          const newText =
            state.otherText.slice(0, state.otherCursorPosition) +
            sanitized +
            state.otherText.slice(state.otherCursorPosition);
          return {
            ...state,
            otherText: newText,
            otherCursorPosition: state.otherCursorPosition + sanitized.length,
          };
        }
      }

      return state;
    }
    default:
      return state;
  }
}
