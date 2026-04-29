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
  };

  it("should handle HANDLE_KEY up/down", () => {
    const upKey = { upArrow: true } as Key;
    const downKey = { downArrow: true } as Key;

    let result = selectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: downKey,
      maxIndex: 2,
      hasInsert: false,
    });
    expect(result.selectedIndex).toBe(1);

    result = selectorReducer(result, {
      type: "HANDLE_KEY",
      key: upKey,
      maxIndex: 2,
      hasInsert: false,
    });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle HANDLE_KEY return (select)", () => {
    const returnKey = { return: true } as Key;
    const result = selectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: returnKey,
      maxIndex: 0,
      hasInsert: false,
    });
    expect(result.pendingDecision).toBe("select");
  });

  it("should handle HANDLE_KEY tab (insert) if hasInsert is true", () => {
    const tabKey = { tab: true } as Key;
    const result = selectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: tabKey,
      maxIndex: 0,
      hasInsert: true,
    });
    expect(result.pendingDecision).toBe("insert");
  });

  it("should ignore HANDLE_KEY tab if hasInsert is false", () => {
    const tabKey = { tab: true } as Key;
    const result = selectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: tabKey,
      maxIndex: 0,
      hasInsert: false,
    });
    expect(result.pendingDecision).toBe(null);
  });

  it("should handle HANDLE_KEY escape (cancel)", () => {
    const escKey = { escape: true } as Key;
    const result = selectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: escKey,
      maxIndex: 0,
      hasInsert: false,
    });
    expect(result.pendingDecision).toBe("cancel");
  });

  it("should handle MOVE_UP/MOVE_DOWN actions", () => {
    let result = selectorReducer(initialState, {
      type: "MOVE_DOWN",
      maxIndex: 5,
    });
    expect(result.selectedIndex).toBe(1);
    result = selectorReducer(result, { type: "MOVE_UP" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle RESET_INDEX", () => {
    const state = { ...initialState, selectedIndex: 5 };
    const result = selectorReducer(state, { type: "RESET_INDEX" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should return state for unknown action", () => {
    const result = selectorReducer(initialState, {
      type: "UNKNOWN",
    } as unknown as SelectorAction);
    expect(result).toBe(initialState);
  });
});
