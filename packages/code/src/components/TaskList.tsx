import React from "react";
import { useChat } from "../contexts/useChat.js";
import { Box, Text, useStdout } from "ink";
import { useTasks } from "../hooks/useTasks.js";

export const TaskList: React.FC = () => {
  const tasks = useTasks();
  const { isTaskListVisible } = useChat();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const maxSubjectWidth = Math.max(20, terminalWidth - 10);

  if (tasks.length === 0 || !isTaskListVisible) {
    return null;
  }

  const getStatusIcon = (status: string, isBlocked: boolean) => {
    if (isBlocked) {
      return <Text color="red">🔒</Text>;
    }
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

  const visibleTasks = tasks.filter(
    (task) => task.status !== "completed" && task.status !== "deleted",
  );
  const completedCount = tasks.length - visibleTasks.length;

  return (
    <Box flexDirection="column">
      {visibleTasks.map((task) => {
        const isDimmed =
          task.status === "completed" || task.status === "deleted";
        const isBlocked = task.blockedBy && task.blockedBy.length > 0;
        const blockingTaskIds = isBlocked
          ? task.blockedBy.map((id) => `#${id}`)
          : [];

        const blockedByText =
          isBlocked && blockingTaskIds.length > 0
            ? ` (Blocked by: ${blockingTaskIds.join(", ")})`
            : "";

        const fullText = `${task.subject}${blockedByText}`;

        return (
          <Box key={task.id} gap={1}>
            {getStatusIcon(task.status, isBlocked)}
            <Text dimColor={isDimmed}>
              {truncate(fullText, maxSubjectWidth)}
            </Text>
          </Box>
        );
      })}
      {completedCount > 0 && (
        <Box gap={1}>
          <Text color="green">✓</Text>
          <Text dimColor color="gray">
            {completedCount} completed {completedCount === 1 ? "task" : "tasks"}
          </Text>
        </Box>
      )}
    </Box>
  );
};
