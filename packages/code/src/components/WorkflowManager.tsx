import React, { useEffect, useReducer } from "react";
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

export const WorkflowManager: React.FC<WorkflowManagerProps> = ({
  onCancel,
}) => {
  const { workflowRuns, stopWorkflowRun } = useChat();
  const MAX_VISIBLE_ITEMS = 3;

  const [state, dispatch] = useReducer(workflowManagerReducer, {
    runs: [],
    selectedIndex: 0,
    viewMode: "list",
    detailRunId: null,
    pendingEffect: null,
  } as WorkflowManagerState);

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

  useInput((input, key) => {
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

        <Box marginTop={1}>
          <Text dimColor>
            {run.status === "running" ? "k to stop · " : ""}Esc back
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
