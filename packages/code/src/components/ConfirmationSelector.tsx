import React, { useEffect, useReducer, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionDecision, AskUserQuestionInput } from "wave-agent-sdk";
import {
  BASH_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
} from "wave-agent-sdk";

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

interface ConfirmationState {
  selectedOption: "clear" | "auto" | "allow" | "alternative";
  alternativeText: string;
  alternativeCursorPosition: number;
  hasUserInput: boolean;
}

type ConfirmationAction =
  | { type: "SELECT_OPTION"; option: ConfirmationState["selectedOption"] }
  | { type: "UPDATE_ALTERNATIVE_TEXT"; text: string; cursorPosition: number }
  | { type: "INPUT_CHARACTER_CONFIRMATION"; input: string }
  | { type: "DELETE_BEFORE_CURSOR_ALT" }
  | { type: "MOVE_ALTERNATIVE_CURSOR"; cursorPosition: number }
  | { type: "SET_HAS_USER_INPUT"; hasUserInput: boolean };

function confirmationReducer(
  state: ConfirmationState,
  action: ConfirmationAction,
): ConfirmationState {
  switch (action.type) {
    case "SELECT_OPTION":
      return { ...state, selectedOption: action.option };
    case "UPDATE_ALTERNATIVE_TEXT":
      return {
        ...state,
        selectedOption: "alternative",
        alternativeText: action.text,
        alternativeCursorPosition: action.cursorPosition,
        hasUserInput: true,
      };
    case "MOVE_ALTERNATIVE_CURSOR": {
      const delta = action.cursorPosition;
      const newPos = state.alternativeCursorPosition + delta;
      return {
        ...state,
        alternativeCursorPosition: Math.max(
          0,
          Math.min(state.alternativeText.length, newPos),
        ),
      };
    }
    case "INPUT_CHARACTER_CONFIRMATION": {
      const text =
        state.alternativeText.slice(0, state.alternativeCursorPosition) +
        action.input +
        state.alternativeText.slice(state.alternativeCursorPosition);
      return {
        ...state,
        selectedOption: "alternative",
        alternativeText: text,
        alternativeCursorPosition:
          state.alternativeCursorPosition + action.input.length,
        hasUserInput: true,
      };
    }
    case "DELETE_BEFORE_CURSOR_ALT": {
      if (state.alternativeCursorPosition <= 0) return state;
      const text =
        state.alternativeText.slice(0, state.alternativeCursorPosition - 1) +
        state.alternativeText.slice(state.alternativeCursorPosition);
      return {
        ...state,
        selectedOption: "alternative",
        alternativeText: text,
        alternativeCursorPosition: state.alternativeCursorPosition - 1,
        hasUserInput: text.length > 0,
      };
    }
    case "SET_HAS_USER_INPUT":
      return { ...state, hasUserInput: action.hasUserInput };
    default:
      return state;
  }
}

interface QuestionState {
  currentQuestionIndex: number;
  selectedOptionIndex: number;
  selectedOptionIndices: Set<number>;
  userAnswers: Record<string, string>;
  otherText: string;
  otherCursorPosition: number;
  savedStates: Record<
    number,
    {
      selectedOptionIndex: number;
      selectedOptionIndices: Set<number>;
      otherText: string;
      otherCursorPosition: number;
    }
  >;
}

type QuestionAction =
  | { type: "SELECT_OPTION_INDEX"; index: number }
  | { type: "SELECT_OPTION_INDEX_DELTA"; delta: number; maxOptions?: number }
  | { type: "TOGGLE_CURRENT_OPTION_INDEX" }
  | { type: "UPDATE_OTHER_TEXT"; text: string; cursorPosition: number }
  | { type: "APPEND_OTHER_TEXT"; input: string }
  | { type: "INPUT_CHARACTER"; input: string; optionsCount: number }
  | { type: "DELETE_BEFORE_CURSOR_OTHER"; maxOptions?: number }
  | { type: "MOVE_OTHER_CURSOR"; cursorPosition: number; maxOptions?: number }
  | {
      type: "NAVIGATE_QUESTION";
      direction: number;
      questions: Array<{
        question: string;
        options: Array<{ label: string }>;
        multiSelect?: boolean;
      }>;
    }
  | {
      type: "CONFIRM_ANSWER";
      questions: Array<{
        question: string;
        options: Array<{ label: string }>;
        multiSelect?: boolean;
      }>;
      pendingDecisionRef: React.MutableRefObject<PermissionDecision | null>;
    }
  | { type: "SET_QUESTION_STATE"; state: Partial<QuestionState> };

function questionReducer(
  state: QuestionState,
  action: QuestionAction,
): QuestionState {
  switch (action.type) {
    case "SELECT_OPTION_INDEX":
      return { ...state, selectedOptionIndex: action.index };
    case "SELECT_OPTION_INDEX_DELTA": {
      const newIndex = state.selectedOptionIndex + action.delta;
      const maxIndex = (action.maxOptions ?? Infinity) - 1;
      return {
        ...state,
        selectedOptionIndex: Math.max(0, Math.min(maxIndex, newIndex)),
      };
    }
    case "TOGGLE_CURRENT_OPTION_INDEX": {
      const nextIndices = new Set(state.selectedOptionIndices);
      if (nextIndices.has(state.selectedOptionIndex)) {
        nextIndices.delete(state.selectedOptionIndex);
      } else {
        nextIndices.add(state.selectedOptionIndex);
      }
      return { ...state, selectedOptionIndices: nextIndices };
    }
    case "UPDATE_OTHER_TEXT":
      return {
        ...state,
        otherText: action.text,
        otherCursorPosition: action.cursorPosition,
      };
    case "INPUT_CHARACTER": {
      const otherIdx = (action.optionsCount || 0) - 1;
      if (state.selectedOptionIndex !== otherIdx) return state;
      const text =
        state.otherText.slice(0, state.otherCursorPosition) +
        action.input +
        state.otherText.slice(state.otherCursorPosition);
      return {
        ...state,
        otherText: text,
        otherCursorPosition: state.otherCursorPosition + action.input.length,
      };
    }
    case "APPEND_OTHER_TEXT": {
      const text =
        state.otherText.slice(0, state.otherCursorPosition) +
        action.input +
        state.otherText.slice(state.otherCursorPosition);
      return {
        ...state,
        otherText: text,
        otherCursorPosition: state.otherCursorPosition + action.input.length,
      };
    }
    case "DELETE_BEFORE_CURSOR_OTHER": {
      const otherIdx = (action.maxOptions ?? 0) - 1;
      if (state.selectedOptionIndex !== otherIdx) return state;
      if (state.otherCursorPosition <= 0) return state;
      return {
        ...state,
        otherText:
          state.otherText.slice(0, state.otherCursorPosition - 1) +
          state.otherText.slice(state.otherCursorPosition),
        otherCursorPosition: state.otherCursorPosition - 1,
      };
    }
    case "MOVE_OTHER_CURSOR": {
      const otherIdx = (action.maxOptions ?? 0) - 1;
      if (state.selectedOptionIndex !== otherIdx) return state;
      const delta = action.cursorPosition;
      const newPos = state.otherCursorPosition + delta;
      return {
        ...state,
        otherCursorPosition: Math.max(
          0,
          Math.min(state.otherText.length, newPos),
        ),
      };
    }
    case "NAVIGATE_QUESTION": {
      const questions = action.questions;
      let nextIndex = state.currentQuestionIndex + action.direction;
      if (nextIndex < 0) nextIndex = questions.length - 1;
      if (nextIndex >= questions.length) nextIndex = 0;

      if (nextIndex === state.currentQuestionIndex) return state;

      const savedStates = {
        ...state.savedStates,
        [state.currentQuestionIndex]: {
          selectedOptionIndex: state.selectedOptionIndex,
          selectedOptionIndices: state.selectedOptionIndices,
          otherText: state.otherText,
          otherCursorPosition: state.otherCursorPosition,
        },
      };

      const nextState = savedStates[nextIndex] || {
        selectedOptionIndex: 0,
        selectedOptionIndices: new Set<number>(),
        otherText: "",
        otherCursorPosition: 0,
      };

      return {
        ...state,
        currentQuestionIndex: nextIndex,
        ...nextState,
        savedStates,
      };
    }
    case "CONFIRM_ANSWER": {
      const questions = action.questions;
      const currentQuestion = questions[state.currentQuestionIndex];
      if (!currentQuestion) return state;

      const options = [...currentQuestion.options, { label: "Other" }];
      const isOtherFocused = state.selectedOptionIndex === options.length - 1;
      let answer = "";
      if (currentQuestion.multiSelect) {
        const selectedLabels = Array.from(state.selectedOptionIndices)
          .filter((i) => i < currentQuestion.options.length)
          .map((i) => currentQuestion.options[i].label);
        const isOtherChecked = state.selectedOptionIndices.has(
          options.length - 1,
        );
        if (isOtherChecked && state.otherText.trim()) {
          selectedLabels.push(state.otherText.trim());
        }
        answer = selectedLabels.join(", ");
      } else {
        if (isOtherFocused) {
          answer = state.otherText.trim();
        } else {
          answer = options[state.selectedOptionIndex].label;
        }
      }

      if (!answer) return state;

      const newAnswers = {
        ...state.userAnswers,
        [currentQuestion.question]: answer,
      };

      if (state.currentQuestionIndex < questions.length - 1) {
        const nextIndex = state.currentQuestionIndex + 1;
        const savedStates = {
          ...state.savedStates,
          [state.currentQuestionIndex]: {
            selectedOptionIndex: state.selectedOptionIndex,
            selectedOptionIndices: state.selectedOptionIndices,
            otherText: state.otherText,
            otherCursorPosition: state.otherCursorPosition,
          },
        };

        const nextState = savedStates[nextIndex] || {
          selectedOptionIndex: 0,
          selectedOptionIndices: new Set<number>(),
          otherText: "",
          otherCursorPosition: 0,
        };

        return {
          ...state,
          currentQuestionIndex: nextIndex,
          ...nextState,
          userAnswers: newAnswers,
          savedStates,
        };
      } else {
        const finalAnswers = { ...newAnswers };
        for (const [idxStr, s] of Object.entries(state.savedStates)) {
          const idx = parseInt(idxStr);
          const q = questions[idx];
          if (q && !finalAnswers[q.question]) {
            const opts = [...q.options, { label: "Other" }];
            let a = "";
            if (q.multiSelect) {
              const selectedLabels = Array.from(s.selectedOptionIndices)
                .filter((i) => i < q.options.length)
                .map((i) => q.options[i].label);
              const isOtherChecked = s.selectedOptionIndices.has(
                opts.length - 1,
              );
              if (isOtherChecked && s.otherText.trim()) {
                selectedLabels.push(s.otherText.trim());
              }
              a = selectedLabels.join(", ");
            } else {
              if (s.selectedOptionIndex === opts.length - 1) {
                a = s.otherText.trim();
              } else {
                a = opts[s.selectedOptionIndex].label;
              }
            }
            if (a) finalAnswers[q.question] = a;
          }
        }

        const allAnswered = questions.every((q) => finalAnswers[q.question]);
        if (!allAnswered) return state;

        action.pendingDecisionRef.current = {
          behavior: "allow",
          message: JSON.stringify(finalAnswers),
        };
        return {
          ...state,
          userAnswers: finalAnswers,
        };
      }
    }
    case "SET_QUESTION_STATE":
      return { ...state, ...action.state };
    default:
      return state;
  }
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

    const availableOptions: ConfirmationState["selectedOption"][] = [];
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
