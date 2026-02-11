import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "../contexts/useChat.js";

interface Task {
  id: string;
  type: string;
  description?: string;
  status: "running" | "completed" | "failed" | "killed";
  startTime: number;
  exitCode?: number;
  runtime?: number;
}

export interface BackgroundTaskManagerProps {
  onCancel: () => void;
}

export const BackgroundTaskManager: React.FC<BackgroundTaskManagerProps> = ({
  onCancel,
}) => {
  const { backgroundTasks, getBackgroundTaskOutput, stopBackgroundTask } =
    useChat();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"list" | "detail">("list");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailOutput, setDetailOutput] = useState<{
    stdout: string;
    stderr: string;
    status: string;
  } | null>(null);

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
      })),
    );
  }, [backgroundTasks]);

  // Load detail output for selected task
  useEffect(() => {
    if (viewMode === "detail" && detailTaskId) {
      const output = getBackgroundTaskOutput(detailTaskId);
      setDetailOutput(output);
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

  useInput((input, key) => {
    if (viewMode === "list") {
      // List mode navigation
      if (key.return) {
        if (tasks.length > 0 && selectedIndex < tasks.length) {
          const selectedTask = tasks[selectedIndex];
          setDetailTaskId(selectedTask.id);
          setViewMode("detail");
        }
        return;
      }

      if (key.escape) {
        onCancel();
        return;
      }

      if (key.upArrow) {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex(Math.min(tasks.length - 1, selectedIndex + 1));
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
        setViewMode("list");
        setDetailTaskId(null);
        setDetailOutput(null);
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
      setViewMode("list");
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
        </Box>

        {detailOutput.stdout && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="green" bold>
              OUTPUT (last 10 lines):
            </Text>
            <Box borderStyle="single" borderColor="green" padding={1}>
              <Text>
                {detailOutput.stdout.split("\n").slice(-10).join("\n")}
              </Text>
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
                {detailOutput.stderr.split("\n").slice(-10).join("\n")}
              </Text>
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

      {tasks.map((task, index) => (
        <Box key={task.id} flexDirection="column">
          <Text
            color={index === selectedIndex ? "black" : "white"}
            backgroundColor={index === selectedIndex ? "cyan" : undefined}
          >
            {index === selectedIndex ? "▶ " : "  "}
            {index + 1}. [{task.id}] {task.type}
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
          {index === selectedIndex && (
            <Box marginLeft={4} flexDirection="column">
              <Text color="gray" dimColor>
                Started: {formatTime(task.startTime)}
                {task.runtime !== undefined &&
                  ` | Runtime: ${formatDuration(task.runtime)}`}
                {task.exitCode !== undefined && ` | Exit: ${task.exitCode}`}
              </Text>
            </Box>
          )}
        </Box>
      ))}

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
