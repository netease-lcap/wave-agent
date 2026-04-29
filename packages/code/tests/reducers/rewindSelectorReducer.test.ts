import { describe, it, expect } from "vitest";
import {
  rewindSelectorReducer,
  type SelectorState,
  type SelectorAction,
} from "../../src/reducers/rewindSelectorReducer.js";
import { Key } from "ink";

describe("rewindSelectorReducer", () => {
  const initialState: SelectorState = {
    selectedIndex: 0,
    pendingDecision: null,
  };

  it("should handle HANDLE_KEY up/down", () => {
    const upKey = { upArrow: true } as Key;
    const downKey = { downArrow: true } as Key;

    let result = rewindSelectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: downKey,
      maxIndex: 2,
    });
    expect(result.selectedIndex).toBe(1);

    result = rewindSelectorReducer(result, {
      type: "HANDLE_KEY",
      key: upKey,
      maxIndex: 2,
    });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle HANDLE_KEY return (select)", () => {
    const returnKey = { return: true } as Key;
    const result = rewindSelectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: returnKey,
      maxIndex: 0,
    });
    expect(result.pendingDecision).toBe("select");
  });

  it("should handle HANDLE_KEY escape (cancel)", () => {
    const escKey = { escape: true } as Key;
    const result = rewindSelectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: escKey,
      maxIndex: 0,
    });
    expect(result.pendingDecision).toBe("cancel");
  });

  it("should handle CLEAR_DECISION", () => {
    const state = { ...initialState, pendingDecision: "select" as const };
    const result = rewindSelectorReducer(state, { type: "CLEAR_DECISION" });
    expect(result.pendingDecision).toBe(null);
  });

  it("should return current state if no key matches", () => {
    const tabKey = { tab: true } as Key;
    const result = rewindSelectorReducer(initialState, {
      type: "HANDLE_KEY",
      key: tabKey,
      maxIndex: 10,
    });
    expect(result).toBe(initialState);
  });

  it("should return state for unknown action", () => {
    const result = rewindSelectorReducer(initialState, {
      type: "UNKNOWN",
    } as unknown as SelectorAction);
    expect(result).toBe(initialState);
  });
});
