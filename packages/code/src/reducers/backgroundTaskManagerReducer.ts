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

export interface BackgroundTaskManagerState {
  tasks: Task[];
  selectedIndex: number;
  viewMode: "list" | "detail";
  detailTaskId: string | null;
  detailOutput: DetailOutput | null;
}

export type BackgroundTaskManagerAction =
  | { type: "SET_TASKS"; tasks: Task[] }
  | { type: "SELECT_INDEX"; index: number }
  | { type: "SET_VIEW_MODE"; mode: "list" | "detail" }
  | { type: "SET_DETAIL_TASK_ID"; id: string | null }
  | { type: "SET_DETAIL_OUTPUT"; output: DetailOutput | null }
  | { type: "RESET_DETAIL" };

export function backgroundTaskManagerReducer(
  state: BackgroundTaskManagerState,
  action: BackgroundTaskManagerAction,
): BackgroundTaskManagerState {
  switch (action.type) {
    case "SET_TASKS":
      return { ...state, tasks: action.tasks };
    case "SELECT_INDEX":
      return { ...state, selectedIndex: action.index };
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
    default:
      return state;
  }
}
