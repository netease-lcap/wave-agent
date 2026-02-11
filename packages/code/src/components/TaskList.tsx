import React from "react";
import { Box, Text, useStdout } from "ink";
import { useTasks } from "../hooks/useTasks.js";

export const TaskList: React.FC = () => {
  const tasks = useTasks();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const maxSubjectWidth = Math.max(20, terminalWidth - 10);

  if (tasks.length === 0) {
    return null;
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <Text color="gray">○</Text>;
      case "in_progress":
        return <Text color="yellow">●</Text>;
      case "completed":
        return <Text color="green">✓</Text>;
      case "deleted":
        return <Text color="red">✕</Text>;
      default:
        return <Text color="gray">?</Text>;
    }
  };

  const truncate = (text: string, maxWidth: number) => {
    if (text.length <= maxWidth) {
      return text;
    }
    return text.slice(0, maxWidth - 3) + "...";
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          TASKS
        </Text>
      </Box>
      {tasks.map((task) => {
        const isDimmed =
          task.status === "completed" || task.status === "deleted";
        return (
          <Box key={task.id} gap={1}>
            {getStatusIcon(task.status)}
            <Text dimColor={isDimmed}>
              {truncate(task.subject, maxSubjectWidth)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
