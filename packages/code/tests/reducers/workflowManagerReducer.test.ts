import { describe, it, expect } from "vitest";
import {
  workflowManagerReducer,
  WorkflowManagerState,
  WorkflowManagerAction,
} from "../../src/reducers/workflowManagerReducer.js";
import { Key } from "ink";
import type { WorkflowRun, WorkflowMeta } from "wave-agent-sdk";

describe("workflowManagerReducer", () => {
  const mockMeta: WorkflowMeta = { name: "test", description: "test workflow" };

  const mockRuns: WorkflowRun[] = [
    {
      runId: "run-1",
      meta: mockMeta,
      status: "running",
      scriptPath: "/test.wf.ts",
      startTime: 1000,
      phases: [],
      totalAgents: 0,
      totalTokens: 0,
    },
    {
      runId: "run-2",
      meta: mockMeta,
      status: "completed",
      scriptPath: "/test.wf.ts",
      startTime: 2000,
      phases: [],
      totalAgents: 0,
      totalTokens: 0,
    },
  ];

  const initialState: WorkflowManagerState = {
    runs: [],
    selectedIndex: 0,
    viewMode: "list",
    detailRunId: null,
    pendingEffect: null,
  };

  it("should handle SET_RUNS", () => {
    const result = workflowManagerReducer(initialState, {
      type: "SET_RUNS",
      runs: mockRuns,
    });
    expect(result.runs).toHaveLength(mockRuns.length);
  });

  it("should sort runs by start time descending on SET_RUNS", () => {
    const result = workflowManagerReducer(initialState, {
      type: "SET_RUNS",
      runs: mockRuns,
    });
    expect(result.runs.map((r) => r.runId)).toEqual(["run-2", "run-1"]);
    // The context's array must not be reordered in place.
    expect(mockRuns.map((r) => r.runId)).toEqual(["run-1", "run-2"]);
  });

  it("should keep the selected run selected across SET_RUNS", () => {
    // Newest-first list: run-2 then run-1. The user selected run-1…
    const state: WorkflowManagerState = {
      ...initialState,
      runs: [mockRuns[1], mockRuns[0]],
      selectedIndex: 1,
    };
    // …and a refresh arrives with a newer run prepended, shifting run-1 down.
    const newerRun: WorkflowRun = {
      ...mockRuns[1],
      runId: "run-3",
      startTime: 3000,
    };
    const result = workflowManagerReducer(state, {
      type: "SET_RUNS",
      runs: [mockRuns[0], mockRuns[1], newerRun],
    });
    expect(result.runs.map((r) => r.runId)).toEqual([
      "run-3",
      "run-2",
      "run-1",
    ]);
    expect(result.runs[result.selectedIndex].runId).toBe("run-1");
  });

  it("should clamp the selection when the selected run is gone on SET_RUNS", () => {
    const state: WorkflowManagerState = {
      ...initialState,
      runs: [mockRuns[1], mockRuns[0]],
      selectedIndex: 1,
    };
    const result = workflowManagerReducer(state, {
      type: "SET_RUNS",
      runs: [],
    });
    expect(result.runs).toEqual([]);
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle SELECT_INDEX", () => {
    const result = workflowManagerReducer(initialState, {
      type: "SELECT_INDEX",
      index: 2,
    });
    expect(result.selectedIndex).toBe(2);
  });

  it("should handle MOVE_UP", () => {
    const state = { ...initialState, selectedIndex: 1 };
    const result = workflowManagerReducer(state, { type: "MOVE_UP" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should not move above 0 on MOVE_UP", () => {
    const result = workflowManagerReducer(initialState, { type: "MOVE_UP" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle MOVE_DOWN", () => {
    const state = { ...initialState, runs: mockRuns };
    const result = workflowManagerReducer(state, { type: "MOVE_DOWN" });
    expect(result.selectedIndex).toBe(1);
  });

  it("should not move below last index on MOVE_DOWN", () => {
    const state = { ...initialState, runs: mockRuns, selectedIndex: 1 };
    const result = workflowManagerReducer(state, { type: "MOVE_DOWN" });
    expect(result.selectedIndex).toBe(1);
  });

  it("should not move down when no runs", () => {
    const result = workflowManagerReducer(initialState, { type: "MOVE_DOWN" });
    expect(result.selectedIndex).toBe(0);
  });

  it("should handle SELECT_CURRENT", () => {
    const state = { ...initialState, runs: mockRuns };
    const result = workflowManagerReducer(state, { type: "SELECT_CURRENT" });
    expect(result.viewMode).toBe("detail");
    expect(result.detailRunId).toBe("run-1");
  });

  it("should not select when no runs on SELECT_CURRENT", () => {
    const result = workflowManagerReducer(initialState, {
      type: "SELECT_CURRENT",
    });
    expect(result).toBe(initialState);
  });

  it("should handle SET_VIEW_MODE", () => {
    const result = workflowManagerReducer(initialState, {
      type: "SET_VIEW_MODE",
      mode: "detail",
    });
    expect(result.viewMode).toBe("detail");
  });

  it("should handle RESET_DETAIL", () => {
    const state: WorkflowManagerState = {
      ...initialState,
      viewMode: "detail",
      detailRunId: "run-1",
    };
    const result = workflowManagerReducer(state, { type: "RESET_DETAIL" });
    expect(result.viewMode).toBe("list");
    expect(result.detailRunId).toBe(null);
  });

  it("should handle CLEAR_PENDING_EFFECT", () => {
    const state: WorkflowManagerState = {
      ...initialState,
      pendingEffect: { type: "CANCEL" },
    };
    const result = workflowManagerReducer(state, {
      type: "CLEAR_PENDING_EFFECT",
    });
    expect(result.pendingEffect).toBe(null);
  });

  describe("HANDLE_KEY", () => {
    it("should handle return in list mode", () => {
      const state = { ...initialState, runs: mockRuns };
      const result = workflowManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { return: true } as unknown as Key,
      });
      expect(result.viewMode).toBe("detail");
      expect(result.detailRunId).toBe("run-1");
    });

    it("should not select on return when no runs", () => {
      const result = workflowManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "",
        key: { return: true } as unknown as Key,
      });
      expect(result).toBe(initialState);
    });

    it("should handle escape in list mode", () => {
      const result = workflowManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "",
        key: { escape: true } as unknown as Key,
      });
      expect(result.pendingEffect).toEqual({ type: "CANCEL" });
    });

    it("should handle upArrow in list mode", () => {
      const state = { ...initialState, runs: mockRuns, selectedIndex: 1 };
      const result = workflowManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { upArrow: true } as unknown as Key,
      });
      expect(result.selectedIndex).toBe(0);
    });

    it("should handle downArrow in list mode", () => {
      const state = { ...initialState, runs: mockRuns };
      const result = workflowManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { downArrow: true } as unknown as Key,
      });
      expect(result.selectedIndex).toBe(1);
    });

    it("should handle 'k' in list mode for running task", () => {
      const state = { ...initialState, runs: mockRuns };
      const result = workflowManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "k",
        key: {} as unknown as Key,
      });
      expect(result.pendingEffect).toEqual({
        type: "STOP_RUN",
        runId: "run-1",
      });
    });

    it("should not stop completed task with 'k' in list mode", () => {
      const state = { ...initialState, runs: mockRuns, selectedIndex: 1 };
      const result = workflowManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "k",
        key: {} as unknown as Key,
      });
      expect(result).toBe(state);
    });

    it("should not stop with 'k' when no runs in list mode", () => {
      const result = workflowManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "k",
        key: {} as unknown as Key,
      });
      expect(result).toBe(initialState);
    });

    it("should handle escape in detail mode", () => {
      const state: WorkflowManagerState = {
        ...initialState,
        viewMode: "detail",
        detailRunId: "run-1",
      };
      const result = workflowManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "",
        key: { escape: true } as unknown as Key,
      });
      expect(result.viewMode).toBe("list");
      expect(result.detailRunId).toBe(null);
    });

    it("should handle 'k' in detail mode for running task", () => {
      const state: WorkflowManagerState = {
        ...initialState,
        runs: mockRuns,
        viewMode: "detail",
        detailRunId: "run-1",
      };
      const result = workflowManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "k",
        key: {} as unknown as Key,
      });
      expect(result.pendingEffect).toEqual({
        type: "STOP_RUN",
        runId: "run-1",
      });
    });

    it("should not stop with 'k' in detail mode for completed task", () => {
      const state: WorkflowManagerState = {
        ...initialState,
        runs: mockRuns,
        viewMode: "detail",
        detailRunId: "run-2",
      };
      const result = workflowManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "k",
        key: {} as unknown as Key,
      });
      expect(result).toBe(state);
    });

    it("should not stop with 'k' in detail mode with no detailRunId", () => {
      const state: WorkflowManagerState = {
        ...initialState,
        runs: mockRuns,
        viewMode: "detail",
        detailRunId: null,
      };
      const result = workflowManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "k",
        key: {} as unknown as Key,
      });
      expect(result).toBe(state);
    });

    it("should return state for unhandled key in list mode", () => {
      const result = workflowManagerReducer(initialState, {
        type: "HANDLE_KEY",
        input: "x",
        key: {} as unknown as Key,
      });
      expect(result).toBe(initialState);
    });

    it("should return state for unhandled key in detail mode", () => {
      const state: WorkflowManagerState = {
        ...initialState,
        viewMode: "detail",
        detailRunId: "run-1",
      };
      const result = workflowManagerReducer(state, {
        type: "HANDLE_KEY",
        input: "x",
        key: {} as unknown as Key,
      });
      expect(result).toBe(state);
    });
  });

  it("should return state for unknown action", () => {
    const result = workflowManagerReducer(initialState, {
      type: "UNKNOWN",
    } as unknown as WorkflowManagerAction);
    expect(result).toBe(initialState);
  });
});
