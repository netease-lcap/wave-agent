export interface PluginDetailState {
  selectedScopeIndex: number;
  selectedActionIndex: number;
}

export type PluginDetailAction =
  | { type: "SELECT_SCOPE_INDEX"; index: number }
  | { type: "SELECT_ACTION_INDEX"; index: number }
  | { type: "MOVE_SCOPE_UP"; maxIndex: number }
  | { type: "MOVE_SCOPE_DOWN"; maxIndex: number }
  | { type: "MOVE_ACTION_UP"; maxIndex: number }
  | { type: "MOVE_ACTION_DOWN"; maxIndex: number };

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
    default:
      return state;
  }
}
