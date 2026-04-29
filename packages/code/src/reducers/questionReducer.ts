import { Key } from "ink";
import type { PermissionDecision } from "wave-agent-sdk";

export interface QuestionSavedState {
  selectedOptionIndex: number;
  selectedOptionIndices: Set<number>;
  otherText: string;
  otherCursorPosition: number;
}

export interface QuestionState {
  currentQuestionIndex: number;
  selectedOptionIndex: number;
  selectedOptionIndices: Set<number>;
  userAnswers: Record<string, string>;
  otherText: string;
  otherCursorPosition: number;
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
      currentQuestion: {
        question: string;
        options: Array<{ label: string }>;
        multiSelect?: boolean;
      };
      options: Array<{ label: string }>;
      isMultiSelect: boolean;
      questions: Array<{
        question: string;
        options: Array<{ label: string }>;
        multiSelect?: boolean;
      }>;
    }
  | { type: "CLEAR_DECISION" }
  | {
      type: "HANDLE_KEY";
      input: string;
      key: Key;
      currentQuestion: {
        question: string;
        options: Array<{ label: string }>;
        multiSelect?: boolean;
      };
      questions: Array<{
        question: string;
        options: Array<{ label: string }>;
        multiSelect?: boolean;
      }>;
    };

function buildAnswerFromSavedState(
  q: {
    question: string;
    options: Array<{ label: string }>;
    multiSelect?: boolean;
  },
  s: QuestionSavedState,
): string {
  const opts = [...q.options, { label: "Other" }];
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
      a = opts[s.selectedOptionIndex].label;
    }
  }
  return a;
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
        },
      };
      const nextState = savedStates[nextIndex] || {
        selectedOptionIndex: 0,
        selectedOptionIndices: new Set<number>(),
        otherText: "",
        otherCursorPosition: 0,
      };
      return {
        ...state,
        currentQuestionIndex: nextIndex,
        ...nextState,
        savedStates,
      };
    }
    case "INSERT_OTHER": {
      if (state.selectedOptionIndex !== action.optionsLength - 1) return state;
      const newText =
        state.otherText.slice(0, state.otherCursorPosition) +
        action.text +
        state.otherText.slice(state.otherCursorPosition);
      return {
        ...state,
        otherText: newText,
        otherCursorPosition: state.otherCursorPosition + action.text.length,
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
    case "CONFIRM_ANSWER": {
      const { currentQuestion: cq, options, isMultiSelect, questions } = action;
      const isOtherFocused = state.selectedOptionIndex === options.length - 1;
      let answer = "";
      if (isMultiSelect) {
        const selectedLabels = Array.from(state.selectedOptionIndices)
          .filter((i) => i < cq.options.length)
          .map((i) => cq.options[i].label);
        const isOtherChecked = state.selectedOptionIndices.has(
          options.length - 1,
        );
        if (isOtherChecked && state.otherText.trim()) {
          selectedLabels.push(state.otherText.trim());
        }
        answer = selectedLabels.join(", ");
      } else {
        if (isOtherFocused) {
          answer = state.otherText.trim();
        } else {
          answer = options[state.selectedOptionIndex].label;
        }
      }
      if (!answer) return state;

      const newAnswers = {
        ...state.userAnswers,
        [cq.question]: answer,
      };

      if (state.currentQuestionIndex < questions.length - 1) {
        const nextIndex = state.currentQuestionIndex + 1;
        const savedStates = {
          ...state.savedStates,
          [state.currentQuestionIndex]: {
            selectedOptionIndex: state.selectedOptionIndex,
            selectedOptionIndices: state.selectedOptionIndices,
            otherText: state.otherText,
            otherCursorPosition: state.otherCursorPosition,
          },
        };
        const nextState = savedStates[nextIndex] || {
          selectedOptionIndex: 0,
          selectedOptionIndices: new Set<number>(),
          otherText: "",
          otherCursorPosition: 0,
        };
        return {
          ...state,
          currentQuestionIndex: nextIndex,
          ...nextState,
          userAnswers: newAnswers,
          savedStates,
        };
      } else {
        const finalAnswers = { ...newAnswers };
        for (const [idxStr, s] of Object.entries(state.savedStates)) {
          const idx = parseInt(idxStr);
          const q = questions[idx];
          if (q && !finalAnswers[q.question]) {
            const a = buildAnswerFromSavedState(q, s);
            if (a) finalAnswers[q.question] = a;
          }
        }
        const allAnswered = questions.every((q) => finalAnswers[q.question]);
        if (!allAnswered) return state;
        return {
          ...state,
          userAnswers: finalAnswers,
          decision: {
            behavior: "allow",
            message: JSON.stringify(finalAnswers),
          },
        };
      }
    }
    case "CLEAR_DECISION":
      return { ...state, decision: null };
    case "HANDLE_KEY": {
      const { input, key, currentQuestion, questions } = action;
      if (!currentQuestion) return state;

      const options = [...currentQuestion.options, { label: "Other" }];
      const isMultiSelect = currentQuestion.multiSelect;

      if (key.return) {
        const isOtherFocused = state.selectedOptionIndex === options.length - 1;
        let answer = "";
        if (isMultiSelect) {
          const selectedLabels = Array.from(state.selectedOptionIndices)
            .filter((i) => i < currentQuestion.options.length)
            .map((i) => currentQuestion.options[i].label);
          const isOtherChecked = state.selectedOptionIndices.has(
            options.length - 1,
          );
          if (isOtherChecked && state.otherText.trim()) {
            selectedLabels.push(state.otherText.trim());
          }
          answer = selectedLabels.join(", ");
        } else {
          if (isOtherFocused) {
            answer = state.otherText.trim();
          } else {
            answer = options[state.selectedOptionIndex].label;
          }
        }
        if (!answer) return state;

        const newAnswers = {
          ...state.userAnswers,
          [currentQuestion.question]: answer,
        };

        if (state.currentQuestionIndex < questions.length - 1) {
          const nextIndex = state.currentQuestionIndex + 1;
          const savedStates = {
            ...state.savedStates,
            [state.currentQuestionIndex]: {
              selectedOptionIndex: state.selectedOptionIndex,
              selectedOptionIndices: state.selectedOptionIndices,
              otherText: state.otherText,
              otherCursorPosition: state.otherCursorPosition,
            },
          };
          const nextState = savedStates[nextIndex] || {
            selectedOptionIndex: 0,
            selectedOptionIndices: new Set<number>(),
            otherText: "",
            otherCursorPosition: 0,
          };
          return {
            ...state,
            currentQuestionIndex: nextIndex,
            ...nextState,
            userAnswers: newAnswers,
            savedStates,
          };
        } else {
          const finalAnswers = { ...newAnswers };
          for (const [idxStr, s] of Object.entries(state.savedStates)) {
            const idx = parseInt(idxStr);
            const q = questions[idx];
            if (q && !finalAnswers[q.question]) {
              const a = buildAnswerFromSavedState(q, s);
              if (a) finalAnswers[q.question] = a;
            }
          }
          const allAnswered = questions.every((q) => finalAnswers[q.question]);
          if (!allAnswered) return state;
          return {
            ...state,
            userAnswers: finalAnswers,
            decision: {
              behavior: "allow",
              message: JSON.stringify(finalAnswers),
            },
          };
        }
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
          [state.currentQuestionIndex]: {
            selectedOptionIndex: state.selectedOptionIndex,
            selectedOptionIndices: state.selectedOptionIndices,
            otherText: state.otherText,
            otherCursorPosition: state.otherCursorPosition,
          },
        };
        const nextState = savedStates[nextIndex] || {
          selectedOptionIndex: 0,
          selectedOptionIndices: new Set<number>(),
          otherText: "",
          otherCursorPosition: 0,
        };
        return {
          ...state,
          currentQuestionIndex: nextIndex,
          ...nextState,
          savedStates,
        };
      }

      if (state.selectedOptionIndex === options.length - 1) {
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
          const newText =
            state.otherText.slice(0, state.otherCursorPosition) +
            input +
            state.otherText.slice(state.otherCursorPosition);
          return {
            ...state,
            otherText: newText,
            otherCursorPosition: state.otherCursorPosition + input.length,
          };
        }
      }

      return state;
    }
    default:
      return state;
  }
}
