import { describe, it, expect } from "vitest";
import {
  selectorReducer,
  type SelectorState,
  type SelectorAction,
} from "../../src/reducers/selectorReducer.js";
import { Key } from "ink";

describe("selectorReducer", () => {
  const initialState: SelectorState = {
    selectedIndex: 0,
    pendingDecision: null,
    items: ["a", "b", "c"],
  };

  it("should handle HANDLE_KEY up/down", () => {
    const upKey = { upArrow: true } as Key;
    const downKey = { downArrow: true } as Key;

    let result = selectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: downKey,
      hasInsert: false,
    });
    expect(result.selectedIndex).toBe(1);

    result = selectorReducer(result, {
      type: "HANDLE_KEY",
      key: upKey,
      hasInsert: false,
    });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle HANDLE_KEY return (select)", () => {
    const returnKey = { return: true } as Key;
    const result = selectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: returnKey,
      hasInsert: false,
    });
    expect(result.pendingDecision).toBe("select");
  });

  it("should handle HANDLE_KEY tab (insert) if hasInsert is true", () => {
    const tabKey = { tab: true } as Key;
    const result = selectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: tabKey,
      hasInsert: true,
    });
    expect(result.pendingDecision).toBe("insert");
  });

  it("should ignore HANDLE_KEY tab if hasInsert is false", () => {
    const tabKey = { tab: true } as Key;
    const result = selectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: tabKey,
      hasInsert: false,
    });
    expect(result.pendingDecision).toBe(null);
  });

  it("should handle HANDLE_KEY escape (cancel)", () => {
    const escKey = { escape: true } as Key;
    const result = selectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: escKey,
      hasInsert: false,
    });
    expect(result.pendingDecision).toBe("cancel");
  });

  it("should handle MOVE_UP/MOVE_DOWN actions", () => {
    let result = selectorReducer(initialState, {
      type: "MOVE_DOWN",
    });
    expect(result.selectedIndex).toBe(1);
    result = selectorReducer(result, { type: "MOVE_UP" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle RESET_INDEX", () => {
    const state = { ...initialState, selectedIndex: 2 };
    const result = selectorReducer(state, { type: "RESET_INDEX" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle SET_ITEMS", () => {
    const result = selectorReducer(initialState, {
      type: "SET_ITEMS",
      items: ["x", "y"],
    });
    expect(result.items).toEqual(["x", "y"]);
    expect(result.selectedIndex).toBe(0);
  });

  it("should return state for unknown action", () => {
    const result = selectorReducer(initialState, {
      type: "UNKNOWN",
    } as unknown as SelectorAction);
    expect(result).toBe(initialState);
  });
});
