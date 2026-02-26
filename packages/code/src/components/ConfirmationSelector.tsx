import React, { useLayoutEffect, useRef, useState } from "react";
import { Box, Text, useInput, useStdout, measureElement } from "ink";
import type { PermissionDecision, AskUserQuestionInput } from "wave-agent-sdk";
import {
  BASH_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
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
  onAbort: () => void;
  onHeightMeasured?: (height: number) => void;
}

interface ConfirmationState {
  selectedOption: "clear" | "auto" | "allow" | "alternative";
  alternativeText: string;
  alternativeCursorPosition: number;
  hasUserInput: boolean;
}

export const ConfirmationSelector: React.FC<ConfirmationSelectorProps> = ({
  toolName,
  toolInput,
  suggestedPrefix,
  hidePersistentOption,
  isExpanded = false,
  onDecision,
  onCancel,
  onAbort,
  onHeightMeasured,
}) => {
  const { stdout } = useStdout();
  const boxRef = useRef(null);

  useLayoutEffect(() => {
    if (boxRef.current) {
      const { height } = measureElement(boxRef.current);
      onHeightMeasured?.(height);
    }
  }, [stdout?.rows, onHeightMeasured, toolName, toolInput, isExpanded]);

  const [state, setState] = useState<ConfirmationState>({
    selectedOption: toolName === EXIT_PLAN_MODE_TOOL_NAME ? "clear" : "allow",
    alternativeText: "",
    alternativeCursorPosition: 0,
    hasUserInput: false,
  });

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [selectedOptionIndices, setSelectedOptionIndices] = useState<
    Set<number>
  >(new Set());
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [otherText, setOtherText] = useState("");
  const [otherCursorPosition, setOtherCursorPosition] = useState(0);

  const questions =
    (toolInput as unknown as AskUserQuestionInput)?.questions || [];
  const currentQuestion = questions[currentQuestionIndex];

  const getAutoOptionText = () => {
    if (toolName === EXIT_PLAN_MODE_TOOL_NAME) {
      return "Yes, auto-accept edits";
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
    if (key.escape) {
      onCancel();
      onAbort();
      return;
    }

    if (toolName === ASK_USER_QUESTION_TOOL_NAME) {
      if (!currentQuestion) return;
      const options = [...currentQuestion.options, { label: "Other" }];
      const isMultiSelect = currentQuestion.multiSelect;
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
          setOtherCursorPosition(0);
        } else {
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
            if (next.has(selectedOptionIndex)) next.delete(selectedOptionIndex);
            else next.add(selectedOptionIndex);
            return next;
          });
          return;
        }
        if (!isOtherFocused) return;
      }

      if (key.upArrow) {
        if (selectedOptionIndex > 0)
          setSelectedOptionIndex(selectedOptionIndex - 1);
        return;
      }
      if (key.downArrow) {
        if (selectedOptionIndex < options.length - 1)
          setSelectedOptionIndex(selectedOptionIndex + 1);
        return;
      }

      if (isOtherFocused) {
        if (key.leftArrow) {
          setOtherCursorPosition((prev) => Math.max(0, prev - 1));
          return;
        }
        if (key.rightArrow) {
          setOtherCursorPosition((prev) =>
            Math.min(otherText.length, prev + 1),
          );
          return;
        }
        if (key.backspace || key.delete) {
          if (otherCursorPosition > 0) {
            setOtherText(
              (prev) =>
                prev.slice(0, otherCursorPosition - 1) +
                prev.slice(otherCursorPosition),
            );
            setOtherCursorPosition((prev) => prev - 1);
          }
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setOtherText(
            (prev) =>
              prev.slice(0, otherCursorPosition) +
              input +
              prev.slice(otherCursorPosition),
          );
          setOtherCursorPosition((prev) => prev + input.length);
          return;
        }
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
        } else {
          onDecision({ behavior: "allow" });
        }
      } else if (state.selectedOption === "auto") {
        if (toolName === BASH_TOOL_NAME) {
          const rule = suggestedPrefix
            ? `Bash(${suggestedPrefix}*)`
            : `Bash(${toolInput?.command})`;
          onDecision({ behavior: "allow", newPermissionRule: rule });
        } else {
          onDecision({ behavior: "allow", newPermissionMode: "acceptEdits" });
        }
      } else if (state.alternativeText.trim()) {
        onDecision({ behavior: "deny", message: state.alternativeText.trim() });
      }
      return;
    }

    if (state.selectedOption === "alternative") {
      if (key.leftArrow) {
        setState((prev) => ({
          ...prev,
          alternativeCursorPosition: Math.max(
            0,
            prev.alternativeCursorPosition - 1,
          ),
        }));
        return;
      }
      if (key.rightArrow) {
        setState((prev) => ({
          ...prev,
          alternativeCursorPosition: Math.min(
            prev.alternativeText.length,
            prev.alternativeCursorPosition + 1,
          ),
        }));
        return;
      }
    }

    const availableOptions: ConfirmationState["selectedOption"][] = [];
    if (toolName === EXIT_PLAN_MODE_TOOL_NAME) availableOptions.push("clear");
    if (!hidePersistentOption) availableOptions.push("auto");
    availableOptions.push("allow");
    availableOptions.push("alternative");

    if (key.upArrow) {
      const currentIndex = availableOptions.indexOf(state.selectedOption);
      if (currentIndex > 0) {
        setState((prev) => ({
          ...prev,
          selectedOption: availableOptions[currentIndex - 1],
        }));
      }
      return;
    }

    if (key.downArrow) {
      const currentIndex = availableOptions.indexOf(state.selectedOption);
      if (currentIndex < availableOptions.length - 1) {
        setState((prev) => ({
          ...prev,
          selectedOption: availableOptions[currentIndex + 1],
        }));
      }
      return;
    }

    if (input && !key.ctrl && !key.meta && !("alt" in key && key.alt)) {
      setState((prev) => {
        const nextText =
          prev.alternativeText.slice(0, prev.alternativeCursorPosition) +
          input +
          prev.alternativeText.slice(prev.alternativeCursorPosition);
        return {
          ...prev,
          selectedOption: "alternative",
          alternativeText: nextText,
          alternativeCursorPosition:
            prev.alternativeCursorPosition + input.length,
          hasUserInput: true,
        };
      });
      return;
    }

    if (key.backspace || key.delete) {
      setState((prev) => {
        if (prev.alternativeCursorPosition > 0) {
          const nextText =
            prev.alternativeText.slice(0, prev.alternativeCursorPosition - 1) +
            prev.alternativeText.slice(prev.alternativeCursorPosition);
          return {
            ...prev,
            selectedOption: "alternative",
            alternativeText: nextText,
            alternativeCursorPosition: prev.alternativeCursorPosition - 1,
            hasUserInput: nextText.length > 0,
          };
        }
        return prev;
      });
      return;
    }
  });

  const placeholderText = "Type here to tell Wave what to change";
  const showPlaceholder =
    state.selectedOption === "alternative" && !state.hasUserInput;

  return (
    <Box ref={boxRef} flexDirection="column">
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
                  const isSelected = selectedOptionIndex === index;
                  const isChecked = currentQuestion.multiSelect
                    ? selectedOptionIndices.has(index)
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
                            {otherText ? (
                              <>
                                {otherText.slice(0, otherCursorPosition)}
                                <Text backgroundColor="white" color="black">
                                  {otherText[otherCursorPosition] || " "}
                                </Text>
                                {otherText.slice(otherCursorPosition + 1)}
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
                Question {currentQuestionIndex + 1} of {questions.length} •
                {currentQuestion.multiSelect ? " Space to toggle •" : ""} Use ↑↓
                to navigate • Enter to confirm
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
                {showPlaceholder ? (
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
            <Text dimColor>Use ↑↓ to navigate • ESC to cancel</Text>
          </Box>
        </>
      )}
    </Box>
  );
};

ConfirmationSelector.displayName = "ConfirmationSelector";
