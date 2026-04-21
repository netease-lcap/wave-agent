export interface McpManagerState {
  selectedIndex: number;
  viewMode: "list" | "detail";
}

export type McpManagerAction =
  | { type: "MOVE_UP"; serverCount: number }
  | { type: "MOVE_DOWN"; serverCount: number }
  | { type: "SET_VIEW_MODE"; viewMode: "list" | "detail" };

export function mcpManagerReducer(
  state: McpManagerState,
  action: McpManagerAction,
): McpManagerState {
  switch (action.type) {
    case "MOVE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "MOVE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(
          action.serverCount - 1,
          state.selectedIndex + 1,
        ),
      };
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.viewMode };
    default:
      return state;
  }
}
