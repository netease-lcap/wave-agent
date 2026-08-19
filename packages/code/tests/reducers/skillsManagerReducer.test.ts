import { describe, it, expect } from "vitest";
import {
  skillsManagerReducer,
  SkillsManagerState,
} from "../../src/reducers/skillsManagerReducer.js";
import { Key } from "ink";

describe("skillsManagerReducer", () => {
  const initialState: SkillsManagerState = {
    selectedIndex: 0,
    viewMode: "list",
    pendingEffect: null,
  };

  it("should handle MOVE_UP", () => {
    const state: SkillsManagerState = { ...initialState, selectedIndex: 1 };
    const result = skillsManagerReducer(state, { type: "MOVE_UP" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should clamp MOVE_UP at zero", () => {
    const result = skillsManagerReducer(initialState, { type: "MOVE_UP" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle MOVE_DOWN", () => {
    const result = skillsManagerReducer(initialState, {
      type: "MOVE_DOWN",
      itemCount: 5,
    });
    expect(result.selectedIndex).toBe(1);
  });

  it("should clamp MOVE_DOWN at itemCount - 1", () => {
    const state: SkillsManagerState = { ...initialState, selectedIndex: 4 };
    const result = skillsManagerReducer(state, {
      type: "MOVE_DOWN",
      itemCount: 5,
    });
    expect(result.selectedIndex).toBe(4);
  });

  it("should handle SET_VIEW_MODE", () => {
    const result = skillsManagerReducer(initialState, {
      type: "SET_VIEW_MODE",
      viewMode: "detail",
    });
    expect(result.viewMode).toBe("detail");
  });

  it("should handle CLEAR_PENDING_EFFECT", () => {
    const state: SkillsManagerState = {
      ...initialState,
      pendingEffect: { type: "CANCEL" },
    };
    const result = skillsManagerReducer(state, {
      type: "CLEAR_PENDING_EFFECT",
    });
    expect(result.pendingEffect).toBeNull();
  });

  describe("HANDLE_KEY", () => {
    it("should enter detail mode on return in list mode", () => {
      const result = skillsManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "",
        key: { return: true } as unknown as Key,
        itemCount: 5,
      });
      expect(result.viewMode).toBe("detail");
    });

    it("should return to list mode on return in detail mode", () => {
      const state: SkillsManagerState = { ...initialState, viewMode: "detail" };
      const result = skillsManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { return: true } as unknown as Key,
        itemCount: 5,
      });
      expect(result.viewMode).toBe("list");
    });

    it("should set CANCEL effect on escape in list mode", () => {
      const result = skillsManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "",
        key: { escape: true } as unknown as Key,
        itemCount: 5,
      });
      expect(result.pendingEffect).toEqual({ type: "CANCEL" });
    });

    it("should return to list mode on escape in detail mode", () => {
      const state: SkillsManagerState = { ...initialState, viewMode: "detail" };
      const result = skillsManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { escape: true } as unknown as Key,
        itemCount: 5,
      });
      expect(result.viewMode).toBe("list");
    });

    it("should move selection down on downArrow in list mode", () => {
      const result = skillsManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "",
        key: { downArrow: true } as unknown as Key,
        itemCount: 5,
      });
      expect(result.selectedIndex).toBe(1);
    });

    it("should clamp downArrow at last item", () => {
      const state: SkillsManagerState = { ...initialState, selectedIndex: 4 };
      const result = skillsManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { downArrow: true } as unknown as Key,
        itemCount: 5,
      });
      expect(result.selectedIndex).toBe(4);
    });

    it("should move selection up on upArrow in list mode", () => {
      const state: SkillsManagerState = { ...initialState, selectedIndex: 2 };
      const result = skillsManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { upArrow: true } as unknown as Key,
        itemCount: 5,
      });
      expect(result.selectedIndex).toBe(1);
    });

    it("should clamp upArrow at first item", () => {
      const result = skillsManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "",
        key: { upArrow: true } as unknown as Key,
        itemCount: 5,
      });
      expect(result.selectedIndex).toBe(0);
    });

    it("should ignore arrow keys in detail mode", () => {
      const state: SkillsManagerState = { ...initialState, viewMode: "detail" };
      const result = skillsManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { downArrow: true } as unknown as Key,
        itemCount: 5,
      });
      expect(result.selectedIndex).toBe(0);
      expect(result.viewMode).toBe("detail");
    });

    it("should return state unchanged for other keys", () => {
      const result = skillsManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "a",
        key: {} as Key,
        itemCount: 5,
      });
      expect(result).toEqual(initialState);
    });
  });
});
