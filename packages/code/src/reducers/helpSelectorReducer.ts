import { Key } from "ink";

export interface SelectorState {
  selectedIndex: number;
  activeTab: "general" | "commands" | "custom-commands";
  pendingDecision: "select" | "insert" | "cancel" | "tab-switch" | null;
}

export type SelectorAction =
  | { type: "MOVE_UP" }
  | { type: "MOVE_DOWN"; maxIndex: number }
  | { type: "RESET_INDEX" }
  | { type: "SWITCH_TAB"; tabs: string[] }
  | { type: "HANDLE_KEY"; key: Key; maxIndex: number; tabs: string[] }
  | { type: "CLEAR_DECISION" };

export function helpSelectorReducer(
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
    case "SWITCH_TAB": {
      const currentIndex = action.tabs.indexOf(state.activeTab);
      const nextIndex = (currentIndex + 1) % action.tabs.length;
      return {
        ...state,
        activeTab: action.tabs[nextIndex] as
          | "general"
          | "commands"
          | "custom-commands",
        selectedIndex: 0,
      };
    }
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
      if (action.key.tab) {
        const currentIndex = action.tabs.indexOf(state.activeTab);
        const nextIndex = (currentIndex + 1) % action.tabs.length;
        return {
          ...state,
          activeTab: action.tabs[nextIndex] as
            | "general"
            | "commands"
            | "custom-commands",
          selectedIndex: 0,
        };
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
