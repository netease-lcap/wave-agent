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
  suggestedPrefix?: string;
  onDecision: (decision: PermissionDecision) => void;
  onCancel: () => void;
  onAbort: () => void;
}

interface ConfirmationState {
  selectedOption: "allow" | "auto" | "alternative";
  alternativeText: string;
  hasUserInput: boolean; // to hide placeholder
}

export const Confirmation: React.FC<ConfirmationProps> = ({
  toolName,
  toolInput,
  suggestedPrefix,
  onDecision,
  onCancel,
  onAbort,
}) => {
  const [state, setState] = useState<ConfirmationState>({
    selectedOption: "allow",
    alternativeText: suggestedPrefix || "",
    hasUserInput: !!suggestedPrefix,
  });

  const getAutoOptionText = () => {
    if (toolName === "Bash") {
      if (suggestedPrefix) {
        return `Yes, and don't ask again for: ${suggestedPrefix}`;
      }
      return "Yes, and don't ask again for this command in this workdir";
    }
    return "Yes, and auto-accept edits";
  };

  useInput((input, key) => {
    // Handle ESC to cancel and abort
    if (key.escape) {
      onCancel();
      onAbort();
      return;
    }

    // Handle Enter to confirm selection
    if (key.return) {
      if (state.selectedOption === "allow") {
        onDecision({ behavior: "allow" });
      } else if (state.selectedOption === "auto") {
        if (toolName === "Bash") {
          const rule = suggestedPrefix
            ? `Bash(${suggestedPrefix}:*)`
            : `Bash(${toolInput?.command})`;
          onDecision({
            behavior: "allow",
            newPermissionRule: rule,
          });
        } else {
          onDecision({
            behavior: "allow",
            newPermissionMode: "acceptEdits",
          });
        }
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

    // Handle numeric keys for quick selection (only if not typing in alternative)
    if (state.selectedOption !== "alternative" || !state.hasUserInput) {
      if (input === "1") {
        onDecision({ behavior: "allow" });
        return;
      }
      if (input === "2") {
        if (toolName === "Bash") {
          const rule = suggestedPrefix
            ? `Bash(${suggestedPrefix}:*)`
            : `Bash(${toolInput?.command})`;
          onDecision({
            behavior: "allow",
            newPermissionRule: rule,
          });
        } else {
          onDecision({
            behavior: "allow",
            newPermissionMode: "acceptEdits",
          });
        }
        return;
      }
      if (input === "3") {
        setState((prev) => ({ ...prev, selectedOption: "alternative" }));
        return;
      }
    }

    // Handle arrow keys for navigation
    if (key.upArrow) {
      setState((prev) => {
        if (prev.selectedOption === "alternative")
          return { ...prev, selectedOption: "auto" };
        if (prev.selectedOption === "auto")
          return { ...prev, selectedOption: "allow" };
        return prev;
      });
      return;
    }

    if (key.downArrow) {
      setState((prev) => {
        if (prev.selectedOption === "allow")
          return { ...prev, selectedOption: "auto" };
        if (prev.selectedOption === "auto")
          return { ...prev, selectedOption: "alternative" };
        return prev;
      });
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

        {/* Option 2: Auto-accept/Persistent */}
        <Box key="auto-option">
          <Text
            color={state.selectedOption === "auto" ? "black" : "white"}
            backgroundColor={
              state.selectedOption === "auto" ? "yellow" : undefined
            }
            bold={state.selectedOption === "auto"}
          >
            {state.selectedOption === "auto" ? "> " : "  "}2.{" "}
            {getAutoOptionText()}
          </Text>
        </Box>

        {/* Option 3: Alternative */}
        <Box key="alternative-option">
          <Text
            color={state.selectedOption === "alternative" ? "black" : "white"}
            backgroundColor={
              state.selectedOption === "alternative" ? "yellow" : undefined
            }
            bold={state.selectedOption === "alternative"}
          >
            {state.selectedOption === "alternative" ? "> " : "  "}3.{" "}
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
        <Text dimColor>Use ↑↓ or 1-3 to navigate • ESC to cancel</Text>
      </Box>
    </Box>
  );
};
