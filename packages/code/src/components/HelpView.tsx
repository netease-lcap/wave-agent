import React from "react";
import { Box, Text, useInput } from "ink";

export interface HelpViewProps {
  onCancel: () => void;
}

export const HelpView: React.FC<HelpViewProps> = ({ onCancel }) => {
  useInput((_, key) => {
    if (key.escape || key.return) {
      onCancel();
    }
  });

  const helpItems = [
    { key: "@", description: "Reference files" },
    { key: "/", description: "Commands" },
    { key: "Ctrl+R", description: "Search history" },
    { key: "Ctrl+O", description: "Expand/collapse messages" },
    { key: "Ctrl+T", description: "Toggle task list" },
    { key: "Ctrl+B", description: "Background current task" },
    { key: "Ctrl+V", description: "Paste image" },
    { key: "Shift+Tab", description: "Cycle permission mode" },
    {
      key: "Esc",
      description: "Interrupt AI or command / Cancel selector / Close help",
    },
  ];

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text color="cyan" bold underline>
          Help & Key Bindings
        </Text>
      </Box>

      {helpItems.map((item, index) => (
        <Box key={index}>
          <Box width={20}>
            <Text color="yellow">{item.key}</Text>
          </Box>
          <Text color="white">{item.description}</Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>Press Esc or Enter to close</Text>
      </Box>
    </Box>
  );
};
