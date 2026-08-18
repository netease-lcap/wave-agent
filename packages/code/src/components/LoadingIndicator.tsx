import React from "react";
import { Box, Text } from "ink";
import { streamingTail } from "../utils/streamingText.js";

export interface LoadingIndicatorProps {
  isLoading?: boolean;
  isCommandRunning?: boolean;
  isCompacting?: boolean;
  latestTotalTokens?: number;
  /** Accumulated streaming text from the compaction fork; its last 30
   * characters render after the compacting hint (same tail style as the
   * main-loop streaming blocks). */
  compactionStream?: string;
}

export const LoadingIndicator = ({
  isLoading = false,
  isCommandRunning = false,
  isCompacting = false,
  latestTotalTokens = 0,
  compactionStream = "",
}: LoadingIndicatorProps) => {
  return (
    <Box flexDirection="column">
      {isLoading && !isCompacting && (
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
      {isCommandRunning && <Text color="blue">✻ Command is running...</Text>}
      {isCompacting && (
        <Box>
          <Text color="magenta">✻ Compacting message history...</Text>
          {compactionStream && (
            <Text color="gray" wrap="truncate-end">
              {" "}
              {streamingTail(compactionStream)}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

LoadingIndicator.displayName = "LoadingIndicator";
