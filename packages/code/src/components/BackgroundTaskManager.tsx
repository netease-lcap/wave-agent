import React, { useState, useEffect, useReducer } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "../contexts/useChat.js";
import { getLastLines } from "wave-agent-sdk";
import {
  taskManagerReducer,
  type TaskManagerState,
} from "../reducers/index.js";

interface Task {
  id: string;
  type: string;
  description?: string;
  status: "running" | "completed" | "failed" | "killed";
  startTime: number;
  exitCode?: number;
  runtime?: number;
  outputPath?: string;
}

const initialState: TaskManagerState = {
  selectedIndex: 0,
  viewMode: "list",
  detailTaskId: null,
  detailOutput: null,
};

export interface BackgroundTaskManagerProps {
  onCancel: () => void;
}

export const BackgroundTaskManager: React.FC<BackgroundTaskManagerProps> = ({
  onCancel,
}) => {
  const { backgroundTasks, getBackgroundTaskOutput, stopBackgroundTask } =
    useChat();
  const MAX_VISIBLE_ITEMS = 3;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [state, dispatch] = useReducer(taskManagerReducer, initialState);
  const { selectedIndex, viewMode, detailTaskId, detailOutput } = state;

  // Convert backgroundTasks to local Task format
  useEffect(() => {
    setTasks(
      backgroundTasks.map((task) => ({
        id: task.id,
        type: task.type,
        description: task.description,
        status: task.status,
        startTime: task.startTime,
        exitCode: task.exitCode,
        runtime: task.runtime,
        outputPath: task.outputPath,
      })),
    );
  }, [backgroundTasks]);

  // Load detail output for selected task
  useEffect(() => {
    if (viewMode === "detail" && detailTaskId) {
      const output = getBackgroundTaskOutput(detailTaskId);
      dispatch({ type: "SET_DETAIL_OUTPUT", output });
    }
  }, [viewMode, detailTaskId, getBackgroundTaskOutput]);

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

  const stopTask = (taskId: string) => {
    stopBackgroundTask(taskId);
  };

  // Calculate visible window
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, tasks.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleTasks = tasks.slice(startIndex, startIndex + MAX_VISIBLE_ITEMS);

  useInput((input, key) => {
    if (viewMode === "list") {
      // List mode navigation
      if (key.return) {
        if (tasks.length > 0 && selectedIndex < tasks.length) {
          const selectedTask = tasks[selectedIndex];
          dispatch({ type: "SELECT_TASK", taskId: selectedTask.id });
        }
        return;
      }

      if (key.escape) {
        onCancel();
        return;
      }

      if (key.upArrow) {
        dispatch({ type: "NAVIGATE_UP" });
        return;
      }

      if (key.downArrow) {
        dispatch({ type: "NAVIGATE_DOWN", max: tasks.length - 1 });
        return;
      }

      if (input === "k" && tasks.length > 0 && selectedIndex < tasks.length) {
        const selectedTask = tasks[selectedIndex];
        if (selectedTask.status === "running") {
          stopTask(selectedTask.id);
        }
        return;
      }
    } else if (viewMode === "detail") {
      // Detail mode navigation
      if (key.escape) {
        dispatch({ type: "GO_BACK_TO_LIST" });
        return;
      }

      if (input === "k" && detailTaskId) {
        const task = tasks.find((t) => t.id === detailTaskId);
        if (task && task.status === "running") {
          stopTask(detailTaskId);
        }
        return;
      }
    }
  });

  if (viewMode === "detail" && detailTaskId && detailOutput) {
    const task = tasks.find((t) => t.id === detailTaskId);
    if (!task) {
      dispatch({ type: "GO_BACK_TO_LIST" });
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
          <Box>
            <Text>
              <Text color="blue">Status:</Text> {task.status}
              {task.exitCode !== undefined && ` (exit code: ${task.exitCode})`}
            </Text>
          </Box>
          <Box>
            <Text>
              <Text color="blue">Started:</Text> {formatTime(task.startTime)}
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
        </Box>

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
              <Text color="red">{getLastLines(detailOutput.stderr, 10)}</Text>
            </Box>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            {task.status === "running" ? "k to stop · " : ""}Esc to go back
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
          return (
            <Box key={task.id} flexDirection="column">
              <Text
                color={isSelected ? "black" : "white"}
                backgroundColor={isSelected ? "cyan" : undefined}
              >
                {isSelected ? "▶ " : "  "}
                {actualIndex + 1}. [{task.id}] {task.type}
                {task.description ? `: ${task.description}` : ""}
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
