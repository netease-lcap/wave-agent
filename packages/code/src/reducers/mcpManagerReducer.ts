import { Key } from "ink";

export type PendingEffect =
  | { type: "CANCEL" }
  | { type: "CONNECT_SERVER"; serverName: string }
  | { type: "DISCONNECT_SERVER"; serverName: string };

export interface McpManagerState {
  selectedIndex: number;
  viewMode: "list" | "detail";
  pendingEffect: PendingEffect | null;
}

export type McpManagerAction =
  | { type: "MOVE_UP"; serverCount: number }
  | { type: "MOVE_DOWN"; serverCount: number }
  | { type: "SET_VIEW_MODE"; viewMode: "list" | "detail" }
  | {
      type: "HANDLE_KEY";
      input: string;
      key: Key;
      serverCount: number;
      servers: Array<{ name: string; status: string }>;
    }
  | { type: "CLEAR_PENDING_EFFECT" };

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
    case "HANDLE_KEY": {
      const { input, key, serverCount, servers } = action;

      if (key.return) {
        if (state.viewMode === "list") {
          return { ...state, viewMode: "detail" };
        }
        return state;
      }

      if (key.escape) {
        if (state.viewMode === "detail") {
          return { ...state, viewMode: "list" };
        } else {
          return { ...state, pendingEffect: { type: "CANCEL" } };
        }
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
          selectedIndex: Math.min(serverCount - 1, state.selectedIndex + 1),
        };
      }

      // Hotkeys for server actions
      if (input === "c") {
        const server = servers[state.selectedIndex];
        if (
          server &&
          (server.status === "disconnected" || server.status === "error")
        ) {
          return {
            ...state,
            pendingEffect: { type: "CONNECT_SERVER", serverName: server.name },
          };
        }
        return state;
      }

      if (input === "d") {
        const server = servers[state.selectedIndex];
        if (server && server.status === "connected") {
          return {
            ...state,
            pendingEffect: {
              type: "DISCONNECT_SERVER",
              serverName: server.name,
            },
          };
        }
        return state;
      }

      return state;
    }
    case "CLEAR_PENDING_EFFECT":
      return { ...state, pendingEffect: null };
    default:
      return state;
  }
}
