import React from "react";
import { Box, Text } from "ink";

export interface StatusLineProps {
  permissionMode: string;
  isShellCommand: boolean;
  isBtwActive: boolean;
  isGoalActive?: boolean;
  goalElapsed?: string;
  latestTotalTokens?: number;
  maxInputTokens?: number;
}

export const StatusLine: React.FC<StatusLineProps> = ({
  permissionMode,
  isShellCommand,
  isBtwActive,
  isGoalActive,
  goalElapsed,
  latestTotalTokens = 0,
  maxInputTokens = 128000,
}) => {
  const percentage =
    latestTotalTokens > 0
      ? Math.min(Math.round((latestTotalTokens / maxInputTokens) * 100), 100)
      : 0;

  const contextColor =
    percentage > 95 ? "red" : percentage > 80 ? "yellow" : "gray";

  return (
    <Box paddingRight={1} justifyContent="space-between" width="100%">
      {isBtwActive ? (
        <Text color="gray">
          Mode: <Text color="cyan">BTW</Text> (ESC to dismiss)
        </Text>
      ) : isShellCommand ? (
        <Text color="gray">
          Shell: <Text color="yellow">Run shell command</Text>
        </Text>
      ) : (
        <Box>
          {isGoalActive && (
            <Text color="gray">
              <Text color="cyan">◎ /goal</Text> active{" "}
              {goalElapsed && <Text>({goalElapsed})</Text>} |{" "}
            </Text>
          )}
          <Text color="gray">
            Mode:{" "}
            <Text
              color={
                permissionMode === "plan"
                  ? "yellow"
                  : permissionMode === "bypassPermissions"
                    ? "red"
                    : "cyan"
              }
              bold={permissionMode === "bypassPermissions"}
            >
              {permissionMode}
            </Text>{" "}
            (Shift+Tab to cycle)
          </Text>
        </Box>
      )}
      {percentage > 0 && (
        <Text color={contextColor}>{percentage}% context</Text>
      )}
    </Box>
  );
};
