import React from "react";
import { Box, Text } from "ink";
import type { TaskNotificationBlock } from "wave-agent-sdk";

export interface TaskNotificationMessageProps {
  block: TaskNotificationBlock;
}

const statusColor: Record<TaskNotificationBlock["status"], string> = {
  completed: "green",
  failed: "red",
  killed: "yellow",
};

export const TaskNotificationMessage = ({
  block,
}: TaskNotificationMessageProps) => {
  const color = statusColor[block.status];

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color} bold>
          {"\u2B24"}
        </Text>
        <Text color="white"> {block.summary}</Text>
      </Box>
    </Box>
  );
};
