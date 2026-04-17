import React, { useEffect, useRef, useState } from "react";
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

export const ConfirmationSelector: React.FC<ConfirmationSelectorProps> = ({
  toolName,
  toolInput,
  suggestedPrefix,
  hidePersistentOption,
  isExpanded = false,
  onDecision,
  onCancel,
}) => {
  const [state, setState] = useState<ConfirmationState>({
    selectedOption: toolName === EXIT_PLAN_MODE_TOOL_NAME ? "clear" : "allow",
    alternativeText: "",
    alternativeCursorPosition: 0,
    hasUserInput: false,
  });

  const [questionState, setQuestionState] = useState({
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
        setQuestionState((prev) => {
          const isOtherFocused =
            prev.selectedOptionIndex === options.length - 1;
          let answer = "";
          if (isMultiSelect) {
            const selectedLabels = Array.from(prev.selectedOptionIndices)
              .filter((i) => i < currentQuestion.options.length)
              .map((i) => currentQuestion.options[i].label);
            const isOtherChecked = prev.selectedOptionIndices.has(
              options.length - 1,
            );
            if (isOtherChecked && prev.otherText.trim()) {
              selectedLabels.push(prev.otherText.trim());
            }
            answer = selectedLabels.join(", ");
          } else {
            if (isOtherFocused) {
              answer = prev.otherText.trim();
            } else {
              answer = options[prev.selectedOptionIndex].label;
            }
          }

          if (!answer) return prev;

          const newAnswers = {
            ...prev.userAnswers,
            [currentQuestion.question]: answer,
          };

          if (prev.currentQuestionIndex < questions.length - 1) {
            const nextIndex = prev.currentQuestionIndex + 1;
            const savedStates = {
              ...prev.savedStates,
              [prev.currentQuestionIndex]: {
                selectedOptionIndex: prev.selectedOptionIndex,
                selectedOptionIndices: prev.selectedOptionIndices,
                otherText: prev.otherText,
                otherCursorPosition: prev.otherCursorPosition,
              },
            };

            const nextState = savedStates[nextIndex] || {
              selectedOptionIndex: 0,
              selectedOptionIndices: new Set<number>(),
              otherText: "",
              otherCursorPosition: 0,
            };

            return {
              ...prev,
              currentQuestionIndex: nextIndex,
              ...nextState,
              userAnswers: newAnswers,
              savedStates,
            };
          } else {
            const finalAnswers = { ...newAnswers };
            // Also collect from savedStates for any questions that were skipped via Tab
            for (const [idxStr, s] of Object.entries(prev.savedStates)) {
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

            // Only submit if all questions have been answered
            const allAnswered = questions.every(
              (q) => finalAnswers[q.question],
            );
            if (!allAnswered) return prev;

            pendingDecisionRef.current = {
              behavior: "allow",
              message: JSON.stringify(finalAnswers),
            };
            return {
              ...prev,
              userAnswers: finalAnswers,
            };
          }
        });
        return;
      }

      if (input === " ") {
        setQuestionState((prev) => {
          const isOtherFocused =
            prev.selectedOptionIndex === options.length - 1;
          if (
            isMultiSelect &&
            (!isOtherFocused ||
              !prev.selectedOptionIndices.has(prev.selectedOptionIndex))
          ) {
            const nextIndices = new Set(prev.selectedOptionIndices);
            if (nextIndices.has(prev.selectedOptionIndex))
              nextIndices.delete(prev.selectedOptionIndex);
            else nextIndices.add(prev.selectedOptionIndex);
            return {
              ...prev,
              selectedOptionIndices: nextIndices,
            };
          }
          return prev;
        });
        // If it's other and focused, we don't return here, allowing the input handler below to handle it
      }

      if (key.upArrow) {
        setQuestionState((prev) => ({
          ...prev,
          selectedOptionIndex: Math.max(0, prev.selectedOptionIndex - 1),
        }));
        return;
      }
      if (key.downArrow) {
        setQuestionState((prev) => ({
          ...prev,
          selectedOptionIndex: Math.min(
            options.length - 1,
            prev.selectedOptionIndex + 1,
          ),
        }));
        return;
      }
      if (key.tab) {
        setQuestionState((prev) => {
          const direction = key.shift ? -1 : 1;
          let nextIndex = prev.currentQuestionIndex + direction;
          if (nextIndex < 0) nextIndex = questions.length - 1;
          if (nextIndex >= questions.length) nextIndex = 0;

          if (nextIndex === prev.currentQuestionIndex) return prev;

          const savedStates = {
            ...prev.savedStates,
            [prev.currentQuestionIndex]: {
              selectedOptionIndex: prev.selectedOptionIndex,
              selectedOptionIndices: prev.selectedOptionIndices,
              otherText: prev.otherText,
              otherCursorPosition: prev.otherCursorPosition,
            },
          };

          const nextState = savedStates[nextIndex] || {
            selectedOptionIndex: 0,
            selectedOptionIndices: new Set<number>(),
            otherText: "",
            otherCursorPosition: 0,
          };

          return {
            ...prev,
            currentQuestionIndex: nextIndex,
            ...nextState,
            savedStates,
          };
        });
        return;
      }

      setQuestionState((prev) => {
        const isOtherFocused = prev.selectedOptionIndex === options.length - 1;
        if (isOtherFocused) {
          if (key.leftArrow) {
            return {
              ...prev,
              otherCursorPosition: Math.max(0, prev.otherCursorPosition - 1),
            };
          }
          if (key.rightArrow) {
            return {
              ...prev,
              otherCursorPosition: Math.min(
                prev.otherText.length,
                prev.otherCursorPosition + 1,
              ),
            };
          }
          if (key.backspace || key.delete) {
            if (prev.otherCursorPosition > 0) {
              return {
                ...prev,
                otherText:
                  prev.otherText.slice(0, prev.otherCursorPosition - 1) +
                  prev.otherText.slice(prev.otherCursorPosition),
                otherCursorPosition: prev.otherCursorPosition - 1,
              };
            }
          }
          if (input && !key.ctrl && !key.meta) {
            return {
              ...prev,
              otherText:
                prev.otherText.slice(0, prev.otherCursorPosition) +
                input +
                prev.otherText.slice(prev.otherCursorPosition),
              otherCursorPosition: prev.otherCursorPosition + input.length,
            };
          }
        }
        return prev;
      });
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
    availableOptions.push("allow");
    if (!hidePersistentOption) availableOptions.push("auto");
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

    if (key.tab) {
      const currentIndex = availableOptions.indexOf(state.selectedOption);
      const direction = key.shift ? -1 : 1;
      let nextIndex = currentIndex + direction;
      if (nextIndex < 0) nextIndex = availableOptions.length - 1;
      if (nextIndex >= availableOptions.length) nextIndex = 0;
      setState((prev) => ({
        ...prev,
        selectedOption: availableOptions[nextIndex],
      }));
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
