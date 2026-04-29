import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { selectorReducer } from "../reducers/selectorReducer.js";

export interface ModelSelectorProps {
  onCancel: () => void;
  currentModel: string;
  configuredModels: string[];
  onSelectModel: (model: string) => void;
}

const MAX_VISIBLE_ITEMS = 5;

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  onCancel,
  currentModel,
  configuredModels,
  onSelectModel,
}) => {
  const [state, dispatch] = useReducer(selectorReducer, {
    selectedIndex:
      configuredModels.indexOf(currentModel) !== -1
        ? configuredModels.indexOf(currentModel)
        : 0,
    pendingDecision: null,
  });

  const { selectedIndex, pendingDecision } = state;

  useInput((_input, key) => {
    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: configuredModels.length - 1,
      hasInsert: false,
    });
  });

  useEffect(() => {
    if (pendingDecision === "select") {
      if (configuredModels.length > 0) {
        onSelectModel(configuredModels[selectedIndex]);
      }
      onCancel();
      dispatch({ type: "CLEAR_DECISION" });
    } else if (pendingDecision === "cancel") {
      onCancel();
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [
    pendingDecision,
    selectedIndex,
    configuredModels,
    onSelectModel,
    onCancel,
  ]);

  // Calculate visible window
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, configuredModels.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleModels = configuredModels.slice(
    startIndex,
    startIndex + MAX_VISIBLE_ITEMS,
  );

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

      {visibleModels.map((model, index) => {
        const actualIndex = startIndex + index;
        return (
          <Box key={model}>
            <Text
              color={actualIndex === selectedIndex ? "black" : "white"}
              backgroundColor={
                actualIndex === selectedIndex ? "cyan" : undefined
              }
            >
              {actualIndex === selectedIndex ? "▶ " : "  "}
              {model}
              {model === currentModel ? (
                <Text color="green"> (current)</Text>
              ) : (
                ""
              )}
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>↑/↓ to select · Enter to confirm · Esc to cancel</Text>
      </Box>
    </Box>
  );
};
