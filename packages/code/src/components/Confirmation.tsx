import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionDecision } from "wave-agent-sdk";

// Helper function to generate descriptive action text
const getActionDescription = (
  toolName: string,
  toolInput?: Record<string, unknown>,
): string => {
  if (!toolInput) {
    return "Execute operation";
  }

  switch (toolName) {
    case "Bash":
      return `Execute command: ${toolInput.command || "unknown command"}`;
    case "Edit":
      return `Edit file: ${toolInput.file_path || "unknown file"}`;
    case "MultiEdit":
      return `Edit multiple sections in: ${toolInput.file_path || "unknown file"}`;
    case "Delete":
      return `Delete file: ${toolInput.target_file || "unknown file"}`;
    case "Write":
      return `Write to file: ${toolInput.file_path || "unknown file"}`;
    default:
      return "Execute operation";
  }
};

export interface ConfirmationProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  onDecision: (decision: PermissionDecision) => void;
  onCancel: () => void;
}

interface ConfirmationState {
  selectedOption: "allow" | "alternative";
  alternativeText: string;
  hasUserInput: boolean; // to hide placeholder
}

export const Confirmation: React.FC<ConfirmationProps> = ({
  toolName,
  toolInput,
  onDecision,
  onCancel,
}) => {
  const [state, setState] = useState<ConfirmationState>({
    selectedOption: "allow",
    alternativeText: "",
    hasUserInput: false,
  });

  useInput((input, key) => {
    // Handle ESC to cancel
    if (key.escape) {
      onCancel();
      return;
    }

    // Handle Enter to confirm selection
    if (key.return) {
      if (state.selectedOption === "allow") {
        onDecision({ behavior: "allow" });
      } else {
        // For alternative option, require text input
        if (state.alternativeText.trim()) {
          onDecision({
            behavior: "deny",
            message: state.alternativeText.trim(),
          });
        }
      }
      return;
    }

    // Handle arrow keys for navigation
    if (key.upArrow) {
      setState((prev) => ({ ...prev, selectedOption: "allow" }));
      return;
    }

    if (key.downArrow) {
      setState((prev) => ({ ...prev, selectedOption: "alternative" }));
      return;
    }

    // Handle text input for alternative option
    if (input && !key.ctrl && !key.meta && !("alt" in key && key.alt)) {
      // Focus on alternative option when user starts typing
      setState((prev) => ({
        selectedOption: "alternative",
        alternativeText: prev.alternativeText + input,
        hasUserInput: true,
      }));
      return;
    }

    // Handle backspace and delete (same behavior - delete one character)
    if (key.backspace || key.delete) {
      setState((prev) => {
        const newText = prev.alternativeText.slice(0, -1);
        return {
          ...prev,
          selectedOption: "alternative",
          alternativeText: newText,
          hasUserInput: newText.length > 0,
        };
      });
      return;
    }
  });

  const placeholderText = "Type here to tell Wave what to do differently";
  const showPlaceholder =
    state.selectedOption === "alternative" && !state.hasUserInput;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="yellow"
      padding={1}
      marginBottom={1}
    >
      <Text color="yellow" bold>
        Tool: {toolName}
      </Text>
      <Text color="yellow">{getActionDescription(toolName, toolInput)}</Text>

      <Box marginTop={1}>
        <Text>Do you want to proceed?</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {/* Option 1: Yes */}
        <Box key="allow-option">
          <Text
            color={state.selectedOption === "allow" ? "black" : "white"}
            backgroundColor={
              state.selectedOption === "allow" ? "yellow" : undefined
            }
            bold={state.selectedOption === "allow"}
          >
            {state.selectedOption === "allow" ? "> " : "  "}1. Yes
          </Text>
        </Box>

        {/* Option 2: Alternative */}
        <Box key="alternative-option" marginTop={1}>
          <Text
            color={state.selectedOption === "alternative" ? "black" : "white"}
            backgroundColor={
              state.selectedOption === "alternative" ? "yellow" : undefined
            }
            bold={state.selectedOption === "alternative"}
          >
            {state.selectedOption === "alternative" ? "> " : "  "}2.{" "}
            {showPlaceholder ? (
              <Text color="gray" dimColor>
                {placeholderText}
              </Text>
            ) : (
              <Text>
                {state.alternativeText ||
                  "Type here to tell Wave what to do differently"}
              </Text>
            )}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Use ↑↓ to navigate • ESC to cancel</Text>
      </Box>
    </Box>
  );
};
