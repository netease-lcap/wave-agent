import { describe, it, expect } from "vitest";
import {
  helpSelectorReducer,
  type SelectorState,
  type SelectorAction,
} from "../../src/reducers/helpSelectorReducer.js";
import { Key } from "ink";

describe("helpSelectorReducer", () => {
  const initialState: SelectorState = {
    selectedIndex: 0,
    activeTab: "general",
    pendingDecision: null,
  };

  it("should handle MOVE_UP", () => {
    const state = { ...initialState, selectedIndex: 2 };
    const result = helpSelectorReducer(state, { type: "MOVE_UP" });
    expect(result.selectedIndex).toBe(1);
  });

  it("should not MOVE_UP below 0", () => {
    const result = helpSelectorReducer(initialState, { type: "MOVE_UP" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle MOVE_DOWN", () => {
    const result = helpSelectorReducer(initialState, {
      type: "MOVE_DOWN",
      maxIndex: 5,
    });
    expect(result.selectedIndex).toBe(1);
  });

  it("should not MOVE_DOWN above maxIndex", () => {
    const state = { ...initialState, selectedIndex: 5 };
    const result = helpSelectorReducer(state, {
      type: "MOVE_DOWN",
      maxIndex: 5,
    });
    expect(result.selectedIndex).toBe(5);
  });

  it("should handle RESET_INDEX", () => {
    const state = { ...initialState, selectedIndex: 3 };
    const result = helpSelectorReducer(state, { type: "RESET_INDEX" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle SWITCH_TAB", () => {
    const tabs = ["general", "commands", "custom-commands"];
    const result = helpSelectorReducer(initialState, {
      type: "SWITCH_TAB",
      tabs,
    });
    expect(result.activeTab).toBe("commands");
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle HANDLE_KEY up/down", () => {
    const upKey = { upArrow: true } as Key;
    const downKey = { downArrow: true } as Key;

    let result = helpSelectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: downKey,
      maxIndex: 2,
      tabs: [],
    });
    expect(result.selectedIndex).toBe(1);

    result = helpSelectorReducer(result, {
      type: "HANDLE_KEY",
      key: upKey,
      maxIndex: 2,
      tabs: [],
    });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle HANDLE_KEY tab (switch tab)", () => {
    const tabKey = { tab: true } as Key;
    const tabs = ["general", "commands"];
    const result = helpSelectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: tabKey,
      maxIndex: 0,
      tabs,
    });
    expect(result.activeTab).toBe("commands");
  });

  it("should handle HANDLE_KEY escape (cancel)", () => {
    const escKey = { escape: true } as Key;
    const result = helpSelectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: escKey,
      maxIndex: 0,
      tabs: [],
    });
    expect(result.pendingDecision).toBe("cancel");
  });

  it("should handle CLEAR_DECISION", () => {
    const state = { ...initialState, pendingDecision: "cancel" as const };
    const result = helpSelectorReducer(state, { type: "CLEAR_DECISION" });
    expect(result.pendingDecision).toBe(null);
  });

  it("should return state for unknown key", () => {
    const otherKey = { return: true } as Key;
    const result = helpSelectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: otherKey,
      maxIndex: 0,
      tabs: [],
    });
    expect(result).toBe(initialState);
  });

  it("should return state for unknown action", () => {
    const result = helpSelectorReducer(initialState, {
      type: "UNKNOWN",
    } as unknown as SelectorAction);
    expect(result).toBe(initialState);
  });
});
