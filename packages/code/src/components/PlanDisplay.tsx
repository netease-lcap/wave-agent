import React from "react";
import { Box } from "ink";
import { Markdown } from "./Markdown.js";

interface PlanDisplayProps {
  plan: string;
  isExpanded?: boolean;
}

export const PlanDisplay: React.FC<PlanDisplayProps> = ({ plan }) => {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column">
        <Markdown>{plan}</Markdown>
      </Box>
    </Box>
  );
};
