import { Key } from "ink";

export type PendingEffect = { type: "CANCEL" };

export interface HooksManagerState {
  selectedIndex: number;
  viewMode: "list" | "detail";
  pendingEffect: PendingEffect | null;
}

export type HooksManagerAction =
  | { type: "MOVE_UP" }
  | { type: "MOVE_DOWN"; itemCount: number }
  | { type: "SET_VIEW_MODE"; viewMode: "list" | "detail" }
  | {
      type: "HANDLE_KEY";
      input: string;
      key: Key;
      itemCount: number;
    }
  | { type: "CLEAR_PENDING_EFFECT" };

export function hooksManagerReducer(
  state: HooksManagerState,
  action: HooksManagerAction,
): HooksManagerState {
  switch (action.type) {
    case "MOVE_UP":
      return {
        ...state,
        selectedIndex: Math.max(0, state.selectedIndex - 1),
      };
    case "MOVE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(
          Math.max(0, action.itemCount - 1),
          state.selectedIndex + 1,
        ),
      };
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.viewMode };
    case "HANDLE_KEY": {
      const { key, itemCount } = action;

      if (key.return) {
        if (state.viewMode === "list") {
          return { ...state, viewMode: "detail" };
        }
        // Aligned with AgentsManager/SkillsManager detail view: Enter
        // returns to the list.
        return { ...state, viewMode: "list" };
      }

      if (key.escape) {
        if (state.viewMode === "detail") {
          return { ...state, viewMode: "list" };
        }
        return { ...state, pendingEffect: { type: "CANCEL" } };
      }

      // Detail view does not respond to arrow keys (aligned with
      // AgentsManager/SkillsManager).
      if (state.viewMode === "detail") {
        return state;
      }

      if (key.upArrow) {
        return {
          ...state,
          selectedIndex: Math.max(0, state.selectedIndex - 1),
        };
      }

      if (key.downArrow) {
        return {
          ...state,
          selectedIndex: Math.min(
            Math.max(0, itemCount - 1),
            state.selectedIndex + 1,
          ),
        };
      }

      return state;
    }
    case "CLEAR_PENDING_EFFECT":
      return { ...state, pendingEffect: null };
    default:
      return state;
  }
}
