import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionDecision, AskUserQuestionInput } from "wave-agent-sdk";
import {
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  MULTI_EDIT_TOOL_NAME,
  DELETE_FILE_TOOL_NAME,
  WRITE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
} from "wave-agent-sdk";
import { Markdown } from "./Markdown.js";
import { DiffDisplay } from "./DiffDisplay.js";

// Helper function to generate descriptive action text
const getActionDescription = (
  toolName: string,
  toolInput?: Record<string, unknown>,
): string => {
  if (!toolInput) {
    return "Execute operation";
  }

  switch (toolName) {
    case BASH_TOOL_NAME:
      return `Execute command: ${toolInput.command || "unknown command"}`;
    case EDIT_TOOL_NAME:
      return `Edit file: ${toolInput.file_path || "unknown file"}`;
    case MULTI_EDIT_TOOL_NAME:
      return `Edit multiple sections in: ${toolInput.file_path || "unknown file"}`;
    case DELETE_FILE_TOOL_NAME:
      return `Delete file: ${toolInput.target_file || "unknown file"}`;
    case WRITE_TOOL_NAME:
      return `Write to file: ${toolInput.file_path || "unknown file"}`;
    case EXIT_PLAN_MODE_TOOL_NAME:
      return "Review and approve the plan";
    case ASK_USER_QUESTION_TOOL_NAME:
      return "Answer questions to clarify intent";
    default:
      return "Execute operation";
  }
};

const getHeaderColor = (header: string) => {
  const colors = ["red", "green", "blue", "magenta", "cyan"] as const;
  let hash = 0;
  for (let i = 0; i < header.length; i++) {
    hash = header.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

export interface ConfirmationProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
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
  hidePersistentOption,
  onDecision,
  onCancel,
  onAbort,
}) => {
  const [state, setState] = useState<ConfirmationState>({
    selectedOption: "allow",
    alternativeText: "",
    hasUserInput: false,
  });

  // Specialized state for AskUserQuestion
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [selectedOptionIndices, setSelectedOptionIndices] = useState<
    Set<number>
  >(new Set());
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [otherText, setOtherText] = useState("");

  const questions =
    (toolInput as unknown as AskUserQuestionInput)?.questions || [];
  const currentQuestion = questions[currentQuestionIndex];

  const getAutoOptionText = () => {
    if (toolName === EXIT_PLAN_MODE_TOOL_NAME) {
      return "Yes, and auto-accept edits";
    }
    if (toolName === BASH_TOOL_NAME) {
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

    if (toolName === ASK_USER_QUESTION_TOOL_NAME) {
      if (!currentQuestion) return;

      const options = [...currentQuestion.options, { label: "Other" }];
      const isMultiSelect = !!currentQuestion.multiSelect;

      const isOtherFocused = selectedOptionIndex === options.length - 1;

      if (key.return) {
        let answer = "";
        if (isMultiSelect) {
          const selectedLabels = Array.from(selectedOptionIndices)
            .filter((i) => i < currentQuestion.options.length)
            .map((i) => currentQuestion.options[i].label);

          const isOtherChecked = selectedOptionIndices.has(options.length - 1);
          if (isOtherChecked && otherText.trim()) {
            selectedLabels.push(otherText.trim());
          }
          answer = selectedLabels.join(", ");
        } else {
          if (isOtherFocused) {
            answer = otherText.trim();
          } else {
            answer = options[selectedOptionIndex].label;
          }
        }

        if (!answer) return;

        const newAnswers = {
          ...userAnswers,
          [currentQuestion.question]: answer,
        };
        setUserAnswers(newAnswers);

        if (currentQuestionIndex < questions.length - 1) {
          setCurrentQuestionIndex(currentQuestionIndex + 1);
          setSelectedOptionIndex(0);
          setSelectedOptionIndices(new Set());
          setOtherText("");
        } else {
          // All questions answered
          onDecision({
            behavior: "allow",
            message: JSON.stringify(newAnswers),
          });
        }
        return;
      }

      if (input === " ") {
        if (
          isMultiSelect &&
          (!isOtherFocused || !selectedOptionIndices.has(selectedOptionIndex))
        ) {
          setSelectedOptionIndices((prev) => {
            const next = new Set(prev);
            if (next.has(selectedOptionIndex)) {
              next.delete(selectedOptionIndex);
            } else {
              next.add(selectedOptionIndex);
            }
            return next;
          });
          return;
        }

        if (!isOtherFocused) {
          return;
        }
        // If isOtherFocused is true, fall through to handle space as text input
      }

      if (key.upArrow) {
        if (selectedOptionIndex > 0) {
          setSelectedOptionIndex(selectedOptionIndex - 1);
        }
        return;
      }

      if (key.downArrow) {
        if (selectedOptionIndex < options.length - 1) {
          setSelectedOptionIndex(selectedOptionIndex + 1);
        }
        return;
      }

      if (input >= "1" && input <= String(options.length)) {
        const index = parseInt(input) - 1;
        setSelectedOptionIndex(index);
        if (isMultiSelect) {
          setSelectedOptionIndices((prev) => {
            const next = new Set(prev);
            if (next.has(index)) {
              next.delete(index);
            } else {
              next.add(index);
            }
            return next;
          });
        }
        return;
      }

      if (isOtherFocused) {
        if (key.backspace || key.delete) {
          setOtherText((prev) => prev.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta) {
          setOtherText((prev) => prev + input);
        }
        return;
      }

      return;
    }

    // Handle Enter to confirm selection
    if (key.return) {
      if (state.selectedOption === "allow") {
        if (toolName === EXIT_PLAN_MODE_TOOL_NAME) {
          onDecision({ behavior: "allow", newPermissionMode: "default" });
        } else {
          onDecision({ behavior: "allow" });
        }
      } else if (state.selectedOption === "auto") {
        if (toolName === BASH_TOOL_NAME) {
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
        if (toolName === EXIT_PLAN_MODE_TOOL_NAME) {
          onDecision({ behavior: "allow", newPermissionMode: "default" });
        } else {
          onDecision({ behavior: "allow" });
        }
        return;
      }
      if (input === "2") {
        if (!hidePersistentOption) {
          if (toolName === BASH_TOOL_NAME) {
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
        } else {
          // If auto option is hidden, '2' selects alternative
          setState((prev) => ({ ...prev, selectedOption: "alternative" }));
          return;
        }
      }
      if (input === "3" && !hidePersistentOption) {
        setState((prev) => ({ ...prev, selectedOption: "alternative" }));
        return;
      }
    }

    // Handle arrow keys for navigation
    if (key.upArrow) {
      setState((prev) => {
        if (prev.selectedOption === "alternative") {
          return {
            ...prev,
            selectedOption: hidePersistentOption ? "allow" : "auto",
          };
        }
        if (prev.selectedOption === "auto")
          return { ...prev, selectedOption: "allow" };
        return prev;
      });
      return;
    }

    if (key.downArrow) {
      setState((prev) => {
        if (prev.selectedOption === "allow") {
          return {
            ...prev,
            selectedOption: hidePersistentOption ? "alternative" : "auto",
          };
        }
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
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={1}
    >
      <Text color="yellow" bold>
        Tool: {toolName}
      </Text>
      <Text color="yellow">{getActionDescription(toolName, toolInput)}</Text>

      <DiffDisplay toolName={toolName} parameters={JSON.stringify(toolInput)} />

      {toolName === ASK_USER_QUESTION_TOOL_NAME && currentQuestion && (
        <Box flexDirection="column" marginTop={1}>
          <Box marginBottom={1}>
            <Box
              backgroundColor={getHeaderColor(currentQuestion.header)}
              paddingX={1}
              marginRight={1}
            >
              <Text color="black" bold>
                {currentQuestion.header.slice(0, 12).toUpperCase()}
              </Text>
            </Box>
            <Text bold>{currentQuestion.question}</Text>
          </Box>

          <Box flexDirection="column">
            {(() => {
              const isMultiSelect = !!currentQuestion.multiSelect;
              return [...currentQuestion.options, { label: "Other" }].map(
                (option, index) => {
                  const isSelected = selectedOptionIndex === index;
                  const isChecked = isMultiSelect
                    ? selectedOptionIndices.has(index)
                    : isSelected;
                  const isOther = index === currentQuestion.options.length;
                  const isRecommended = !isOther && option.isRecommended;

                  return (
                    <Box key={index}>
                      <Text
                        color={isSelected ? "black" : "white"}
                        backgroundColor={isSelected ? "yellow" : undefined}
                      >
                        {isSelected ? "> " : "  "}
                        {isMultiSelect ? (isChecked ? "[x] " : "[ ] ") : ""}
                        {index + 1}. {option.label}
                        {isRecommended && (
                          <Text color="green" bold>
                            {" "}
                            (Recommended)
                          </Text>
                        )}
                        {option.description ? ` - ${option.description}` : ""}
                        {isOther && isSelected && (
                          <Text>
                            :{" "}
                            {otherText || (
                              <Text color="gray" dimColor>
                                [Type your answer...]
                              </Text>
                            )}
                          </Text>
                        )}
                      </Text>
                    </Box>
                  );
                },
              );
            })()}
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              Question {currentQuestionIndex + 1} of {questions.length} •
              {currentQuestion.multiSelect ? " Space to toggle •" : ""} Use ↑↓
              or 1-{currentQuestion.options.length + 1} to navigate • Enter to
              confirm
            </Text>
          </Box>
        </Box>
      )}

      {toolName !== ASK_USER_QUESTION_TOOL_NAME &&
        toolName === EXIT_PLAN_MODE_TOOL_NAME &&
        !!toolInput?.plan_content && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="cyan" bold>
              Plan Content:
            </Text>
            <Markdown>{toolInput.plan_content as string}</Markdown>
          </Box>
        )}

      {toolName !== ASK_USER_QUESTION_TOOL_NAME && (
        <>
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
                {state.selectedOption === "allow" ? "> " : "  "}1.{" "}
                {toolName === EXIT_PLAN_MODE_TOOL_NAME
                  ? "Yes, proceed with default mode"
                  : "Yes"}
              </Text>
            </Box>

            {/* Option 2: Auto-accept/Persistent */}
            {!hidePersistentOption && (
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
            )}

            {/* Option 3: Alternative */}
            <Box key="alternative-option">
              <Text
                color={
                  state.selectedOption === "alternative" ? "black" : "white"
                }
                backgroundColor={
                  state.selectedOption === "alternative" ? "yellow" : undefined
                }
                bold={state.selectedOption === "alternative"}
              >
                {state.selectedOption === "alternative" ? "> " : "  "}
                {hidePersistentOption ? "2. " : "3. "}
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
            <Text dimColor>
              Use ↑↓ or 1-{hidePersistentOption ? "2" : "3"} to navigate • ESC
              to cancel
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
};
