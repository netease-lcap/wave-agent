import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { CompressBlock } from "wave-agent-sdk";

interface CompressDisplayProps {
  block: CompressBlock;
  isExpanded?: boolean;
}

export const CompressDisplay: React.FC<CompressDisplayProps> = ({
  block,
  isExpanded = false,
}) => {
  const { content } = block;
  const MAX_LINES = 3; // Set maximum display lines for compressed content

  const { displayContent, isOverflowing } = useMemo(() => {
    if (!content) {
      return { displayContent: "", isOverflowing: false };
    }

    const lines = content.split("\n");
    const overflow = !isExpanded && lines.length > MAX_LINES;

    const display = overflow ? lines.slice(0, MAX_LINES).join("\n") : content;

    return { displayContent: display, isOverflowing: overflow };
  }, [content, isExpanded]);

  return (
    <Box flexDirection="column">
      <Box>
        <Text>📦 Compressed Messages</Text>
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
          {isOverflowing && (
            <Box paddingLeft={2} marginTop={1}>
              <Text color="yellow" dimColor>
                Content truncated ({content.split("\n").length} lines total,
                showing first {MAX_LINES} lines. Press Ctrl+O to expand.
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
