import { Key } from "ink";

export interface SelectorState {
  selectedIndex: number;
  pendingDecision: "select" | "insert" | "cancel" | null;
}

export type SelectorAction =
  | { type: "MOVE_UP" }
  | { type: "MOVE_DOWN"; maxIndex: number }
  | { type: "RESET_INDEX" }
  | { type: "HANDLE_KEY"; key: Key; maxIndex: number; hasInsert: boolean }
  | { type: "CLEAR_DECISION" };

export function selectorReducer(
  state: SelectorState,
  action: SelectorAction,
): SelectorState {
  switch (action.type) {
    case "MOVE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "MOVE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(action.maxIndex, state.selectedIndex + 1),
      };
    case "RESET_INDEX":
      return { ...state, selectedIndex: 0 };
    case "HANDLE_KEY":
      if (action.key.upArrow) {
        return {
          ...state,
          selectedIndex: Math.max(0, state.selectedIndex - 1),
        };
      }
      if (action.key.downArrow) {
        return {
          ...state,
          selectedIndex: Math.min(action.maxIndex, state.selectedIndex + 1),
        };
      }
      if (action.key.return) {
        return { ...state, pendingDecision: "select" };
      }
      if (action.key.tab && action.hasInsert) {
        return { ...state, pendingDecision: "insert" };
      }
      if (action.key.escape) {
        return { ...state, pendingDecision: "cancel" };
      }
      return state;
    case "CLEAR_DECISION":
      return { ...state, pendingDecision: null };
    default:
      return state;
  }
}
