import { describe, it, expect } from "vitest";
import {
  questionReducer,
  type QuestionAction,
  type QuestionState,
} from "../../src/reducers/questionReducer.js";

const initialState: QuestionState = {
  currentQuestionIndex: 0,
  selectedOptionIndex: 0,
  selectedOptionIndices: new Set<number>(),
  userAnswers: {},
  otherText: "",
  otherCursorPosition: 0,
  savedStates: {},
  decision: null,
};

const mockQuestions = [
  { question: "Q1", options: [{ label: "A" }, { label: "B" }] },
  { question: "Q2", options: [{ label: "C" }] },
];

const mockOptions = [{ label: "A" }, { label: "B" }, { label: "Other" }];

describe("questionReducer", () => {
  describe("SELECT_OPTION", () => {
    it("should change selectedOptionIndex", () => {
      const result = questionReducer(initialState, {
        type: "SELECT_OPTION",
        index: 2,
      });
      expect(result.selectedOptionIndex).toBe(2);
    });
  });

  describe("MOVE_OPTION_UP", () => {
    it("should decrease index", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2,
      };
      const result = questionReducer(state, {
        type: "MOVE_OPTION_UP",
        maxIndex: 2,
      });
      expect(result.selectedOptionIndex).toBe(1);
    });

    it("should not go below 0", () => {
      const result = questionReducer(initialState, {
        type: "MOVE_OPTION_UP",
        maxIndex: 2,
      });
      expect(result.selectedOptionIndex).toBe(0);
    });
  });

  describe("MOVE_OPTION_DOWN", () => {
    it("should increase index", () => {
      const result = questionReducer(initialState, {
        type: "MOVE_OPTION_DOWN",
        maxIndex: 2,
      });
      expect(result.selectedOptionIndex).toBe(1);
    });

    it("should not exceed maxIndex", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2,
      };
      const result = questionReducer(state, {
        type: "MOVE_OPTION_DOWN",
        maxIndex: 2,
      });
      expect(result.selectedOptionIndex).toBe(2);
    });
  });

  describe("TOGGLE_MULTI_SELECT", () => {
    it("should add option to selected set", () => {
      const result = questionReducer(initialState, {
        type: "TOGGLE_MULTI_SELECT",
        optionsLength: 3,
      });
      expect(result.selectedOptionIndices.has(0)).toBe(true);
    });

    it("should remove option if already selected", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndices: new Set([0]),
      };
      const result = questionReducer(state, {
        type: "TOGGLE_MULTI_SELECT",
        optionsLength: 3,
      });
      expect(result.selectedOptionIndices.has(0)).toBe(false);
    });

    it("should remove option if already selected", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 1,
        selectedOptionIndices: new Set([1]),
      };
      const result = questionReducer(state, {
        type: "TOGGLE_MULTI_SELECT",
        optionsLength: 3,
      });
      expect(result.selectedOptionIndices).toEqual(new Set<number>());
    });
  });

  describe("CYCLE_QUESTION", () => {
    it("should save current state and restore next question's state", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 1,
        otherText: "test",
        otherCursorPosition: 4,
        savedStates: {
          1: {
            selectedOptionIndex: 0,
            selectedOptionIndices: new Set<number>(),
            otherText: "",
            otherCursorPosition: 0,
          },
        },
      };
      const result = questionReducer(state, {
        type: "CYCLE_QUESTION",
        shift: false,
        questionCount: 2,
      });
      expect(result.currentQuestionIndex).toBe(1);
      expect(result.selectedOptionIndex).toBe(0);
      expect(result.otherText).toBe("");
      // Current state should be saved
      expect(result.savedStates[0].selectedOptionIndex).toBe(1);
      expect(result.savedStates[0].otherText).toBe("test");
    });

    it("should cycle forward with wrap-around", () => {
      const state: QuestionState = {
        ...initialState,
        currentQuestionIndex: 1,
      };
      const result = questionReducer(state, {
        type: "CYCLE_QUESTION",
        shift: false,
        questionCount: 2,
      });
      expect(result.currentQuestionIndex).toBe(0);
    });

    it("should cycle backward with Shift", () => {
      const result = questionReducer(initialState, {
        type: "CYCLE_QUESTION",
        shift: true,
        questionCount: 2,
      });
      expect(result.currentQuestionIndex).toBe(1);
    });

    it("should return state unchanged if only one question", () => {
      const result = questionReducer(initialState, {
        type: "CYCLE_QUESTION",
        shift: false,
        questionCount: 1,
      });
      expect(result.currentQuestionIndex).toBe(0);
      expect(result).toBe(initialState);
    });
  });

  describe("INSERT_OTHER", () => {
    it("should insert text when Other is focused", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2,
      };
      const result = questionReducer(state, {
        type: "INSERT_OTHER",
        text: "hello",
        optionsLength: 3,
      });
      expect(result.otherText).toBe("hello");
      expect(result.otherCursorPosition).toBe(5);
    });

    it("should do nothing when Other is not focused", () => {
      const result = questionReducer(initialState, {
        type: "INSERT_OTHER",
        text: "hello",
        optionsLength: 3,
      });
      expect(result.otherText).toBe("");
    });

    it("should insert at cursor position", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2,
        otherText: "ac",
        otherCursorPosition: 1,
      };
      const result = questionReducer(state, {
        type: "INSERT_OTHER",
        text: "b",
        optionsLength: 3,
      });
      expect(result.otherText).toBe("abc");
      expect(result.otherCursorPosition).toBe(2);
    });
  });

  describe("DELETE_OTHER", () => {
    it("should delete character before cursor when Other is focused", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2,
        otherText: "abc",
        otherCursorPosition: 2,
      };
      const result = questionReducer(state, {
        type: "DELETE_OTHER",
        optionsLength: 3,
      });
      expect(result.otherText).toBe("ac");
      expect(result.otherCursorPosition).toBe(1);
    });

    it("should do nothing when Other is not focused", () => {
      const state: QuestionState = {
        ...initialState,
        otherText: "abc",
        otherCursorPosition: 2,
      };
      const result = questionReducer(state, {
        type: "DELETE_OTHER",
        optionsLength: 3,
      });
      expect(result.otherText).toBe("abc");
    });

    it("should do nothing when cursor at 0", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2,
        otherText: "abc",
        otherCursorPosition: 0,
      };
      const result = questionReducer(state, {
        type: "DELETE_OTHER",
        optionsLength: 3,
      });
      expect(result.otherText).toBe("abc");
    });
  });

  describe("MOVE_OTHER_LEFT", () => {
    it("should decrease cursor when Other is focused", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2,
        otherCursorPosition: 3,
      };
      const result = questionReducer(state, {
        type: "MOVE_OTHER_LEFT",
        optionsLength: 3,
      });
      expect(result.otherCursorPosition).toBe(2);
    });

    it("should do nothing when Other is not focused", () => {
      const state: QuestionState = {
        ...initialState,
        otherCursorPosition: 3,
      };
      const result = questionReducer(state, {
        type: "MOVE_OTHER_LEFT",
        optionsLength: 3,
      });
      expect(result.otherCursorPosition).toBe(3);
    });
  });

  describe("MOVE_OTHER_RIGHT", () => {
    it("should increase cursor when Other is focused", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2,
        otherText: "hello",
        otherCursorPosition: 2,
      };
      const result = questionReducer(state, {
        type: "MOVE_OTHER_RIGHT",
        optionsLength: 3,
      });
      expect(result.otherCursorPosition).toBe(3);
    });

    it("should not exceed text length", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2,
        otherText: "hi",
        otherCursorPosition: 2,
      };
      const result = questionReducer(state, {
        type: "MOVE_OTHER_RIGHT",
        optionsLength: 3,
      });
      expect(result.otherCursorPosition).toBe(2);
    });
  });

  describe("CONFIRM_ANSWER", () => {
    it("should advance to next question with saved state", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 1,
      };
      const result = questionReducer(state, {
        type: "CONFIRM_ANSWER",
        currentQuestion: mockQuestions[0],
        options: mockOptions,
        isMultiSelect: false,
        questions: mockQuestions,
      });
      expect(result.currentQuestionIndex).toBe(1);
      expect(result.selectedOptionIndex).toBe(0);
      expect(result.userAnswers["Q1"]).toBe("B");
      // Current state should be saved
      expect(result.savedStates[0].selectedOptionIndex).toBe(1);
    });

    it("should submit decision when on last question with all answers", () => {
      const state: QuestionState = {
        ...initialState,
        currentQuestionIndex: 1,
        selectedOptionIndex: 0,
        userAnswers: { Q1: "A" },
      };
      const result = questionReducer(state, {
        type: "CONFIRM_ANSWER",
        currentQuestion: mockQuestions[1],
        options: [{ label: "C" }, { label: "Other" }],
        isMultiSelect: false,
        questions: mockQuestions,
      });
      expect(result.decision).toEqual({
        behavior: "allow",
        message: JSON.stringify({ Q1: "A", Q2: "C" }),
      });
    });

    it("should return state unchanged if Other answer is empty", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2, // Other, but no text
      };
      const result = questionReducer(state, {
        type: "CONFIRM_ANSWER",
        currentQuestion: mockQuestions[0],
        options: mockOptions,
        isMultiSelect: false,
        questions: mockQuestions,
      });
      expect(result).toBe(state);
    });

    it("should collect savedStates for unanswered questions", () => {
      // Tab to Q2, answer Q2, Tab back to Q1, answer Q1, then submit
      const stateAfterQ2: QuestionState = {
        ...initialState,
        currentQuestionIndex: 1,
        selectedOptionIndex: 0,
        savedStates: {
          0: {
            selectedOptionIndex: 1,
            selectedOptionIndices: new Set<number>(),
            otherText: "",
            otherCursorPosition: 0,
          },
        },
      };
      const result = questionReducer(stateAfterQ2, {
        type: "CONFIRM_ANSWER",
        currentQuestion: mockQuestions[1],
        options: [{ label: "C" }, { label: "Other" }],
        isMultiSelect: false,
        questions: mockQuestions,
      });
      expect(result.decision).toEqual({
        behavior: "allow",
        message: JSON.stringify({ Q2: "C", Q1: "B" }),
      });
    });

    it("should handle multi-select answers", () => {
      const multiSelectQuestions = [
        {
          question: "Q1",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: true,
        },
      ];
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndices: new Set([0, 1]),
      };
      const result = questionReducer(state, {
        type: "CONFIRM_ANSWER",
        currentQuestion: multiSelectQuestions[0],
        options: [...multiSelectQuestions[0].options, { label: "Other" }],
        isMultiSelect: true,
        questions: multiSelectQuestions,
      });
      expect(result.decision).toEqual({
        behavior: "allow",
        message: JSON.stringify({ Q1: "A, B" }),
      });
    });

    it("should handle Other text in single-select", () => {
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndex: 2, // Other
        otherText: "Custom",
      };
      const result = questionReducer(state, {
        type: "CONFIRM_ANSWER",
        currentQuestion: mockQuestions[0],
        options: mockOptions,
        isMultiSelect: false,
        questions: mockQuestions,
      });
      expect(result.currentQuestionIndex).toBe(1);
      expect(result.userAnswers["Q1"]).toBe("Custom");
    });

    it("should handle Other text in multi-select", () => {
      const multiSelectQuestions = [
        { question: "Q1", options: [{ label: "A" }], multiSelect: true },
      ];
      const state: QuestionState = {
        ...initialState,
        selectedOptionIndices: new Set([0, 1]),
        otherText: "Custom",
      };
      const result = questionReducer(state, {
        type: "CONFIRM_ANSWER",
        currentQuestion: multiSelectQuestions[0],
        options: [...multiSelectQuestions[0].options, { label: "Other" }],
        isMultiSelect: true,
        questions: multiSelectQuestions,
      });
      expect(result.decision).toEqual({
        behavior: "allow",
        message: JSON.stringify({ Q1: "A, Custom" }),
      });
    });

    it("should not submit if not all questions answered", () => {
      // Start at Q2, answer Q2, but Q1 was never answered
      const state: QuestionState = {
        ...initialState,
        currentQuestionIndex: 1,
        selectedOptionIndex: 0,
        savedStates: {}, // No saved state for Q1
      };
      const result = questionReducer(state, {
        type: "CONFIRM_ANSWER",
        currentQuestion: mockQuestions[1],
        options: [{ label: "C" }, { label: "Other" }],
        isMultiSelect: false,
        questions: mockQuestions,
      });
      expect(result.decision).toBeNull();
    });
  });

  describe("default action", () => {
    it("should return state unchanged for unknown action", () => {
      const result = questionReducer(initialState, {
        type: "UNKNOWN",
      } as unknown as QuestionAction);
      expect(result).toBe(initialState);
    });
  });
});
