import React, { useEffect, useMemo, useReducer } from "react";
import { Box, Text, useInput, usePaste, useWindowSize } from "ink";
import type { Key } from "ink";
import type {
  PermissionDecision,
  PermissionMode,
  AskUserQuestionInput,
} from "wave-agent-sdk";
import {
  EDIT_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  WRITE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  isShellToolName,
} from "wave-agent-sdk";
import { confirmationReducer } from "../reducers/confirmationReducer.js";
import {
  isPreviewQuestion,
  questionReducer,
} from "../reducers/questionReducer.js";
import { renderMarkdownToAnsi } from "./Markdown.js";

/** Fixed width of the option list when a question is in preview mode. */
const PREVIEW_LEFT_WIDTH = 30;
/** Blank columns between the option list and the preview panel. */
const PREVIEW_GAP = 4;
const PREVIEW_MIN_WIDTH = 20;
/** Shown when the focused option carries no preview (or only whitespace). */
const NO_PREVIEW_PLACEHOLDER = "(这个选项没有预览)";

/**
 * A preview panel: markdown rendered to ANSI, framed with a top and a bottom
 * rule only (CLI components never draw side borders). Content longer than
 * `maxLines` is truncated with a "N more lines" rule, matching Claude Code's
 * CLI preview box.
 */
const OptionPreview: React.FC<{
  content: string;
  width: number;
  maxLines: number;
}> = ({ content, width, maxLines }) => {
  const isPlaceholder = content.trim() === "";
  const lines = useMemo(
    () =>
      isPlaceholder
        ? [NO_PREVIEW_PLACEHOLDER]
        : renderMarkdownToAnsi(content, width).split("\n"),
    [content, width, isPlaceholder],
  );
  const hidden = Math.max(0, lines.length - maxLines);
  const shown = hidden > 0 ? lines.slice(0, maxLines) : lines;
  const rule = "─".repeat(Math.max(1, width));

  return (
    <Box flexDirection="column">
      {/* Every row is `truncate`: a preview line must never wrap, or the panel
          shifts the rows below it (the cut-off marker used to wrap its trailing
          padding onto a second line and push the bottom rule down). */}
      <Text dimColor wrap="truncate">
        {rule}
      </Text>
      {shown.map((line, index) => (
        <Text key={index} dimColor={isPlaceholder} wrap="truncate">
          {line || " "}
        </Text>
      ))}
      {hidden > 0 && (
        <Text dimColor wrap="truncate">
          {`─── ✂ 还有 ${hidden} 行`}
        </Text>
      )}
      <Text dimColor wrap="truncate">
        {rule}
      </Text>
    </Box>
  );
};

const getHeaderColor = (header: string) => {
  const colors = ["red", "green", "blue", "magenta", "cyan"] as const;
  let hash = 0;
  for (let i = 0; i < header.length; i++) {
    hash = header.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

/** Last path segment of a directory path (handles both `/` and `\` separators). */
const lastPathSegment = (dirPath: string): string => {
  const segments = dirPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? dirPath;
};

export interface ConfirmationSelectorProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  /** Directory holding an out-of-Safe-Zone Write/Edit target, when the host reports one. */
  outsideSafeZoneDirectory?: string;
  permissionMode?: PermissionMode;
  isExpanded?: boolean;
  onDecision: (decision: PermissionDecision) => void;
  onCancel: () => void;
}

export const ConfirmationSelector: React.FC<ConfirmationSelectorProps> = ({
  toolName,
  toolInput,
  suggestedPrefix,
  hidePersistentOption,
  outsideSafeZoneDirectory,
  permissionMode,
  isExpanded = false,
  onDecision,
  onCancel,
}) => {
  const [state, dispatch] = useReducer(confirmationReducer, {
    selectedOption: "allow",
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
    notesText: "",
    notesCursorPosition: 0,
    isEditingNotes: false,
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
    if (isShellToolName(toolName)) {
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

  // Only Write/Edit can be out of the Safe Zone, and the host only reports the
  // directory for such requests.
  const showAddDirectoryOption =
    (toolName === EDIT_TOOL_NAME || toolName === WRITE_TOOL_NAME) &&
    !!outsideSafeZoneDirectory;
  const addDirectoryOptionText = `Yes, and allow all edits in ${lastPathSegment(
    outsideSafeZoneDirectory ?? "",
  )}/ this session`;

  const dispatchInput = (input: string, key: Key) => {
    if (toolName === ASK_USER_QUESTION_TOOL_NAME) {
      questionDispatch({
        type: "HANDLE_KEY",
        input,
        key,
        questions,
      });
      return;
    }
    dispatch({
      type: "HANDLE_KEY",
      input,
      key,
      toolName,
      toolInput,
      suggestedPrefix,
      hidePersistentOption,
      outsideSafeZoneDirectory,
      permissionMode,
    });
  };

  useInput((input, key) => {
    // Esc leaves the notes field first; only outside it does it cancel the
    // whole prompt.
    if (key.escape && !questionState.isEditingNotes) {
      onCancel();
      return;
    }
    dispatchInput(input, key);
  });

  // A pasted string arrives here as one chunk with no key flags, so it can fill
  // an answer/instruction field but never confirm the decision itself.
  usePaste((text) => {
    dispatchInput(text, {} as Key);
  });

  const placeholderText = "Type here to tell Wave what to change";
  const showPlaceholder =
    state.selectedOption === "alternative" && !state.hasUserInput;

  // Terminal budget for the side-by-side layout: the left column is fixed so
  // the option list cannot shift the preview, and the preview gets whatever
  // width is left. Rows for the header, options, notes and hint are reserved
  // before handing the rest to the preview content.
  const { rows, columns } = useWindowSize();
  const previewQuestion =
    !!currentQuestion && isPreviewQuestion(currentQuestion);
  const leftWidth = Math.min(
    PREVIEW_LEFT_WIDTH,
    Math.max(12, columns - PREVIEW_MIN_WIDTH - PREVIEW_GAP),
  );
  const previewWidth = Math.max(
    PREVIEW_MIN_WIDTH,
    columns - leftWidth - PREVIEW_GAP,
  );
  const previewMaxLines = Math.max(3, Math.min(20, rows - 16));
  const activeOption =
    previewQuestion && currentQuestion
      ? currentQuestion.options[questionState.selectedOptionIndex]
      : undefined;
  const activePreview =
    typeof activeOption?.preview === "string" ? activeOption.preview : "";

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
            <Box flexDirection={previewQuestion ? "row" : "column"}>
              <Box
                flexDirection="column"
                width={previewQuestion ? leftWidth : undefined}
              >
                {(previewQuestion
                  ? currentQuestion.options
                  : [...currentQuestion.options, { label: "Other" }]
                ).map((option, index) => {
                  const isSelected =
                    questionState.selectedOptionIndex === index;
                  const isChecked = currentQuestion.multiSelect
                    ? questionState.selectedOptionIndices.has(index)
                    : isSelected;
                  const isOther = index === currentQuestion.options.length;
                  const isPreview = previewQuestion;
                  return (
                    <Box key={index}>
                      <Text
                        color={isSelected ? "black" : "white"}
                        backgroundColor={isSelected ? "yellow" : undefined}
                        wrap={isPreview ? "truncate" : undefined}
                      >
                        {isSelected ? "> " : "  "}
                        {currentQuestion.multiSelect
                          ? isChecked
                            ? "[x] "
                            : "[ ] "
                          : ""}
                        {/* Preview questions number their options so the label
                            never has to shout; the plain list keeps its
                            existing shape. */}
                        {isPreview ? `${index + 1}. ` : ""}
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
                })}
              </Box>
              {previewQuestion && (
                <Box
                  flexDirection="column"
                  marginLeft={PREVIEW_GAP}
                  flexGrow={1}
                >
                  <OptionPreview
                    content={activePreview}
                    width={previewWidth}
                    maxLines={previewMaxLines}
                  />
                  <Box marginTop={1}>
                    <Text color="cyan">Notes: </Text>
                    {questionState.isEditingNotes ? (
                      <Text
                        wrap="truncate"
                        backgroundColor="black"
                        color="white"
                      >
                        {questionState.notesText.slice(
                          0,
                          questionState.notesCursorPosition,
                        )}
                        <Text backgroundColor="white" color="black">
                          {questionState.notesText[
                            questionState.notesCursorPosition
                          ] || " "}
                        </Text>
                        {questionState.notesText.slice(
                          questionState.notesCursorPosition + 1,
                        )}
                      </Text>
                    ) : (
                      <Text dimColor>
                        {questionState.notesText || "press n to add notes"}
                      </Text>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>
                Question {questionState.currentQuestionIndex + 1} of{" "}
                {questions.length} •
                {currentQuestion.multiSelect ? " Space to toggle •" : ""}
                {previewQuestion
                  ? questionState.isEditingNotes
                    ? " Enter or Esc to leave notes • Ctrl+C to cancel"
                    : ` Enter to select • ↑↓ to navigate • n to add notes${
                        questions.length > 1 ? " • Tab to switch questions" : ""
                      } • Esc to cancel`
                  : " Use ↑↓ or Tab to navigate • Enter to confirm"}
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
            {showAddDirectoryOption && (
              <Box key="add-directory-option">
                <Text
                  color={
                    state.selectedOption === "addDirectory" ? "black" : "white"
                  }
                  backgroundColor={
                    state.selectedOption === "addDirectory"
                      ? "yellow"
                      : undefined
                  }
                  bold={state.selectedOption === "addDirectory"}
                >
                  {state.selectedOption === "addDirectory" ? "> " : "  "}
                  {addDirectoryOptionText}
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
            {(toolName === EXIT_PLAN_MODE_TOOL_NAME ||
              (isShellToolName(toolName) && permissionMode !== "plan")) && (
              <Box key="bypass-option">
                <Text
                  color={state.selectedOption === "bypass" ? "black" : "white"}
                  backgroundColor={
                    state.selectedOption === "bypass" ? "yellow" : undefined
                  }
                  bold={state.selectedOption === "bypass"}
                >
                  {state.selectedOption === "bypass" ? "> " : "  "}
                  Yes, and bypass permissions
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
