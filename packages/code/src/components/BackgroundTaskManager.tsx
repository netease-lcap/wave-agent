import React, { useEffect, useReducer, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "../contexts/useChat.js";
import { getLastLines } from "wave-agent-sdk";
import {
  backgroundTaskManagerReducer,
  type BackgroundTaskManagerState,
} from "../reducers/backgroundTaskManagerReducer.js";
import WorkflowRunDetail, {
  formatDuration,
  formatTime,
} from "./WorkflowRunDetail.js";
import WorkflowAgentDetail from "./WorkflowAgentDetail.js";
import { initialWorkflowAgentView } from "../reducers/workflowAgentView.js";
import {
  sortBackgroundTasks,
  taskGroupLabel,
} from "../utils/backgroundTaskGroups.js";

/**
 * A shell task's command on one line for the list row. Multi-line commands are
 * folded so a heredoc cannot push the row (and its selection marker) apart; the
 * full text lives in the detail view's `Command:` line, which the terminal wraps.
 *
 * The row used to show `description` only, and shell tasks carry `command`
 * rather than `description` — so `/tasks` showed no command line at all, in a
 * bash session just as in a PowerShell one (the webview panes show
 * `$ {command}`; this is the CLI side of the same field).
 */
const COMMAND_ROW_MAX_CHARS = 60;
const foldCommand = (command: string): string =>
  command.replace(/\s+/g, " ").trim();
const oneLineCommand = (command: string): string => {
  const folded = foldCommand(command);
  return folded.length > COMMAND_ROW_MAX_CHARS
    ? folded.slice(0, COMMAND_ROW_MAX_CHARS - 1) + "…"
    : folded;
};

export interface BackgroundTaskManagerProps {
  onCancel: () => void;
}

/** Inline save dialog state, opened from a workflow task's detail view (spec
 * workflow「把脚本存进库并按名字复用」场景 2). Moved here with the merged
 * panel: the standalone workflow panel was the only place with this action. */
interface SaveDialogState {
  name: string;
  scope: "project" | "user";
  /** Set on a conflict so the next Enter overwrites instead of failing again. */
  overwrite: boolean;
  error?: string;
}

export const BackgroundTaskManager: React.FC<BackgroundTaskManagerProps> = ({
  onCancel,
}) => {
  const {
    backgroundTasks,
    workflowRuns,
    getBackgroundTaskOutput,
    stopBackgroundTask,
    saveWorkflowScript,
  } = useChat();
  const MAX_VISIBLE_ITEMS = 3;

  const [state, dispatch] = useReducer(backgroundTaskManagerReducer, {
    tasks: [],
    selectedIndex: 0,
    viewMode: "list",
    detailTaskId: null,
    detailOutput: null,
    agentView: initialWorkflowAgentView,
    pendingEffect: null,
  } as BackgroundTaskManagerState);
  const [saveDialog, setSaveDialog] = useState<SaveDialogState | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Handle pending effects
  useEffect(() => {
    if (!state.pendingEffect) return;

    const effect = state.pendingEffect;
    dispatch({ type: "CLEAR_PENDING_EFFECT" });

    switch (effect.type) {
      case "CANCEL":
        onCancel();
        break;
      case "STOP_TASK":
        stopBackgroundTask(effect.taskId);
        break;
    }
  }, [state.pendingEffect, onCancel, stopBackgroundTask]);

  const {
    tasks,
    selectedIndex,
    viewMode,
    detailTaskId,
    detailOutput,
    agentView,
  } = state;

  // The open workflow run, when the selected task is a workflow: the panel is
  // the only place that joins a task id onto the run list (a workflow task's id
  // IS its run id), so the agent keys are dispatched with its agent count.
  const openWorkflowRun =
    viewMode === "detail" && detailTaskId
      ? tasks.find((t) => t.id === detailTaskId)?.type === "workflow"
        ? (workflowRuns.find((r) => r.runId === detailTaskId) ?? null)
        : null
      : null;

  // Workflow runs keyed by task id for the list rows: the run carries the
  // 「运行过大」 flag the deleted workflow panel used to show (spec workflow
  // 「工作流管理入口」场景 6 把它迁到了这里)。
  const runByTaskId = new Map(workflowRuns.map((r) => [r.runId, r]));

  // Convert backgroundTasks to local Task format. 顺序在这里就排好：列表按任务
  // 类型分组、组内运行中在前，而选中是按下标走的，顺序和下标必须一致。
  useEffect(() => {
    dispatch({
      type: "SET_TASKS",
      tasks: sortBackgroundTasks(
        backgroundTasks.map((task) => ({
          id: task.id,
          type: task.type,
          command: task.command,
          description: task.description,
          status: task.status,
          startTime: task.startTime,
          exitCode: task.exitCode,
          runtime: task.runtime,
          outputPath: task.outputPath,
        })),
      ),
    });
  }, [backgroundTasks]);

  // Load detail output for selected task
  useEffect(() => {
    if (viewMode === "detail" && detailTaskId) {
      const output = getBackgroundTaskOutput(detailTaskId);
      dispatch({ type: "SET_DETAIL_OUTPUT", output });
    }
  }, [viewMode, detailTaskId, getBackgroundTaskOutput]);

  // Calculate visible window
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, tasks.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleTasks = tasks.slice(startIndex, startIndex + MAX_VISIBLE_ITEMS);

  const submitSave = async () => {
    if (!saveDialog || !openWorkflowRun) return;
    try {
      const saved = await saveWorkflowScript(openWorkflowRun.runId, {
        name: saveDialog.name,
        scope: saveDialog.scope,
        overwrite: saveDialog.overwrite,
      });
      setSaveDialog(null);
      setSaveNotice(`Saved "${saved.name}" to ${saved.path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveDialog((current) =>
        current
          ? {
              ...current,
              error: message,
              // A name conflict is the one failure the user can resolve right
              // here: the next Enter overwrites (spec 场景 4).
              overwrite: message.includes("already exists")
                ? true
                : current.overwrite,
            }
          : current,
      );
    }
  };

  useInput((input, key) => {
    // The save dialog owns the keyboard while it is open, so typing a name
    // never triggers the list/detail shortcuts underneath.
    if (saveDialog) {
      if (key.escape) {
        setSaveDialog(null);
        return;
      }
      if (key.tab) {
        setSaveDialog((current) =>
          current
            ? {
                ...current,
                scope: current.scope === "project" ? "user" : "project",
                error: undefined,
              }
            : current,
        );
        return;
      }
      if (key.return) {
        void submitSave();
        return;
      }
      if (key.backspace || key.delete) {
        setSaveDialog((current) =>
          current
            ? {
                ...current,
                name: current.name.slice(0, -1),
                error: undefined,
              }
            : current,
        );
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSaveDialog((current) =>
          current
            ? { ...current, name: current.name + input, error: undefined }
            : current,
        );
      }
      return;
    }

    // `s` only exists where a workflow run backs the selected task: the script
    // library entry point lives in CLI only (spec workflow 边界情况「保存入口
    // 只在 CLI」)。
    if (openWorkflowRun && input === "s") {
      setSaveNotice(null);
      setSaveDialog({
        name: openWorkflowRun.meta.name,
        scope: "project",
        overwrite: false,
      });
      return;
    }

    dispatch({
      type: "HANDLE_KEY",
      input,
      key,
      workflowAgentCount: openWorkflowRun?.agents?.length ?? 0,
    });
  });

  if (viewMode === "detail" && detailTaskId && detailOutput) {
    const task = tasks.find((t) => t.id === detailTaskId);
    if (!task) {
      dispatch({ type: "RESET_DETAIL" });
      return null;
    }

    // A workflow background task's id IS its run id, so a workflow task can show
    // real progress instead of the (always empty) text output, through the same
    // component the webview uses. Absent run (e.g. the session was cleared) falls
    // back to the plain task detail below.
    const selectedRun = openWorkflowRun;

    // The agent card replaces the run detail (spec「查看单个 agent 的执行详情」
    // 场景 2).
    const openAgent =
      selectedRun && agentView.openIndex !== null
        ? ((selectedRun.agents ?? [])[agentView.openIndex] ?? null)
        : null;

    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingTop={1}
        gap={1}
      >
        <Box>
          <Text color="cyan" bold>
            Background Task Details: {task.id}
          </Text>
        </Box>

        <Box flexDirection="column" gap={1}>
          <Box>
            <Text>
              <Text color="blue">Type:</Text> {task.type}
            </Text>
          </Box>
          {task.description && (
            <Box>
              <Text>
                <Text color="blue">Description:</Text> {task.description}
              </Text>
            </Box>
          )}
          {task.command && (
            <Box>
              <Text>
                <Text color="blue">Command:</Text> $ {foldCommand(task.command)}
              </Text>
            </Box>
          )}
          {/* With the run block below, the task's own status and start time
              would repeat it — the run is the authority on how far the
              workflow got. The header keeps only what identifies the task. */}
          {!selectedRun && (
            <>
              <Box>
                <Text>
                  <Text color="blue">Status:</Text> {task.status}
                  {task.exitCode !== undefined &&
                    ` (exit code: ${task.exitCode})`}
                </Text>
              </Box>
              <Box>
                <Text>
                  <Text color="blue">Started:</Text>{" "}
                  {formatTime(task.startTime)}
                  {task.runtime !== undefined && (
                    <Text>
                      {" "}
                      | <Text color="blue">Runtime:</Text>{" "}
                      {formatDuration(task.runtime)}
                    </Text>
                  )}
                </Text>
              </Box>
              {task.outputPath && (
                <Box>
                  <Text>
                    <Text color="blue">Log File:</Text> {task.outputPath}
                  </Text>
                </Box>
              )}
            </>
          )}
        </Box>

        {openAgent && selectedRun ? (
          <WorkflowAgentDetail runId={selectedRun.runId} agent={openAgent} />
        ) : selectedRun ? (
          <WorkflowRunDetail
            run={selectedRun}
            agentSelectionIndex={
              (selectedRun.agents ?? []).length > 0
                ? agentView.selectedIndex
                : undefined
            }
          />
        ) : (
          <>
            {detailOutput.stdout && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="green" bold>
                  OUTPUT (last 10 lines):
                </Text>
                <Box borderStyle="single" borderColor="green" padding={1}>
                  <Text>{getLastLines(detailOutput.stdout, 10)}</Text>
                </Box>
              </Box>
            )}

            {detailOutput.stderr && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="red" bold>
                  ERRORS:
                </Text>
                <Box borderStyle="single" borderColor="red" padding={1}>
                  <Text color="red">
                    {getLastLines(detailOutput.stderr, 10)}
                  </Text>
                </Box>
              </Box>
            )}
          </>
        )}

        {saveDialog && (
          <Box flexDirection="column">
            <Text color="cyan">Save dynamic workflow</Text>
            <Text>
              Name: {saveDialog.name}
              <Text color="cyan">▏</Text>
            </Text>
            <Text dimColor>Scope: {saveDialog.scope} · Tab to switch</Text>
            {saveDialog.error && <Text color="red">{saveDialog.error}</Text>}
          </Box>
        )}

        {saveNotice && <Text color="green">{saveNotice}</Text>}

        <Box marginTop={1}>
          <Text dimColor>
            {saveDialog
              ? "Enter save · Tab scope · Esc cancel"
              : openAgent
                ? "Esc back to run detail"
                : `${selectedRun && (selectedRun.agents ?? []).length > 0 ? "↑/↓ agent · Enter agent detail · " : ""}${task.status === "running" ? "k to stop · " : ""}${selectedRun ? "s save script · " : ""}Esc to go back`}
          </Text>
        </Box>
      </Box>
    );
  }

  if (!backgroundTasks) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingTop={1}
      >
        <Text color="cyan" bold>
          Background Tasks
        </Text>
        <Text>Background tasks not available</Text>
        <Text dimColor>Press Escape to close</Text>
      </Box>
    );
  }

  if (tasks.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingTop={1}
      >
        <Text color="cyan" bold>
          Background Tasks
        </Text>
        <Text>No background tasks found</Text>
        <Text dimColor>Press Escape to close</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={1}
      gap={1}
    >
      <Box>
        <Text color="cyan" bold>
          Background Tasks
        </Text>
      </Box>
      <Text dimColor>Select a task to view details</Text>

      <Box flexDirection="column">
        {visibleTasks.map((task, index) => {
          const actualIndex = startIndex + index;
          const isSelected = actualIndex === selectedIndex;
          // The run is only present for workflow tasks (id == runId); its
          // size flag is the 「运行过大」 marker the deleted workflow panel
          // showed on its rows (spec workflow「工作流管理入口」场景 6).
          const run =
            task.type === "workflow" ? runByTaskId.get(task.id) : null;
          // 组标题只打在这一组的第一个任务上：窗口滑动后首项可能落在某组中间，
          // 那时它上面被切掉的行本来就属于同一组，不必再打一次。
          const previousTask = actualIndex > 0 ? tasks[actualIndex - 1] : null;
          const groupLabel =
            previousTask?.type === task.type ? null : taskGroupLabel(task.type);
          return (
            <Box key={task.id} flexDirection="column">
              {groupLabel && (
                <Text dimColor>
                  <Text bold>{`  ${groupLabel}`}</Text> (
                  {tasks.filter((t) => t.type === task.type).length})
                </Text>
              )}
              <Text
                color={isSelected ? "black" : "white"}
                backgroundColor={isSelected ? "cyan" : undefined}
              >
                {isSelected ? "▶ " : "  "}
                {actualIndex + 1}. [{task.id}] {task.type}
                {task.description
                  ? `: ${task.description}`
                  : task.command
                    ? `: $ ${oneLineCommand(task.command)}`
                    : ""}
                <Text
                  color={
                    task.status === "running"
                      ? "green"
                      : task.status === "completed"
                        ? "blue"
                        : "red"
                  }
                >
                  {" "}
                  ({task.status})
                </Text>
                {run?.sizeWarning && <Text color="yellow"> ⚠ Large</Text>}
              </Text>
              {isSelected && (
                <Box marginLeft={4} flexDirection="column">
                  <Text color="gray" dimColor>
                    {task.outputPath ? (
                      <Text>
                        <Text color="blue">Log File:</Text> {task.outputPath}
                      </Text>
                    ) : (
                      `Started: ${formatTime(task.startTime)}`
                    )}
                    {task.runtime !== undefined &&
                      ` | Runtime: ${formatDuration(task.runtime)}`}
                    {task.exitCode !== undefined && ` | Exit: ${task.exitCode}`}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ to select · Enter to view ·{" "}
          {tasks[selectedIndex]?.status === "running" ? "k to stop · " : ""}Esc
          to close
        </Text>
      </Box>
    </Box>
  );
};
