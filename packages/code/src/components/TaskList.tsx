import React from "react";
import { useChat } from "../contexts/useChat.js";
import { Box, Text } from "ink";
import { useTasks } from "../hooks/useTasks.js";

export const TaskList: React.FC = () => {
  const tasks = useTasks();
  const { isTaskListVisible } = useChat();

  if (tasks.length === 0 || !isTaskListVisible) {
    return null;
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <Text color="gray">□</Text>;
      case "in_progress":
        return <Text color="yellow">■</Text>;
      case "completed":
        return <Text color="green">✓</Text>;
      case "deleted":
        return <Text color="red">✕</Text>;
      default:
        return <Text color="gray">?</Text>;
    }
  };

  return (
    <Box flexDirection="column">
      {tasks.map((task) => {
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
            {getStatusIcon(task.status)}
            <Text dimColor={isDimmed}>{fullText}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
