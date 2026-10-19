import React, { useEffect, useReducer, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "../contexts/useChat.js";
import {
  workflowManagerReducer,
  type WorkflowManagerState,
} from "../reducers/workflowManagerReducer.js";
import WorkflowRunDetail, {
  formatDuration,
  formatTokens,
  workflowStatusColor,
} from "./WorkflowRunDetail.js";

export interface WorkflowManagerProps {
  onCancel: () => void;
}

/** Inline save dialog state, opened from a run's detail view (spec workflow「把
 * 脚本存进库并按名字复用」场景 2). */
interface SaveDialogState {
  name: string;
  scope: "project" | "user";
  /** Set on a conflict so the next Enter overwrites instead of failing again. */
  overwrite: boolean;
  error?: string;
}

export const WorkflowManager: React.FC<WorkflowManagerProps> = ({
  onCancel,
}) => {
  const { workflowRuns, stopWorkflowRun, saveWorkflowScript } = useChat();
  const MAX_VISIBLE_ITEMS = 3;

  const [state, dispatch] = useReducer(workflowManagerReducer, {
    runs: [],
    selectedIndex: 0,
    viewMode: "list",
    detailRunId: null,
    pendingEffect: null,
  } as WorkflowManagerState);
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
      case "STOP_RUN":
        stopWorkflowRun(effect.runId);
        break;
    }
  }, [state.pendingEffect, onCancel, stopWorkflowRun]);

  const { runs, selectedIndex, viewMode, detailRunId } = state;

  // Sync workflowRuns from context
  useEffect(() => {
    dispatch({ type: "SET_RUNS", runs: workflowRuns });
  }, [workflowRuns]);

  const submitSave = async () => {
    if (!saveDialog || !state.detailRunId) return;
    try {
      const saved = await saveWorkflowScript(state.detailRunId, {
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

    if (state.viewMode === "detail" && state.detailRunId && input === "s") {
      const run = state.runs.find((r) => r.runId === state.detailRunId);
      if (run) {
        setSaveNotice(null);
        setSaveDialog({
          name: run.meta.name,
          scope: "project",
          overwrite: false,
        });
      }
      return;
    }

    dispatch({ type: "HANDLE_KEY", input, key });
  });

  // Detail view
  if (viewMode === "detail" && detailRunId) {
    const run = runs.find((r) => r.runId === detailRunId);
    if (!run) {
      dispatch({ type: "RESET_DETAIL" });
      return null;
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
            Workflow Details: {run.meta.name}
          </Text>
        </Box>

        <WorkflowRunDetail run={run} />

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
              : `${run.status === "running" ? "k to stop · " : ""}s save script · Esc back`}
          </Text>
        </Box>
      </Box>
    );
  }

  // Empty state
  if (runs.length === 0) {
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
          Workflows
        </Text>
        <Text>No workflow runs found</Text>
        <Text dimColor>Press Escape to close</Text>
      </Box>
    );
  }

  // List view
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, runs.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleRuns = runs.slice(startIndex, startIndex + MAX_VISIBLE_ITEMS);

  // Header counts of the states a user acts on (a failed run is plain to see in
  // its own row, so it needs no tally).
  const runningCount = runs.filter((r) => r.status === "running").length;
  const completedCount = runs.filter((r) => r.status === "completed").length;
  const subtitle = [
    runningCount > 0 ? `${runningCount} running` : "",
    completedCount > 0 ? `${completedCount} completed` : "",
  ]
    .filter(Boolean)
    .join(" · ");

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
          Workflows
        </Text>
        {subtitle && <Text dimColor> {subtitle}</Text>}
      </Box>
      <Text dimColor>Select a run to view details</Text>

      <Box flexDirection="column">
        {visibleRuns.map((run, index) => {
          const actualIndex = startIndex + index;
          const isSelected = actualIndex === selectedIndex;
          const elapsed = run.endTime
            ? run.endTime - run.startTime
            : Date.now() - run.startTime;
          // Duration always reads; the two counters are dropped at zero so an
          // unstarted run does not claim "0 agents · 0 tokens".
          const meta = [
            formatDuration(elapsed),
            run.totalAgents > 0 ? `${run.totalAgents} agents` : "",
            run.totalTokens > 0
              ? `${formatTokens(run.totalTokens)} tokens`
              : "",
          ].filter(Boolean);

          return (
            <Box key={run.runId} flexDirection="column">
              <Text
                color={isSelected ? "black" : "white"}
                backgroundColor={isSelected ? "cyan" : undefined}
              >
                {isSelected ? "▶ " : "  "}
                {actualIndex + 1}. {run.meta.name || run.meta.description}
                <Text color={workflowStatusColor(run.status)}>
                  {" "}
                  ({run.status})
                </Text>
                {/* Oversized marker: the row is where a run is picked, so the
                    "too big to leave running" signal belongs on it (spec
                    「预算与规模硬上限」场景 7). The counts are on the meta line
                    right below, and the stop key is in the footer. */}
                {run.sizeWarning && <Text color="yellow"> ⚠ Large</Text>}
              </Text>
              <Text
                color={isSelected ? "black" : "gray"}
                backgroundColor={isSelected ? "cyan" : undefined}
              >
                {"     "}
                {meta.join(" · ")}
              </Text>
              {isSelected && (
                <Box marginLeft={4} flexDirection="column">
                  <Text color="gray" dimColor>
                    <Text color="blue">Script:</Text> {run.scriptPath}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ select · Enter detail ·{" "}
          {runs[selectedIndex]?.status === "running" ? "k stop · " : ""}Esc
          close
        </Text>
      </Box>
    </Box>
  );
};
