import { Key } from "ink";
import type { PermissionDecision } from "wave-agent-sdk";
import {
  BASH_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
} from "wave-agent-sdk";

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
  | { type: "CONFIRM"; decision: PermissionDecision }
  | { type: "CLEAR_DECISION" }
  | {
      type: "HANDLE_KEY";
      input: string;
      key: Key;
      toolName: string;
      toolInput?: Record<string, unknown>;
      suggestedPrefix?: string;
      hidePersistentOption?: boolean;
    };

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
    case "CLEAR_DECISION":
      return { ...state, decision: null };
    case "HANDLE_KEY": {
      const {
        input,
        key,
        toolName,
        toolInput,
        suggestedPrefix,
        hidePersistentOption,
      } = action;

      if (key.return) {
        let decision: PermissionDecision | null = null;
        if (state.selectedOption === "clear") {
          decision = {
            behavior: "allow",
            newPermissionMode: "acceptEdits",
            clearContext: true,
          };
        } else if (state.selectedOption === "allow") {
          if (toolName === EXIT_PLAN_MODE_TOOL_NAME) {
            decision = { behavior: "allow", newPermissionMode: "default" };
          } else if (toolName === ENTER_PLAN_MODE_TOOL_NAME) {
            decision = { behavior: "allow", newPermissionMode: "plan" };
          } else {
            decision = { behavior: "allow" };
          }
        } else if (state.selectedOption === "auto") {
          if (toolName === BASH_TOOL_NAME) {
            const command = (toolInput?.command as string) || "";
            if (command.trim().startsWith("mkdir")) {
              decision = {
                behavior: "allow",
                newPermissionMode: "acceptEdits",
              };
            } else {
              const rule = suggestedPrefix
                ? `Bash(${suggestedPrefix})`
                : `Bash(${toolInput?.command})`;
              decision = { behavior: "allow", newPermissionRule: rule };
            }
          } else if (toolName === ENTER_PLAN_MODE_TOOL_NAME) {
            decision = { behavior: "allow", newPermissionMode: "plan" };
          } else if (toolName.startsWith("mcp__")) {
            decision = { behavior: "allow", newPermissionRule: toolName };
          } else {
            decision = { behavior: "allow", newPermissionMode: "acceptEdits" };
          }
        } else if (state.alternativeText.trim()) {
          decision = {
            behavior: "deny",
            message: state.alternativeText.trim(),
          };
        } else if (toolName === ENTER_PLAN_MODE_TOOL_NAME) {
          decision = {
            behavior: "deny",
            message: "User chose not to enter plan mode",
          };
        }

        if (decision) {
          return { ...state, decision };
        }
        return state;
      }

      if (state.selectedOption === "alternative") {
        if (key.leftArrow) {
          return {
            ...state,
            alternativeCursorPosition: Math.max(
              0,
              state.alternativeCursorPosition - 1,
            ),
          };
        }
        if (key.rightArrow) {
          return {
            ...state,
            alternativeCursorPosition: Math.min(
              state.alternativeText.length,
              state.alternativeCursorPosition + 1,
            ),
          };
        }
      }

      const availableOptions: ConfirmationState["selectedOption"][] = [];
      if (toolName === EXIT_PLAN_MODE_TOOL_NAME) availableOptions.push("clear");
      availableOptions.push("allow");
      if (!hidePersistentOption) availableOptions.push("auto");
      availableOptions.push("alternative");

      if (key.upArrow) {
        const currentIndex = availableOptions.indexOf(state.selectedOption);
        if (currentIndex > 0) {
          return {
            ...state,
            selectedOption: availableOptions[currentIndex - 1],
          };
        }
        return state;
      }

      if (key.downArrow) {
        const currentIndex = availableOptions.indexOf(state.selectedOption);
        if (currentIndex < availableOptions.length - 1) {
          return {
            ...state,
            selectedOption: availableOptions[currentIndex + 1],
          };
        }
        return state;
      }

      if (key.tab) {
        const currentIndex = availableOptions.indexOf(state.selectedOption);
        const direction = key.shift ? -1 : 1;
        let nextIndex = currentIndex + direction;
        if (nextIndex < 0) nextIndex = availableOptions.length - 1;
        if (nextIndex >= availableOptions.length) nextIndex = 0;
        return { ...state, selectedOption: availableOptions[nextIndex] };
      }

      if (input && !key.ctrl && !key.meta && !("alt" in key && key.alt)) {
        const nextText =
          state.alternativeText.slice(0, state.alternativeCursorPosition) +
          input +
          state.alternativeText.slice(state.alternativeCursorPosition);
        return {
          ...state,
          selectedOption: "alternative",
          alternativeText: nextText,
          alternativeCursorPosition:
            state.alternativeCursorPosition + input.length,
          hasUserInput: true,
        };
      }

      if (key.backspace || key.delete) {
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

      return state;
    }
    default:
      return state;
  }
}
