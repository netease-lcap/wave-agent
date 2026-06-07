import React, { useEffect, useReducer } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "../contexts/useChat.js";
import type { WorkflowRun } from "wave-agent-sdk";
import {
  workflowManagerReducer,
  type WorkflowManagerState,
} from "../reducers/workflowManagerReducer.js";

export interface WorkflowManagerProps {
  onCancel: () => void;
}

const statusColor = (
  status: WorkflowRun["status"],
): "green" | "blue" | "red" | "yellow" => {
  switch (status) {
    case "running":
      return "green";
    case "completed":
      return "blue";
    case "failed":
    case "aborted":
      return "red";
    case "paused":
      return "yellow";
  }
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString();
};

const formatTokens = (tokens: number): string => {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
};

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

    const elapsed = run.endTime
      ? run.endTime - run.startTime
      : Date.now() - run.startTime;

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

        <Box flexDirection="column" gap={0}>
          <Box>
            <Text>
              <Text color="blue">Run ID:</Text> {run.runId}
            </Text>
          </Box>
          {run.meta.description && (
            <Box>
              <Text>
                <Text color="blue">Description:</Text> {run.meta.description}
              </Text>
            </Box>
          )}
          <Box>
            <Text>
              <Text color="blue">Status:</Text>{" "}
              <Text color={statusColor(run.status)}>{run.status}</Text>
            </Text>
          </Box>
          <Box>
            <Text>
              <Text color="blue">Started:</Text> {formatTime(run.startTime)}
              {run.endTime && (
                <Text>
                  {" "}
                  | <Text color="blue">Ended:</Text> {formatTime(run.endTime)}
                </Text>
              )}
              {" | "}
              <Text color="blue">Duration:</Text> {formatDuration(elapsed)}
            </Text>
          </Box>
          <Box>
            <Text>
              <Text color="blue">Agents:</Text> {run.totalAgents} {" | "}
              <Text color="blue">Tokens:</Text> {formatTokens(run.totalTokens)}
            </Text>
          </Box>
          <Box>
            <Text>
              <Text color="blue">Script:</Text> {run.scriptPath}
            </Text>
          </Box>
          {run.error && (
            <Box>
              <Text color="red">
                <Text color="blue">Error:</Text> {run.error}
              </Text>
            </Box>
          )}
        </Box>

        {run.phases.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="cyan" bold>
              Phases:
            </Text>
            {run.phases.map((phase, i) => (
              <Box key={i} marginLeft={2}>
                <Text>
                  <Text color="blue">{phase.title}</Text>
                  {" — "}
                  {phase.agentCount} agents | {formatTokens(phase.tokens)}{" "}
                  tokens | {formatDuration(phase.elapsed)}
                </Text>
              </Box>
            ))}
          </Box>
        )}

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
      </Box>
      <Text dimColor>Select a run to view details</Text>

      <Box flexDirection="column">
        {visibleRuns.map((run, index) => {
          const actualIndex = startIndex + index;
          const isSelected = actualIndex === selectedIndex;
          const elapsed = run.endTime
            ? run.endTime - run.startTime
            : Date.now() - run.startTime;
          const phaseText = run.phases.map((p) => p.title).join(" → ");

          return (
            <Box key={run.runId} flexDirection="column">
              <Text
                color={isSelected ? "black" : "white"}
                backgroundColor={isSelected ? "cyan" : undefined}
              >
                {isSelected ? "▶ " : "  "}
                {actualIndex + 1}. {run.runId.slice(0, 8)} {run.meta.name}
                <Text color={statusColor(run.status)}> ({run.status})</Text>
              </Text>
              <Text
                color={isSelected ? "black" : "gray"}
                backgroundColor={isSelected ? "cyan" : undefined}
              >
                {"     "}
                {run.totalAgents} agents · {formatTokens(run.totalTokens)}{" "}
                tokens · {formatDuration(elapsed)}
              </Text>
              {phaseText && (
                <Text
                  color={isSelected ? "black" : "gray"}
                  backgroundColor={isSelected ? "cyan" : undefined}
                >
                  {"     "}
                  {run.phases.map((p, pi) => (
                    <React.Fragment key={pi}>
                      {pi > 0 && " → "}
                      <Text
                        color={
                          isSelected
                            ? "black"
                            : pi === run.phases.length - 1 &&
                                run.status === "running"
                              ? "green"
                              : undefined
                        }
                        backgroundColor={isSelected ? "cyan" : undefined}
                      >
                        {p.title}
                      </Text>
                    </React.Fragment>
                  ))}
                </Text>
              )}
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
