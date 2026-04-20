import { describe, it, expect } from "vitest";
import {
  confirmationReducer,
  type ConfirmationAction,
} from "../../src/reducers/confirmationReducer.js";
import type { ConfirmationState } from "../../src/reducers/confirmationReducer.js";

const initialState: ConfirmationState = {
  selectedOption: "allow",
  alternativeText: "",
  alternativeCursorPosition: 0,
  hasUserInput: false,
};

describe("confirmationReducer", () => {
  describe("SELECT_OPTION", () => {
    it("should change selectedOption", () => {
      const result = confirmationReducer(initialState, {
        type: "SELECT_OPTION",
        option: "alternative",
      });
      expect(result.selectedOption).toBe("alternative");
    });

    it("should not affect other fields", () => {
      const state: ConfirmationState = {
        ...initialState,
        alternativeText: "hello",
        alternativeCursorPosition: 2,
      };
      const result = confirmationReducer(state, {
        type: "SELECT_OPTION",
        option: "auto",
      });
      expect(result.selectedOption).toBe("auto");
      expect(result.alternativeText).toBe("hello");
      expect(result.alternativeCursorPosition).toBe(2);
    });
  });

  describe("INSERT_TEXT", () => {
    it("should insert text at cursor position", () => {
      const state: ConfirmationState = {
        ...initialState,
        alternativeText: "ab",
        alternativeCursorPosition: 1,
      };
      const result = confirmationReducer(state, {
        type: "INSERT_TEXT",
        text: "X",
      });
      expect(result.alternativeText).toBe("aXb");
      expect(result.alternativeCursorPosition).toBe(2);
    });

    it("should switch to alternative option", () => {
      const result = confirmationReducer(initialState, {
        type: "INSERT_TEXT",
        text: "a",
      });
      expect(result.selectedOption).toBe("alternative");
    });

    it("should set hasUserInput to true", () => {
      const result = confirmationReducer(initialState, {
        type: "INSERT_TEXT",
        text: "a",
      });
      expect(result.hasUserInput).toBe(true);
    });

    it("should insert multi-char text", () => {
      const result = confirmationReducer(initialState, {
        type: "INSERT_TEXT",
        text: "hello",
      });
      expect(result.alternativeText).toBe("hello");
      expect(result.alternativeCursorPosition).toBe(5);
    });
  });

  describe("BACKSPACE", () => {
    it("should delete character before cursor", () => {
      const state: ConfirmationState = {
        ...initialState,
        alternativeText: "abc",
        alternativeCursorPosition: 2,
        hasUserInput: true,
      };
      const result = confirmationReducer(state, { type: "BACKSPACE" });
      expect(result.alternativeText).toBe("ac");
      expect(result.alternativeCursorPosition).toBe(1);
    });

    it("should return unchanged state if cursor at 0", () => {
      const result = confirmationReducer(initialState, { type: "BACKSPACE" });
      expect(result).toBe(initialState);
    });

    it("should set hasUserInput to false when text becomes empty", () => {
      const state: ConfirmationState = {
        ...initialState,
        alternativeText: "a",
        alternativeCursorPosition: 1,
        hasUserInput: true,
      };
      const result = confirmationReducer(state, { type: "BACKSPACE" });
      expect(result.hasUserInput).toBe(false);
      expect(result.alternativeText).toBe("");
    });

    it("should switch to alternative option", () => {
      const state: ConfirmationState = {
        ...initialState,
        alternativeText: "abc",
        alternativeCursorPosition: 2,
      };
      const result = confirmationReducer(state, { type: "BACKSPACE" });
      expect(result.selectedOption).toBe("alternative");
    });
  });

  describe("MOVE_CURSOR_LEFT", () => {
    it("should decrease cursor position", () => {
      const state: ConfirmationState = {
        ...initialState,
        alternativeCursorPosition: 3,
      };
      const result = confirmationReducer(state, {
        type: "MOVE_CURSOR_LEFT",
      });
      expect(result.alternativeCursorPosition).toBe(2);
    });

    it("should not go below 0", () => {
      const result = confirmationReducer(initialState, {
        type: "MOVE_CURSOR_LEFT",
      });
      expect(result.alternativeCursorPosition).toBe(0);
    });
  });

  describe("MOVE_CURSOR_RIGHT", () => {
    it("should increase cursor position", () => {
      const state: ConfirmationState = {
        ...initialState,
        alternativeText: "hello",
        alternativeCursorPosition: 2,
      };
      const result = confirmationReducer(state, {
        type: "MOVE_CURSOR_RIGHT",
      });
      expect(result.alternativeCursorPosition).toBe(3);
    });

    it("should not go beyond text length", () => {
      const state: ConfirmationState = {
        ...initialState,
        alternativeText: "hi",
        alternativeCursorPosition: 2,
      };
      const result = confirmationReducer(state, {
        type: "MOVE_CURSOR_RIGHT",
      });
      expect(result.alternativeCursorPosition).toBe(2);
    });
  });

  describe("default action", () => {
    it("should return state unchanged for unknown action", () => {
      const result = confirmationReducer(initialState, {
        type: "UNKNOWN",
      } as unknown as ConfirmationAction);
      expect(result).toBe(initialState);
    });
  });
});
