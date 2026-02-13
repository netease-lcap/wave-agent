import React from "react";
import { Box, Text } from "ink";

export interface LoadingIndicatorProps {
  isLoading?: boolean;
  isCommandRunning?: boolean;
  isCompressing?: boolean;
  latestTotalTokens?: number;
}

export const LoadingIndicator = ({
  isLoading = false,
  isCommandRunning = false,
  isCompressing = false,
  latestTotalTokens = 0,
}: LoadingIndicatorProps) => {
  return (
    <Box flexDirection="column" paddingY={1}>
      {isLoading && (
        <Box>
          <Text color="yellow">💭 AI is thinking... </Text>
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
          <Text color="gray" dimColor>
            |{" "}
          </Text>
          <Text color="red" bold>
            Esc
          </Text>
          <Text color="gray" dimColor>
            {" "}
            to abort
          </Text>
        </Box>
      )}
      {isCommandRunning && <Text color="blue">🚀 Command is running...</Text>}
      {isCompressing && (
        <Text color="magenta">🗜️ Compressing message history...</Text>
      )}
    </Box>
  );
};

LoadingIndicator.displayName = "LoadingIndicator";
