import React from "react";
import { Box, Text } from "ink";

export interface LoadingIndicatorProps {
  isLoading?: boolean;
  isCommandRunning?: boolean;
  isCompressing?: boolean;
  latestTotalTokens?: number;
  isSideAgentThinking?: boolean;
  isSideAgentActive?: boolean;
}

export const LoadingIndicator = ({
  isLoading = false,
  isCommandRunning = false,
  isCompressing = false,
  latestTotalTokens = 0,
  isSideAgentThinking = false,
  isSideAgentActive = false,
}: LoadingIndicatorProps) => {
  if (isSideAgentActive) {
    return (
      <Box flexDirection="column">
        {isSideAgentThinking && (
          <Text color="yellow">✻ Side agent is thinking... </Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {isLoading && !isCompressing && (
        <Box>
          <Text color="yellow">✻ AI is thinking... </Text>
          {latestTotalTokens > 0 && (
            <>
              <Text color="gray" dimColor>
                |{" "}
              </Text>
              <Text color="blue" bold>
                {latestTotalTokens.toLocaleString()}
              </Text>
              <Text color="gray" dimColor>
                {" "}
                tokens{" "}
              </Text>
            </>
          )}
        </Box>
      )}
      {isCommandRunning && <Text color="blue">✻ Command is running...</Text>}
      {isCompressing && (
        <Text color="magenta">✻ Compressing message history...</Text>
      )}
    </Box>
  );
};

LoadingIndicator.displayName = "LoadingIndicator";
