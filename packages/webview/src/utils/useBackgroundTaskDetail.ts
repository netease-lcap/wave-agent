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
}: UseBackgroundTaskDetailOptions): BackgroundTaskDetailState {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [output, setOutput] = useState<BackgroundTaskOutput | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  // The (taskId, status) we last requested output for. The refetch below is
  // keyed on this rather than on `output === null`: the host always answers
  // with an output object (stdout may be an empty string), so a task first
  // inspected while running kept its empty reply forever after finishing.
  const lastOutputRequestRef = useRef<{
    taskId: string;
    status: string;
  } | null>(null);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;

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
      setOutput(null);
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
    setLoadingOutput(true);
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
          setOutput(message.output || null);
          setLoadingOutput(false);
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
    setSelectedTaskId(taskId);
  }, []);

  const backToList = useCallback(() => {
    setSelectedTaskId(null);
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
