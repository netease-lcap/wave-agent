import { describe, it, expect } from "vitest";
import {
  backgroundTaskManagerReducer,
  BackgroundTaskManagerState,
  Task,
  BackgroundTaskManagerAction,
} from "../../src/reducers/backgroundTaskManagerReducer.js";
import { Key } from "ink";

describe("backgroundTaskManagerReducer", () => {
  const mockTasks: Task[] = [
    { id: "1", type: "shell", status: "running", startTime: 1000 },
    { id: "2", type: "shell", status: "completed", startTime: 2000 },
  ];

  const initialState: BackgroundTaskManagerState = {
    tasks: [],
    selectedIndex: 0,
    viewMode: "list",
    detailTaskId: null,
    detailOutput: null,
    pendingEffect: null,
  };

  it("should handle SET_TASKS", () => {
    const result = backgroundTaskManagerReducer(initialState, {
      type: "SET_TASKS",
      tasks: mockTasks,
    });
    expect(result.tasks).toEqual(mockTasks);
  });

  it("should handle MOVE_UP", () => {
    const state = { ...initialState, selectedIndex: 1 };
    const result = backgroundTaskManagerReducer(state, { type: "MOVE_UP" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle MOVE_DOWN", () => {
    const state = { ...initialState, tasks: mockTasks };
    const result = backgroundTaskManagerReducer(state, { type: "MOVE_DOWN" });
    expect(result.selectedIndex).toBe(1);
  });

  it("should handle SELECT_CURRENT", () => {
    const state = { ...initialState, tasks: mockTasks };
    const result = backgroundTaskManagerReducer(state, {
      type: "SELECT_CURRENT",
    });
    expect(result.viewMode).toBe("detail");
    expect(result.detailTaskId).toBe("1");
  });

  describe("HANDLE_KEY", () => {
    it("should handle return in list mode", () => {
      const state = { ...initialState, tasks: mockTasks };
      const result = backgroundTaskManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { return: true } as unknown as Key,
      });
      expect(result.viewMode).toBe("detail");
      expect(result.detailTaskId).toBe("1");
    });

    it("should handle escape in list mode", () => {
      const result = backgroundTaskManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "",
        key: { escape: true } as unknown as Key,
      });
      expect(result.pendingEffect).toEqual({ type: "CANCEL" });
    });

    it("should handle 'k' in list mode", () => {
      const state = { ...initialState, tasks: mockTasks };
      const result = backgroundTaskManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "k",
        key: {} as unknown as Key,
      });
      expect(result.pendingEffect).toEqual({ type: "STOP_TASK", taskId: "1" });
    });

    it("should handle escape in detail mode", () => {
      const state: BackgroundTaskManagerState = {
        ...initialState,
        viewMode: "detail",
        detailTaskId: "1",
      };
      const result = backgroundTaskManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { escape: true } as unknown as Key,
      });
      expect(result.viewMode).toBe("list");
      expect(result.detailTaskId).toBe(null);
    });

    it("should handle 'k' in detail mode", () => {
      const state: BackgroundTaskManagerState = {
        ...initialState,
        viewMode: "detail",
        detailTaskId: "1",
        tasks: mockTasks,
      };
      const result = backgroundTaskManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "k",
        key: {} as unknown as Key,
      });
      expect(result.pendingEffect).toEqual({ type: "STOP_TASK", taskId: "1" });
    });
  });

  it("should handle CLEAR_PENDING_EFFECT", () => {
    const state: BackgroundTaskManagerState = {
      ...initialState,
      pendingEffect: { type: "CANCEL" },
    };
    const result = backgroundTaskManagerReducer(state, {
      type: "CLEAR_PENDING_EFFECT",
    });
    expect(result.pendingEffect).toBe(null);
  });

  it("should return state for unknown action", () => {
    const result = backgroundTaskManagerReducer(initialState, {
      type: "UNKNOWN",
    } as unknown as BackgroundTaskManagerAction);
    expect(result).toBe(initialState);
  });
});
