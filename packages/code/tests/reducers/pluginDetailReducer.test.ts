import { describe, it, expect } from "vitest";
import {
  pluginDetailReducer,
  type PluginDetailState,
  type PluginDetailAction,
} from "../../src/reducers/pluginDetailReducer.js";
import { Key } from "ink";

describe("pluginDetailReducer", () => {
  const initialState: PluginDetailState = {
    selectedScopeIndex: 0,
    selectedActionIndex: 0,
    pendingDecision: null,
  };

  it("should handle MOVE_SCOPE_UP/DOWN", () => {
    let result = pluginDetailReducer(initialState, {
      type: "MOVE_SCOPE_DOWN",
      maxIndex: 2,
    });
    expect(result.selectedScopeIndex).toBe(1);
    result = pluginDetailReducer(result, {
      type: "MOVE_SCOPE_UP",
      maxIndex: 2,
    });
    expect(result.selectedScopeIndex).toBe(0);
    // Wrap around
    result = pluginDetailReducer(initialState, {
      type: "MOVE_SCOPE_UP",
      maxIndex: 2,
    });
    expect(result.selectedScopeIndex).toBe(2);
    result = pluginDetailReducer(result, {
      type: "MOVE_SCOPE_DOWN",
      maxIndex: 2,
    });
    expect(result.selectedScopeIndex).toBe(0);
  });

  it("should handle MOVE_ACTION_UP/DOWN", () => {
    let result = pluginDetailReducer(initialState, {
      type: "MOVE_ACTION_DOWN",
      maxIndex: 1,
    });
    expect(result.selectedActionIndex).toBe(1);
    result = pluginDetailReducer(result, {
      type: "MOVE_ACTION_UP",
      maxIndex: 1,
    });
    expect(result.selectedActionIndex).toBe(0);
    // Wrap around
    result = pluginDetailReducer(initialState, {
      type: "MOVE_ACTION_UP",
      maxIndex: 1,
    });
    expect(result.selectedActionIndex).toBe(1);
    result = pluginDetailReducer(result, {
      type: "MOVE_ACTION_DOWN",
      maxIndex: 1,
    });
    expect(result.selectedActionIndex).toBe(0);
  });

  it("should handle HANDLE_KEY up/down (syncs scope and action indices)", () => {
    const downKey = { downArrow: true } as Key;
    const upKey = { upArrow: true } as Key;

    let result = pluginDetailReducer(initialState, {
      type: "HANDLE_KEY",
      key: downKey,
      maxIndex: 2,
    });
    expect(result.selectedScopeIndex).toBe(1);
    expect(result.selectedActionIndex).toBe(1);

    result = pluginDetailReducer(result, {
      type: "HANDLE_KEY",
      key: upKey,
      maxIndex: 2,
    });
    expect(result.selectedScopeIndex).toBe(0);
    expect(result.selectedActionIndex).toBe(0);
  });

  it("should handle HANDLE_KEY return/escape", () => {
    const returnKey = { return: true } as Key;
    const escKey = { escape: true } as Key;

    let result = pluginDetailReducer(initialState, {
      type: "HANDLE_KEY",
      key: returnKey,
      maxIndex: 0,
    });
    expect(result.pendingDecision).toBe("select");

    result = pluginDetailReducer(initialState, {
      type: "HANDLE_KEY",
      key: escKey,
      maxIndex: 0,
    });
    expect(result.pendingDecision).toBe("cancel");
  });

  it("should handle SELECT_SCOPE_INDEX/SELECT_ACTION_INDEX", () => {
    let result = pluginDetailReducer(initialState, {
      type: "SELECT_SCOPE_INDEX",
      index: 2,
    });
    expect(result.selectedScopeIndex).toBe(2);
    result = pluginDetailReducer(initialState, {
      type: "SELECT_ACTION_INDEX",
      index: 1,
    });
    expect(result.selectedActionIndex).toBe(1);
  });

  it("should return state for unknown action", () => {
    const result = pluginDetailReducer(initialState, {
      type: "UNKNOWN",
    } as unknown as PluginDetailAction);
    expect(result).toBe(initialState);
  });
});
