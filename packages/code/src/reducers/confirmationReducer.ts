import type { PermissionDecision } from "wave-agent-sdk";

export interface ConfirmationState {
  selectedOption: "clear" | "auto" | "allow" | "alternative";
  alternativeText: string;
  alternativeCursorPosition: number;
  hasUserInput: boolean;
  decision: PermissionDecision | null;
}

export type ConfirmationAction =
  | { type: "SELECT_OPTION"; option: ConfirmationState["selectedOption"] }
  | { type: "INSERT_TEXT"; text: string }
  | { type: "BACKSPACE" }
  | { type: "MOVE_CURSOR_LEFT" }
  | { type: "MOVE_CURSOR_RIGHT" }
  | { type: "CONFIRM"; decision: PermissionDecision };

export function confirmationReducer(
  state: ConfirmationState,
  action: ConfirmationAction,
): ConfirmationState {
  switch (action.type) {
    case "SELECT_OPTION":
      return { ...state, selectedOption: action.option };
    case "INSERT_TEXT": {
      const nextText =
        state.alternativeText.slice(0, state.alternativeCursorPosition) +
        action.text +
        state.alternativeText.slice(state.alternativeCursorPosition);
      return {
        ...state,
        selectedOption: "alternative",
        alternativeText: nextText,
        alternativeCursorPosition:
          state.alternativeCursorPosition + action.text.length,
        hasUserInput: true,
      };
    }
    case "BACKSPACE": {
      if (state.alternativeCursorPosition <= 0) return state;
      const nextText =
        state.alternativeText.slice(0, state.alternativeCursorPosition - 1) +
        state.alternativeText.slice(state.alternativeCursorPosition);
      return {
        ...state,
        selectedOption: "alternative",
        alternativeText: nextText,
        alternativeCursorPosition: state.alternativeCursorPosition - 1,
        hasUserInput: nextText.length > 0,
      };
    }
    case "MOVE_CURSOR_LEFT":
      return {
        ...state,
        alternativeCursorPosition: Math.max(
          0,
          state.alternativeCursorPosition - 1,
        ),
      };
    case "MOVE_CURSOR_RIGHT":
      return {
        ...state,
        alternativeCursorPosition: Math.min(
          state.alternativeText.length,
          state.alternativeCursorPosition + 1,
        ),
      };
    case "CONFIRM":
      return { ...state, decision: action.decision };
    default:
      return state;
  }
}
