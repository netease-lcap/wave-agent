import { describe, it, expect } from "vitest";
import {
  mcpManagerReducer,
  McpManagerState,
  McpManagerAction,
} from "../../src/reducers/mcpManagerReducer.js";
import { Key } from "ink";

describe("mcpManagerReducer", () => {
  const initialState: McpManagerState = {
    selectedIndex: 0,
    viewMode: "list",
    pendingEffect: null,
  };

  it("should handle MOVE_UP", () => {
    const state: McpManagerState = { ...initialState, selectedIndex: 1 };
    const result = mcpManagerReducer(state, {
      type: "MOVE_UP",
      serverCount: 2,
    });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle MOVE_DOWN", () => {
    const result = mcpManagerReducer(initialState, {
      type: "MOVE_DOWN",
      serverCount: 2,
    });
    expect(result.selectedIndex).toBe(1);
  });

  it("should handle SET_VIEW_MODE", () => {
    const result = mcpManagerReducer(initialState, {
      type: "SET_VIEW_MODE",
      viewMode: "detail",
    });
    expect(result.viewMode).toBe("detail");
  });

  describe("HANDLE_KEY", () => {
    const servers = [
      { name: "server1", status: "connected" },
      { name: "server2", status: "disconnected" },
    ];

    it("should handle return in list mode", () => {
      const result = mcpManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "",
        key: { return: true } as unknown as Key,
        serverCount: 2,
        servers,
      });
      expect(result.viewMode).toBe("detail");
    });

    it("should handle escape in list mode", () => {
      const result = mcpManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "",
        key: { escape: true } as unknown as Key,
        serverCount: 2,
        servers,
      });
      expect(result.pendingEffect).toEqual({ type: "CANCEL" });
    });

    it("should handle escape in detail mode", () => {
      const state: McpManagerState = { ...initialState, viewMode: "detail" };
      const result = mcpManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { escape: true } as unknown as Key,
        serverCount: 2,
        servers,
      });
      expect(result.viewMode).toBe("list");
    });

    it("should handle upArrow", () => {
      const state: McpManagerState = { ...initialState, selectedIndex: 1 };
      const result = mcpManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { upArrow: true } as unknown as Key,
        serverCount: 2,
        servers,
      });
      expect(result.selectedIndex).toBe(0);
    });

    it("should handle downArrow", () => {
      const result = mcpManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "",
        key: { downArrow: true } as unknown as Key,
        serverCount: 2,
        servers,
      });
      expect(result.selectedIndex).toBe(1);
    });

    it("should handle 'c' for connect", () => {
      const state: McpManagerState = { ...initialState, selectedIndex: 1 }; // server2 is disconnected
      const result = mcpManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "c",
        key: {} as unknown as Key,
        serverCount: 2,
        servers,
      });
      expect(result.pendingEffect).toEqual({
        type: "CONNECT_SERVER",
        serverName: "server2",
      });
    });

    it("should handle 'd' for disconnect", () => {
      const result = mcpManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "d",
        key: {} as unknown as Key,
        serverCount: 2,
        servers,
      });
      expect(result.pendingEffect).toEqual({
        type: "DISCONNECT_SERVER",
        serverName: "server1",
      });
    });
  });

  it("should handle CLEAR_PENDING_EFFECT", () => {
    const state: McpManagerState = {
      ...initialState,
      pendingEffect: { type: "CANCEL" },
    };
    const result = mcpManagerReducer(state, { type: "CLEAR_PENDING_EFFECT" });
    expect(result.pendingEffect).toBe(null);
  });

  it("should return state for unknown action", () => {
    const result = mcpManagerReducer(initialState, {
      type: "UNKNOWN",
    } as unknown as McpManagerAction);
    expect(result).toBe(initialState);
  });
});
