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

  const displayedPlan = useMemo(() => {
    if (isOverflowing) {
      const slicedLines = lines.slice(0, maxHeight);
      // If we sliced in the middle of a code block, we should close it
      let inCodeBlock = false;
      for (const line of slicedLines) {
        if (line.trim().startsWith("```")) {
          inCodeBlock = !inCodeBlock;
        }
      }
      if (inCodeBlock) {
        slicedLines.push("```");
      }
      return slicedLines.join("\n");
    }
    return plan;
  }, [plan, isOverflowing, maxHeight, lines]);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="column"
        height={isOverflowing ? maxHeight : undefined}
        overflow="hidden"
      >
        <Markdown>{displayedPlan}</Markdown>
      </Box>
      {isOverflowing && (
        <Box marginTop={1}>
          <Text color="yellow" dimColor>
            ... (plan truncated, {lines.length} lines total)
          </Text>
        </Box>
      )}
    </Box>
  );
};
