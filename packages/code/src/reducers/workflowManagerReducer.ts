import { Key } from "ink";
import type { WorkflowRun } from "wave-agent-sdk";

export type PendingEffect =
  | { type: "CANCEL" }
  | { type: "STOP_RUN"; runId: string };

export interface WorkflowManagerState {
  runs: WorkflowRun[];
  selectedIndex: number;
  viewMode: "list" | "detail";
  detailRunId: string | null;
  pendingEffect: PendingEffect | null;
}

export type WorkflowManagerAction =
  | { type: "SET_RUNS"; runs: WorkflowRun[] }
  | { type: "SELECT_INDEX"; index: number }
  | { type: "MOVE_UP" }
  | { type: "MOVE_DOWN" }
  | { type: "SELECT_CURRENT" }
  | { type: "SET_VIEW_MODE"; mode: "list" | "detail" }
  | { type: "RESET_DETAIL" }
  | { type: "HANDLE_KEY"; input: string; key: Key }
  | { type: "CLEAR_PENDING_EFFECT" };

export function workflowManagerReducer(
  state: WorkflowManagerState,
  action: WorkflowManagerAction,
): WorkflowManagerState {
  switch (action.type) {
    case "SET_RUNS": {
      // Newest first (spec multi-agent/workflow「工作流管理对话框（IDE 与 CLI）」场景
      // 1): the run just started is the one to look at. The host hands them over
      // in its own map order (creation order, plus whatever a session restore
      // appended), which puts it at the bottom.
      const runs = [...action.runs].sort((a, b) => b.startTime - a.startTime);
      // The sort moves rows when a run appears at the top, so an index-stable
      // selection would silently follow the position instead of the run.
      const previous = state.runs[state.selectedIndex];
      const keptIndex = previous
        ? runs.findIndex((r) => r.runId === previous.runId)
        : -1;
      return {
        ...state,
        runs,
        selectedIndex:
          keptIndex >= 0
            ? keptIndex
            : Math.min(state.selectedIndex, Math.max(0, runs.length - 1)),
      };
    }
    case "SELECT_INDEX":
      return { ...state, selectedIndex: action.index };
    case "MOVE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "MOVE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(
          state.runs.length > 0 ? state.runs.length - 1 : 0,
          state.selectedIndex + 1,
        ),
      };
    case "SELECT_CURRENT":
      if (state.runs.length > 0 && state.selectedIndex < state.runs.length) {
        return {
          ...state,
          detailRunId: state.runs[state.selectedIndex].runId,
          viewMode: "detail",
        };
      }
      return state;
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode };
    case "RESET_DETAIL":
      return {
        ...state,
        viewMode: "list",
        detailRunId: null,
      };
    case "HANDLE_KEY": {
      const { input, key } = action;
      if (state.viewMode === "list") {
        if (key.return) {
          if (
            state.runs.length > 0 &&
            state.selectedIndex < state.runs.length
          ) {
            return {
              ...state,
              detailRunId: state.runs[state.selectedIndex].runId,
              viewMode: "detail",
            };
          }
          return state;
        }

        if (key.escape) {
          return { ...state, pendingEffect: { type: "CANCEL" } };
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
            selectedIndex: Math.min(
              state.runs.length > 0 ? state.runs.length - 1 : 0,
              state.selectedIndex + 1,
            ),
          };
        }

        if (input === "k") {
          if (
            state.runs.length > 0 &&
            state.selectedIndex < state.runs.length
          ) {
            const selectedRun = state.runs[state.selectedIndex];
            if (selectedRun.status === "running") {
              return {
                ...state,
                pendingEffect: { type: "STOP_RUN", runId: selectedRun.runId },
              };
            }
          }
          return state;
        }
      } else if (state.viewMode === "detail") {
        if (key.escape) {
          return {
            ...state,
            viewMode: "list",
            detailRunId: null,
          };
        }

        if (input === "k" && state.detailRunId) {
          const run = state.runs.find((r) => r.runId === state.detailRunId);
          if (run && run.status === "running") {
            return {
              ...state,
              pendingEffect: { type: "STOP_RUN", runId: state.detailRunId },
            };
          }
          return state;
        }
      }
      return state;
    }
    case "CLEAR_PENDING_EFFECT":
      return { ...state, pendingEffect: null };
    default:
      return state;
  }
}
