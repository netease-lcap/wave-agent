import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { CompactBlock } from "wave-agent-sdk";

interface CompactDisplayProps {
  block: CompactBlock;
  isExpanded?: boolean;
}

export const CompactDisplay: React.FC<CompactDisplayProps> = ({ block }) => {
  const { content } = block;

  const { displayContent } = useMemo(() => {
    if (!content) {
      return { displayContent: "" };
    }

    return { displayContent: content };
  }, [content]);

  return (
    <Box flexDirection="column">
      <Box>
        <Text>Compacted Messages</Text>
      </Box>

      {content && (
        <Box marginTop={1} flexDirection="column">
          <Box
            paddingLeft={2}
            borderLeft
            borderColor="gray"
            flexDirection="column"
          >
            <Text color="white">{displayContent}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
