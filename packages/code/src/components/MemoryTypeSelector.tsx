import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface MemoryTypeSelectorProps {
  message: string;
  onSelect: (type: "project" | "user") => void;
  onCancel: () => void;
}

export const MemoryTypeSelector: React.FC<MemoryTypeSelectorProps> = ({
  message,
  onSelect,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const options = [
    {
      type: "project" as const,
      label: "Project Memory",
      description: "Save to current project (AGENTS.md)",
    },
    {
      type: "user" as const,
      label: "User Memory",
      description: "Save to user global memory",
    },
  ];

  useInput((input, key) => {
    if (key.return) {
      const selectedOption = options[selectedIndex];
      onSelect(selectedOption.type);
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(Math.min(options.length - 1, selectedIndex + 1));
      return;
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="green"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={1}
      gap={1}
    >
      <Box>
        <Text color="green" bold>
          Save Memory: "{message.substring(1).trim()}"
        </Text>
      </Box>

      <Text color="gray">Choose where to save this memory:</Text>

      {options.map((option, index) => (
        <Box key={option.type} flexDirection="column">
          <Text
            color={index === selectedIndex ? "black" : "white"}
            backgroundColor={index === selectedIndex ? "green" : undefined}
            bold={index === selectedIndex}
          >
            {option.label}
          </Text>
          {index === selectedIndex && (
            <Box marginLeft={2}>
              <Text color="gray" dimColor>
                {option.description}
              </Text>
            </Box>
          )}
        </Box>
      ))}

      <Box>
        <Text dimColor>
          Use ↑↓ to navigate, Enter to select, Escape to cancel
        </Text>
      </Box>
    </Box>
  );
};
