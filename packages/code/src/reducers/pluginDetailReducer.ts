import { Key } from "ink";

export interface PluginDetailState {
  selectedScopeIndex: number;
  selectedActionIndex: number;
  pendingDecision: "select" | "cancel" | null;
}

export type PluginDetailAction =
  | { type: "SELECT_SCOPE_INDEX"; index: number }
  | { type: "SELECT_ACTION_INDEX"; index: number }
  | { type: "MOVE_SCOPE_UP"; maxIndex: number }
  | { type: "MOVE_SCOPE_DOWN"; maxIndex: number }
  | { type: "MOVE_ACTION_UP"; maxIndex: number }
  | { type: "MOVE_ACTION_DOWN"; maxIndex: number }
  | { type: "HANDLE_KEY"; key: Key; maxIndex: number }
  | { type: "CLEAR_DECISION" };

export function pluginDetailReducer(
  state: PluginDetailState,
  action: PluginDetailAction,
): PluginDetailState {
  switch (action.type) {
    case "SELECT_SCOPE_INDEX":
      return { ...state, selectedScopeIndex: action.index };
    case "SELECT_ACTION_INDEX":
      return { ...state, selectedActionIndex: action.index };
    case "MOVE_SCOPE_UP":
      return {
        ...state,
        selectedScopeIndex:
          state.selectedScopeIndex > 0
            ? state.selectedScopeIndex - 1
            : action.maxIndex,
      };
    case "MOVE_SCOPE_DOWN":
      return {
        ...state,
        selectedScopeIndex:
          state.selectedScopeIndex < action.maxIndex
            ? state.selectedScopeIndex + 1
            : 0,
      };
    case "MOVE_ACTION_UP":
      return {
        ...state,
        selectedActionIndex:
          state.selectedActionIndex > 0
            ? state.selectedActionIndex - 1
            : action.maxIndex,
      };
    case "MOVE_ACTION_DOWN":
      return {
        ...state,
        selectedActionIndex:
          state.selectedActionIndex < action.maxIndex
            ? state.selectedActionIndex + 1
            : 0,
      };
    case "HANDLE_KEY":
      if (action.key.upArrow) {
        return {
          ...state,
          selectedScopeIndex:
            state.selectedScopeIndex > 0
              ? state.selectedScopeIndex - 1
              : action.maxIndex,
          selectedActionIndex:
            state.selectedActionIndex > 0
              ? state.selectedActionIndex - 1
              : action.maxIndex,
        };
      }
      if (action.key.downArrow) {
        return {
          ...state,
          selectedScopeIndex:
            state.selectedScopeIndex < action.maxIndex
              ? state.selectedScopeIndex + 1
              : 0,
          selectedActionIndex:
            state.selectedActionIndex < action.maxIndex
              ? state.selectedActionIndex + 1
              : 0,
        };
      }
      if (action.key.return) {
        return { ...state, pendingDecision: "select" };
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
