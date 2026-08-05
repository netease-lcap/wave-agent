import React from "react";
import { Box, Text } from "ink";

export interface NotificationsProps {
  latestTotalTokens?: number;
  maxInputTokens?: number;
  showLoginHint?: boolean;
}

export const Notifications: React.FC<NotificationsProps> = ({
  latestTotalTokens = 0,
  maxInputTokens = 200000,
  showLoginHint = false,
}) => {
  const percentage =
    latestTotalTokens > 0
      ? Math.min(Math.round((latestTotalTokens / maxInputTokens) * 100), 100)
      : 0;

  const contextColor =
    percentage > 95 ? "red" : percentage > 80 ? "yellow" : "gray";

  return (
    <Box gap={1}>
      {showLoginHint && <Text color="gray">Type /login to authenticate</Text>}
      {percentage > 0 && (
        <Text color={contextColor}>{percentage}% context</Text>
      )}
    </Box>
  );
};
