import React from "react";
import { Box, Text } from "ink";

export interface StatusLineProps {
  permissionMode: string;
  isShellCommand: boolean;
  isBtwActive: boolean;
}

export const StatusLine: React.FC<StatusLineProps> = ({
  permissionMode,
  isShellCommand,
  isBtwActive,
}) => {
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
        <Text color="gray">
          Mode:{" "}
          <Text color={permissionMode === "plan" ? "yellow" : "cyan"}>
            {permissionMode}
          </Text>{" "}
          (Shift+Tab to cycle)
        </Text>
      )}
    </Box>
  );
};
