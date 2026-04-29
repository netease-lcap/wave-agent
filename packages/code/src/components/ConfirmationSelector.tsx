import React, { useEffect, useReducer } from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionDecision, AskUserQuestionInput } from "wave-agent-sdk";
import {
  BASH_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
} from "wave-agent-sdk";
import { confirmationReducer } from "../reducers/confirmationReducer.js";
import { questionReducer } from "../reducers/questionReducer.js";

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
  const [state, dispatch] = useReducer(confirmationReducer, {
    selectedOption: toolName === EXIT_PLAN_MODE_TOOL_NAME ? "clear" : "allow",
    alternativeText: "",
    alternativeCursorPosition: 0,
    hasUserInput: false,
    decision: null,
  });

  const questions =
    (toolInput as unknown as AskUserQuestionInput)?.questions || [];

  const [questionState, questionDispatch] = useReducer(questionReducer, {
    currentQuestionIndex: 0,
    selectedOptionIndex: 0,
    selectedOptionIndices: new Set<number>(),
    userAnswers: {},
    otherText: "",
    otherCursorPosition: 0,
    savedStates: {},
    decision: null,
  });

  // Handle decisions from reducers
  useEffect(() => {
    if (state.decision) {
      onDecision(state.decision);
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [state.decision, onDecision]);

  useEffect(() => {
    if (questionState.decision) {
      onDecision(questionState.decision);
      questionDispatch({ type: "CLEAR_DECISION" });
    }
  }, [questionState.decision, onDecision]);

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
      questionDispatch({
        type: "HANDLE_KEY",
        input,
        key,
        currentQuestion,
        questions,
      });
    } else {
      dispatch({
        type: "HANDLE_KEY",
        input,
        key,
        toolName,
        toolInput,
        suggestedPrefix,
        hidePersistentOption,
      });
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
