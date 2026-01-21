import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { Markdown } from "./Markdown.js";

interface PlanDisplayProps {
  planContent?: string;
  isExpanded?: boolean;
}

export const PlanDisplay: React.FC<PlanDisplayProps> = ({
  planContent,
  isExpanded = false,
}) => {
  const { stdout } = useStdout();
  const maxHeight = useMemo(() => {
    return Math.max(5, (stdout?.rows || 24) - 20);
  }, [stdout?.rows]);

  if (!planContent) return null;

  const planLines = planContent.split("\n");
  const isTruncated = !isExpanded && planLines.length > maxHeight;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan" bold>
        Plan Content:
      </Text>
      <Box
        paddingLeft={2}
        borderLeft
        borderColor="gray"
        flexDirection="column"
        overflow="hidden"
        height={isExpanded ? undefined : isTruncated ? maxHeight : undefined}
      >
        <Markdown>{planContent}</Markdown>
      </Box>
      {isTruncated && (
        <Box marginTop={1}>
          <Text color="yellow" dimColor>
            Plan truncated. Press Ctrl+O to expand.
          </Text>
        </Box>
      )}
    </Box>
  );
};
