import { Key } from "ink";

export interface SelectorState<T = unknown> {
  selectedIndex: number;
  pendingDecision: "select" | "insert" | "cancel" | null;
  items: T[];
}

export type SelectorAction<T = unknown> =
  | { type: "MOVE_UP" }
  | { type: "MOVE_DOWN" }
  | { type: "RESET_INDEX" }
  | { type: "SET_ITEMS"; items: T[] }
  | { type: "HANDLE_KEY"; key: Key; hasInsert: boolean }
  | { type: "CLEAR_DECISION" };

export function selectorReducer<T = unknown>(
  state: SelectorState<T>,
  action: SelectorAction<T>,
): SelectorState<T> {
  switch (action.type) {
    case "MOVE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "MOVE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(
          state.items.length - 1,
          state.selectedIndex + 1,
        ),
      };
    case "RESET_INDEX":
      return { ...state, selectedIndex: 0 };
    case "SET_ITEMS":
      return { ...state, items: action.items, selectedIndex: 0 };
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
          selectedIndex: Math.min(
            state.items.length - 1,
            state.selectedIndex + 1,
          ),
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
