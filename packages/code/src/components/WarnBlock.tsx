import React from "react";
import { Box, Text } from "ink";
import { WarnBlock } from "wave-agent-sdk";

export interface WarnBlockProps {
  block: WarnBlock;
  onDismiss?: () => void;
}

export function WarnBlockComponent({ 
  block, 
  onDismiss
}: WarnBlockProps) {
  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      marginBottom={1}
    >
      {/* Header Section */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box flexDirection="row" alignItems="center">
          <Text color="yellow">⚠️  Warning</Text>
        </Box>

        {onDismiss && (
          <Text color="gray" dimColor>
            Press 'x' to dismiss
          </Text>
        )}
      </Box>

      {/* Content Section */}
      <Box marginTop={1}>
        <Text color="yellow">{block.content}</Text>
      </Box>
    </Box>
  );
}

export default WarnBlockComponent;