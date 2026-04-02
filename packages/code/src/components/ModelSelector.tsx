import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface ModelSelectorProps {
  onCancel: () => void;
  currentModel: string;
  configuredModels: string[];
  onSelectModel: (model: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  onCancel,
  currentModel,
  configuredModels,
  onSelectModel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const index = configuredModels.indexOf(currentModel);
    return index !== -1 ? index : 0;
  });

  useInput((_input, key) => {
    if (key.return) {
      if (configuredModels.length > 0) {
        onSelectModel(configuredModels[selectedIndex]);
      }
      onCancel();
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) =>
        Math.min(configuredModels.length - 1, prev + 1),
      );
      return;
    }
  });

  if (configuredModels.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingTop={1}
      >
        <Text color="cyan" bold>
          Select AI Model
        </Text>
        <Text>No models configured</Text>
        <Text dimColor>Press Escape to close</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={1}
      gap={1}
    >
      <Box>
        <Text color="cyan" bold>
          Select AI Model
        </Text>
      </Box>
      <Text dimColor>Select a model to use for the current session</Text>

      {configuredModels.map((model, index) => (
        <Box key={model}>
          <Text
            color={index === selectedIndex ? "black" : "white"}
            backgroundColor={index === selectedIndex ? "cyan" : undefined}
          >
            {index === selectedIndex ? "▶ " : "  "}
            {model}
            {model === currentModel ? (
              <Text color="green"> (current)</Text>
            ) : (
              ""
            )}
          </Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>↑/↓ to select · Enter to confirm · Esc to cancel</Text>
      </Box>
    </Box>
  );
};
