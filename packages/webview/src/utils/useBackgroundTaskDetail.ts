/**
 * Shared state machine behind both surfaces that show background tasks: the
 * centered dialog (VS Code / JetBrains / remote web — hosts without a right
 * panel) and the desktop right-panel tab (spec
 * `desktop/desktop-right-panel.md`「后台任务面板」). Both need the same
 * selection / output-polling / stop semantics, so they must not drift:
 *
 * - output is fetched once per (taskId, status) — the host always answers with
 *   an output object, so keying the refetch on `output === null` would leave a
 *   task first inspected while running stuck on its empty first reply;
 * - while the selected task runs, the output is re-read on a fixed cadence
 *   (the effect above only fires on transitions, live progress would freeze);
 * - a workflow task is the exception: its progress is pushed by the host
 *   through `updateWorkflowRuns`, so polling its (empty) output adds nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { BackgroundTaskSummary, SerializableWorkflowRun } from "../types";
import { useHostMessage } from "./useHostMessage";

export interface BackgroundTaskOutput {
  stdout: string;
  stderr: string;
  status: string;
  outputPath?: string;
  type: string;
  exitCode?: number;
}

/**
 * Poll cadence for the selected task's output while it is still running and
 * the detail view is open. The SDK answers with the task's log-file tail for
 * running agent tasks, so this is what makes live progress visible.
 */
export const BACKGROUND_TASK_OUTPUT_POLL_MS = 1500;

export const getLastLines = (text: string, count: number): string => {
  if (!text) return "";
  const lines = text.split("\n");
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
};

export interface UseBackgroundTaskDetailOptions {
  tasks: BackgroundTaskSummary[];
  workflowRuns: SerializableWorkflowRun[];
  vscode: { postMessage: (msg: unknown) => void };
  /**
   * Open straight into this task's detail — the transcript's tool row (or the
   * Workflow row) knows which task the user means, so the surface does not have
   * to make them find it again in the list (spec
   * `multi-agent/task-background-execution.md`「从工具行进入后台任务详情」).
   *
   * Identity is the request: a NEW object selects again even when it names the
   * task already on screen, which is what makes clicking the same row twice
   * work. An id that is no longer in `tasks` falls through to the list (the
   * detail view renders only when the task resolves), never an empty pane.
   */
  focus?: { taskId: string } | null;
  /** Called once the focus request has been applied, so the owner can drop it —
   *  a re-mounted surface (session switch) must land on the list again. */
  onFocusConsumed?: () => void;
}

export interface BackgroundTaskDetailState {
  selectedTaskId: string | null;
  selectedTask: BackgroundTaskSummary | null;
  /** The workflow run behind the selected task, when it is a workflow task. */
  selectedWorkflowRun: SerializableWorkflowRun | null;
  output: BackgroundTaskOutput | null;
  loadingOutput: boolean;
  stoppingId: string | null;
  selectTask: (taskId: string) => void;
  backToList: () => void;
  handleStop: (taskId: string) => void;
}

export function useBackgroundTaskDetail({
  tasks,
  workflowRuns,
  vscode,
  focus,
  onFocusConsumed,
}: UseBackgroundTaskDetailOptions): BackgroundTaskDetailState {
  // 当前选中 = 任务 id + 「它是被哪个 focus 请求落下来的」（`from`）。带着
  // `from` 就能在 render 期采纳新到的 focus 请求（见下面那段调整）：owner 在
  // `onFocusConsumed` 里把 focus 丢掉之后，选中不会跟着回退成列表。用户自己
  // 点出来的选中沿用同一个 `from`，所以同一次请求不会被重复采纳。
  const [selection, setSelection] = useState<{
    id: string | null;
    from: { taskId: string } | null;
  }>({ id: null, from: null });
  // 输出只记「哪条任务、哪个状态」的那一次回执；渲染期按当前选中派生成
  // `output` / `loadingOutput`（换任务、状态变了要不要重取，全从这次比较里
  // 出来），不必在 effect 里先清空再置 loading。
  const [outputReply, setOutputReply] = useState<{
    taskId: string;
    status: string;
    output: BackgroundTaskOutput | null;
  } | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  // The (taskId, status) we last requested output for. The refetch below is
  // keyed on this rather than on `output === null`: the host always answers
  // with an output object (stdout may be an empty string), so a task first
  // inspected while running kept its empty reply forever after finishing.
  const lastOutputRequestRef = useRef<{
    taskId: string;
    status: string;
  } | null>(null);

  const selectedTaskId = selection.id;
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const output =
    selectedTaskId && outputReply?.taskId === selectedTaskId
      ? outputReply.output
      : null;
  // 命中「这条任务 + 这个状态」的回执之前都算加载中：与原实现的
  // `setLoadingOutput(true)`（发请求时）/ `false`（回执到达时）一一对应。
  const loadingOutput =
    !!selectedTask &&
    !(
      outputReply &&
      outputReply.taskId === selectedTaskId &&
      outputReply.status === selectedTask.status
    );

  // Apply an incoming focus request once per request object. `onFocusConsumed`
  // is held in a ref so a parent that passes a fresh inline callback each
  // render cannot re-run the effect and undo the user's "back to list".
  const onFocusConsumedRef = useRef(onFocusConsumed);
  onFocusConsumedRef.current = onFocusConsumed;
  // 新到的 focus 请求在 render 期就落成本地选中（React 的「props 变了就调整
  // 自己的 state」，比 effect 早一帧）；「同一个请求只采纳一次」由 `from` 记着，
  // 而 `onFocusConsumed` 是给 owner 的副作用，仍旧留在 effect 里。
  if (focus && selection.from !== focus) {
    setSelection({ id: focus.taskId, from: focus });
  }
  useEffect(() => {
    if (!focus) return;
    onFocusConsumedRef.current?.();
  }, [focus]);

  /**
   * The run behind the selected task, when the selected task IS a workflow: a
   * workflow background task's id is its runId, so the two slices of chat state
   * join on it directly. A workflow has no text tail to show — the SDK never
   * points the task at an output file and its own progress is what it reports —
   * so the run's structured progress (phases, agents, tokens, `log()` lines) is
   * rendered in place of the output box. Both surfaces render it through the
   * same component, which is what stops `/tasks` from disagreeing with itself.
   *
   * `null` (the run is gone from the session's list — `/clear`, a resumed
   * session) falls back to the text output box rather than an empty pane.
   */
  const selectedWorkflowRun =
    selectedTask?.type === "workflow"
      ? (workflowRuns.find((r) => r.runId === selectedTask.id) ?? null)
      : null;

  // Fetch output for the selected task, and refetch whenever its status
  // changes (running → completed/failed/killed) so the terminal output is not
  // missed by a detail view opened while the task was still running.
  useEffect(() => {
    if (!selectedTaskId) {
      lastOutputRequestRef.current = null;
      return;
    }
    if (!selectedTask) {
      return;
    }
    const last = lastOutputRequestRef.current;
    if (
      last &&
      last.taskId === selectedTaskId &&
      last.status === selectedTask.status
    ) {
      return;
    }
    lastOutputRequestRef.current = {
      taskId: selectedTaskId,
      status: selectedTask.status,
    };
    vscode.postMessage({
      command: "getBackgroundTaskOutput",
      taskId: selectedTaskId,
    });
  }, [selectedTask, selectedTaskId, vscode]);

  // While the selected task is running, keep re-reading its output on a fixed
  // cadence. Stops on terminal status, task switch and unmount.
  const selectedTaskRunning =
    selectedTask?.status === "running" && !selectedWorkflowRun;
  useEffect(() => {
    if (!selectedTaskId || !selectedTaskRunning) {
      return;
    }
    const timer = setInterval(() => {
      vscode.postMessage({
        command: "getBackgroundTaskOutput",
        taskId: selectedTaskId,
      });
    }, BACKGROUND_TASK_OUTPUT_POLL_MS);
    return () => clearInterval(timer);
  }, [selectedTaskId, selectedTaskRunning, vscode]);

  useHostMessage((message) => {
    switch (message.command) {
      case "backgroundTaskOutput":
        if (message.taskId === selectedTaskId) {
          setOutputReply({
            taskId: message.taskId,
            // 回执对应的那份任务状态：上面对「回执是否已经过期」的比较就用它。
            status: selectedTask?.status ?? "",
            output: message.output || null,
          });
        }
        break;
      case "backgroundTaskStopped":
        setStoppingId(null);
        break;
    }
  });

  const handleStop = useCallback(
    (taskId: string) => {
      setStoppingId(taskId);
      vscode.postMessage({ command: "stopBackgroundTask", taskId });
    },
    [vscode],
  );

  const selectTask = useCallback((taskId: string) => {
    setSelection((prev) => ({ id: taskId, from: prev.from }));
  }, []);

  const backToList = useCallback(() => {
    setSelection((prev) => ({ id: null, from: prev.from }));
    // 回到列表就丢掉详情输出（原来是 effect 的清理分支；现在这是个用户动作，
    // 顺手在事件里清，重新进同一条任务时不会先闪一眼上一次的输出）。
    setOutputReply(null);
  }, []);

  return {
    selectedTaskId,
    selectedTask,
    selectedWorkflowRun,
    output,
    loadingOutput,
    stoppingId,
    selectTask,
    backToList,
    handleStop,
  };
}
