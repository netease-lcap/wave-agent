import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { Markdown } from "./Markdown.js";

interface PlanDisplayProps {
  plan: string;
  isExpanded?: boolean;
}

export const PlanDisplay: React.FC<PlanDisplayProps> = ({
  plan,
  isExpanded = false,
}) => {
  const { stdout } = useStdout();
  const maxHeight = useMemo(() => {
    // Similar to DiffDisplay.tsx maxHeight calculation
    return Math.max(5, (stdout?.rows || 24) - 25);
  }, [stdout?.rows]);

  const lines = useMemo(() => plan.split("\n"), [plan]);
  const isOverflowing = !isExpanded && lines.length > maxHeight;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="column"
        height={isExpanded ? undefined : maxHeight}
        overflow="hidden"
      >
        <Markdown>{plan}</Markdown>
      </Box>
      {isOverflowing && (
        <Box marginTop={1}>
          <Text color="yellow" dimColor>
            ... (plan truncated, {lines.length} lines total, Ctrl+O to expand)
          </Text>
        </Box>
      )}
    </Box>
  );
};
