import React, { useEffect, useReducer, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionDecision, AskUserQuestionInput } from "wave-agent-sdk";
import {
  BASH_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
} from "wave-agent-sdk";
import {
  confirmationSelectorReducer,
  questionReducer,
  type ConfirmationSelectorState,
} from "../reducers/index.js";

const getHeaderColor = (header: string) => {
  const colors = ["red", "green", "blue", "magenta", "cyan"] as const;
  let hash = 0;
  for (let i = 0; i < header.length; i++) {
    hash = header.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

export interface ConfirmationSelectorProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  isExpanded?: boolean;
  onDecision: (decision: PermissionDecision) => void;
  onCancel: () => void;
}

export const ConfirmationSelector: React.FC<ConfirmationSelectorProps> = ({
  toolName,
  toolInput,
  suggestedPrefix,
  hidePersistentOption,
  isExpanded = false,
  onDecision,
  onCancel,
}) => {
  const [state, dispatch] = useReducer(confirmationSelectorReducer, {
    selectedOption: toolName === EXIT_PLAN_MODE_TOOL_NAME ? "clear" : "allow",
    alternativeText: "",
    alternativeCursorPosition: 0,
    hasUserInput: false,
  });

  const [questionState, questionDispatch] = useReducer(questionReducer, {
    currentQuestionIndex: 0,
    selectedOptionIndex: 0,
    selectedOptionIndices: new Set<number>(),
    userAnswers: {} as Record<string, string>,
    otherText: "",
    otherCursorPosition: 0,
    savedStates: {} as Record<
      number,
      {
        selectedOptionIndex: number;
        selectedOptionIndices: Set<number>;
        otherText: string;
        otherCursorPosition: number;
      }
    >,
  });

  const pendingDecisionRef = useRef<PermissionDecision | null>(null);

  useEffect(() => {
    if (pendingDecisionRef.current) {
      const decision = pendingDecisionRef.current;
      pendingDecisionRef.current = null;
      onDecision(decision);
    }
  });

  const questions =
    (toolInput as unknown as AskUserQuestionInput)?.questions || [];
  const currentQuestion = questions[questionState.currentQuestionIndex];

  const getAutoOptionText = () => {
    if (toolName === EXIT_PLAN_MODE_TOOL_NAME) {
      return "Yes, auto-accept edits";
    }
    if (toolName === BASH_TOOL_NAME) {
      const command = (toolInput?.command as string) || "";
      if (command.trim().startsWith("mkdir")) {
        return "Yes, and auto-accept edits";
      }
      if (suggestedPrefix) {
        return `Yes, and don't ask again for: ${suggestedPrefix}`;
      }
      return "Yes, and don't ask again for this command in this workdir";
    }
    if (toolName.startsWith("mcp__")) {
      return `Yes, and don't ask again for: ${toolName}`;
    }
    return "Yes, and auto-accept edits";
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (toolName === ASK_USER_QUESTION_TOOL_NAME) {
      if (!currentQuestion) return;
      const options = [...currentQuestion.options, { label: "Other" }];
      const isMultiSelect = currentQuestion.multiSelect;

      if (key.return) {
        questionDispatch({
          type: "CONFIRM_ANSWER",
          questions,
          pendingDecisionRef,
        });
        return;
      }

      if (input === " ") {
        if (isMultiSelect) {
          questionDispatch({
            type: "TOGGLE_CURRENT_OPTION_INDEX",
          });
        }
        // If it's other and focused, we don't return here, allowing the input handler below to handle it
      }

      if (key.upArrow) {
        questionDispatch({
          type: "SELECT_OPTION_INDEX_DELTA",
          delta: -1,
        });
        return;
      }
      if (key.downArrow) {
        questionDispatch({
          type: "SELECT_OPTION_INDEX_DELTA",
          delta: 1,
          maxOptions: options.length,
        });
        return;
      }
      if (key.tab) {
        questionDispatch({
          type: "NAVIGATE_QUESTION",
          direction: key.shift ? -1 : 1,
          questions,
        });
        return;
      }

      // Handle cursor and text input for Other field - checks done in reducer to handle batched dispatches
      if (key.leftArrow) {
        questionDispatch({
          type: "MOVE_OTHER_CURSOR",
          cursorPosition: -1,
          maxOptions: options.length,
        });
        return;
      }
      if (key.rightArrow) {
        questionDispatch({
          type: "MOVE_OTHER_CURSOR",
          cursorPosition: 1,
          maxOptions: options.length,
        });
        return;
      }

      // Handle character input for Other text field - check inside reducer to handle batched dispatches
      if (input && !key.ctrl && !key.meta) {
        questionDispatch({
          type: "INPUT_CHARACTER",
          input,
          optionsCount: options.length,
        });
        return;
      }

      if (key.backspace || key.delete) {
        questionDispatch({
          type: "DELETE_BEFORE_CURSOR_OTHER",
          maxOptions: options.length,
        });
        return;
      }
      return;
    }

    if (key.return) {
      if (state.selectedOption === "clear") {
        onDecision({
          behavior: "allow",
          newPermissionMode: "acceptEdits",
          clearContext: true,
        });
      } else if (state.selectedOption === "allow") {
        if (toolName === EXIT_PLAN_MODE_TOOL_NAME) {
          onDecision({ behavior: "allow", newPermissionMode: "default" });
        } else if (toolName === ENTER_PLAN_MODE_TOOL_NAME) {
          onDecision({ behavior: "allow", newPermissionMode: "plan" });
        } else {
          onDecision({ behavior: "allow" });
        }
      } else if (state.selectedOption === "auto") {
        if (toolName === BASH_TOOL_NAME) {
          const command = (toolInput?.command as string) || "";
          if (command.trim().startsWith("mkdir")) {
            onDecision({ behavior: "allow", newPermissionMode: "acceptEdits" });
          } else {
            const rule = suggestedPrefix
              ? `Bash(${suggestedPrefix})`
              : `Bash(${toolInput?.command})`;
            onDecision({ behavior: "allow", newPermissionRule: rule });
          }
        } else if (toolName === ENTER_PLAN_MODE_TOOL_NAME) {
          onDecision({ behavior: "allow", newPermissionMode: "plan" });
        } else if (toolName.startsWith("mcp__")) {
          onDecision({ behavior: "allow", newPermissionRule: toolName });
        } else {
          onDecision({ behavior: "allow", newPermissionMode: "acceptEdits" });
        }
      } else if (state.alternativeText.trim()) {
        onDecision({ behavior: "deny", message: state.alternativeText.trim() });
      } else if (toolName === ENTER_PLAN_MODE_TOOL_NAME) {
        onDecision({
          behavior: "deny",
          message: "User chose not to enter plan mode",
        });
      }
      return;
    }

    if (state.selectedOption === "alternative") {
      if (key.leftArrow) {
        dispatch({
          type: "MOVE_ALTERNATIVE_CURSOR",
          cursorPosition: -1,
        });
        return;
      }
      if (key.rightArrow) {
        dispatch({
          type: "MOVE_ALTERNATIVE_CURSOR",
          cursorPosition: 1,
        });
        return;
      }
    }

    const availableOptions: ConfirmationSelectorState["selectedOption"][] = [];
    if (toolName === EXIT_PLAN_MODE_TOOL_NAME) availableOptions.push("clear");
    availableOptions.push("allow");
    if (!hidePersistentOption) availableOptions.push("auto");
    availableOptions.push("alternative");

    if (key.upArrow) {
      const currentIndex = availableOptions.indexOf(state.selectedOption);
      if (currentIndex > 0) {
        dispatch({
          type: "SELECT_OPTION",
          option: availableOptions[currentIndex - 1],
        });
      }
      return;
    }

    if (key.downArrow) {
      const currentIndex = availableOptions.indexOf(state.selectedOption);
      if (currentIndex < availableOptions.length - 1) {
        dispatch({
          type: "SELECT_OPTION",
          option: availableOptions[currentIndex + 1],
        });
      }
      return;
    }

    if (key.tab) {
      const currentIndex = availableOptions.indexOf(state.selectedOption);
      const direction = key.shift ? -1 : 1;
      let nextIndex = currentIndex + direction;
      if (nextIndex < 0) nextIndex = availableOptions.length - 1;
      if (nextIndex >= availableOptions.length) nextIndex = 0;
      dispatch({
        type: "SELECT_OPTION",
        option: availableOptions[nextIndex],
      });
      return;
    }

    if (input && !key.ctrl && !key.meta && !("alt" in key && key.alt)) {
      dispatch({
        type: "INPUT_CHARACTER_CONFIRMATION",
        input,
      });
      return;
    }

    if (key.backspace || key.delete) {
      dispatch({
        type: "DELETE_BEFORE_CURSOR_ALT",
      });
      return;
    }
  });

  const placeholderText = "Type here to tell Wave what to change";
  const showPlaceholder =
    state.selectedOption === "alternative" && !state.hasUserInput;

  return (
    <Box flexDirection="column">
      {toolName === ASK_USER_QUESTION_TOOL_NAME &&
        currentQuestion &&
        !isExpanded && (
          <Box flexDirection="column" marginTop={1}>
            <Box marginBottom={1}>
              <Text color={getHeaderColor(currentQuestion.header)} bold>
                {currentQuestion.header.slice(0, 12).toUpperCase()}
              </Text>
              <Box marginLeft={1}>
                <Text bold>{currentQuestion.question}</Text>
              </Box>
            </Box>
            <Box flexDirection="column">
              {[...currentQuestion.options, { label: "Other" }].map(
                (option, index) => {
                  const isSelected =
                    questionState.selectedOptionIndex === index;
                  const isChecked = currentQuestion.multiSelect
                    ? questionState.selectedOptionIndices.has(index)
                    : isSelected;
                  const isOther = index === currentQuestion.options.length;
                  return (
                    <Box key={index}>
                      <Text
                        color={isSelected ? "black" : "white"}
                        backgroundColor={isSelected ? "yellow" : undefined}
                      >
                        {isSelected ? "> " : "  "}
                        {currentQuestion.multiSelect
                          ? isChecked
                            ? "[x] "
                            : "[ ] "
                          : ""}
                        {option.label}
                        {option.description ? ` - ${option.description}` : ""}
                        {isOther && isSelected && (
                          <Text>
                            :{" "}
                            {questionState.otherText ? (
                              <>
                                {questionState.otherText.slice(
                                  0,
                                  questionState.otherCursorPosition,
                                )}
                                <Text backgroundColor="white" color="black">
                                  {questionState.otherText[
                                    questionState.otherCursorPosition
                                  ] || " "}
                                </Text>
                                {questionState.otherText.slice(
                                  questionState.otherCursorPosition + 1,
                                )}
                              </>
                            ) : (
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
              )}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>
                Question {questionState.currentQuestionIndex + 1} of{" "}
                {questions.length} •
                {currentQuestion.multiSelect ? " Space to toggle •" : ""} Use ↑↓
                or Tab to navigate • Enter to confirm
              </Text>
            </Box>
          </Box>
        )}

      {toolName !== ASK_USER_QUESTION_TOOL_NAME && !isExpanded && (
        <>
          <Box marginTop={1}>
            <Text>Do you want to proceed?</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            {toolName === EXIT_PLAN_MODE_TOOL_NAME && (
              <Box key="clear-option">
                <Text
                  color={state.selectedOption === "clear" ? "black" : "white"}
                  backgroundColor={
                    state.selectedOption === "clear" ? "yellow" : undefined
                  }
                  bold={state.selectedOption === "clear"}
                >
                  {state.selectedOption === "clear" ? "> " : "  "}
                  Yes, clear context and auto-accept edits
                </Text>
              </Box>
            )}
            <Box key="allow-option">
              <Text
                color={state.selectedOption === "allow" ? "black" : "white"}
                backgroundColor={
                  state.selectedOption === "allow" ? "yellow" : undefined
                }
                bold={state.selectedOption === "allow"}
              >
                {state.selectedOption === "allow" ? "> " : "  "}
                {toolName === EXIT_PLAN_MODE_TOOL_NAME
                  ? "Yes, manually approve edits"
                  : "Yes, proceed"}
              </Text>
            </Box>
            {!hidePersistentOption && (
              <Box key="auto-option">
                <Text
                  color={state.selectedOption === "auto" ? "black" : "white"}
                  backgroundColor={
                    state.selectedOption === "auto" ? "yellow" : undefined
                  }
                  bold={state.selectedOption === "auto"}
                >
                  {state.selectedOption === "auto" ? "> " : "  "}
                  {getAutoOptionText()}
                </Text>
              </Box>
            )}
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
                {toolName === ENTER_PLAN_MODE_TOOL_NAME && showPlaceholder ? (
                  <Text color="gray" dimColor>
                    No, start implementing now
                  </Text>
                ) : showPlaceholder ? (
                  <Text color="gray" dimColor>
                    {placeholderText}
                  </Text>
                ) : (
                  <Text>
                    {state.alternativeText ? (
                      <>
                        {state.alternativeText.slice(
                          0,
                          state.alternativeCursorPosition,
                        )}
                        <Text backgroundColor="white" color="black">
                          {state.alternativeText[
                            state.alternativeCursorPosition
                          ] || " "}
                        </Text>
                        {state.alternativeText.slice(
                          state.alternativeCursorPosition + 1,
                        )}
                      </>
                    ) : (
                      "Type here to tell Wave what to change"
                    )}
                  </Text>
                )}
              </Text>
            </Box>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Use ↑↓ or Tab to navigate • ESC to cancel</Text>
          </Box>
        </>
      )}
    </Box>
  );
};

ConfirmationSelector.displayName = "ConfirmationSelector";
