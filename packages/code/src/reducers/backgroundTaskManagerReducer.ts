import { Key } from "ink";

export interface Task {
  id: string;
  type: string;
  description?: string;
  status: "running" | "completed" | "failed" | "killed";
  startTime: number;
  exitCode?: number;
  runtime?: number;
  outputPath?: string;
}

export interface DetailOutput {
  stdout: string;
  stderr: string;
  status: string;
  outputPath?: string;
}

export type PendingEffect =
  | { type: "CANCEL" }
  | { type: "STOP_TASK"; taskId: string };

export interface BackgroundTaskManagerState {
  tasks: Task[];
  selectedIndex: number;
  viewMode: "list" | "detail";
  detailTaskId: string | null;
  detailOutput: DetailOutput | null;
  pendingEffect: PendingEffect | null;
}

export type BackgroundTaskManagerAction =
  | { type: "SET_TASKS"; tasks: Task[] }
  | { type: "SELECT_INDEX"; index: number }
  | { type: "MOVE_UP" }
  | { type: "MOVE_DOWN" }
  | { type: "SELECT_CURRENT" }
  | { type: "SET_VIEW_MODE"; mode: "list" | "detail" }
  | { type: "SET_DETAIL_TASK_ID"; id: string | null }
  | { type: "SET_DETAIL_OUTPUT"; output: DetailOutput | null }
  | { type: "RESET_DETAIL" }
  | { type: "HANDLE_KEY"; input: string; key: Key }
  | { type: "CLEAR_PENDING_EFFECT" };

export function backgroundTaskManagerReducer(
  state: BackgroundTaskManagerState,
  action: BackgroundTaskManagerAction,
): BackgroundTaskManagerState {
  switch (action.type) {
    case "SET_TASKS":
      return { ...state, tasks: action.tasks };
    case "SELECT_INDEX":
      return { ...state, selectedIndex: action.index };
    case "MOVE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "MOVE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(
          state.tasks.length > 0 ? state.tasks.length - 1 : 0,
          state.selectedIndex + 1,
        ),
      };
    case "SELECT_CURRENT":
      if (state.tasks.length > 0 && state.selectedIndex < state.tasks.length) {
        return {
          ...state,
          detailTaskId: state.tasks[state.selectedIndex].id,
          viewMode: "detail",
        };
      }
      return state;
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode };
    case "SET_DETAIL_TASK_ID":
      return { ...state, detailTaskId: action.id };
    case "SET_DETAIL_OUTPUT":
      return { ...state, detailOutput: action.output };
    case "RESET_DETAIL":
      return {
        ...state,
        viewMode: "list",
        detailTaskId: null,
        detailOutput: null,
      };
    case "HANDLE_KEY": {
      const { input, key } = action;
      if (state.viewMode === "list") {
        if (key.return) {
          if (
            state.tasks.length > 0 &&
            state.selectedIndex < state.tasks.length
          ) {
            return {
              ...state,
              detailTaskId: state.tasks[state.selectedIndex].id,
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
              state.tasks.length > 0 ? state.tasks.length - 1 : 0,
              state.selectedIndex + 1,
            ),
          };
        }

        if (input === "k") {
          if (
            state.tasks.length > 0 &&
            state.selectedIndex < state.tasks.length
          ) {
            const selectedTask = state.tasks[state.selectedIndex];
            if (selectedTask.status === "running") {
              return {
                ...state,
                pendingEffect: { type: "STOP_TASK", taskId: selectedTask.id },
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
            detailTaskId: null,
            detailOutput: null,
          };
        }

        if (input === "k" && state.detailTaskId) {
          const task = state.tasks.find((t) => t.id === state.detailTaskId);
          if (task && task.status === "running") {
            return {
              ...state,
              pendingEffect: { type: "STOP_TASK", taskId: state.detailTaskId },
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
