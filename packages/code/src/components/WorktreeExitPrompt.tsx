import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { selectorReducer } from "../reducers/selectorReducer.js";

interface WorktreeExitPromptProps {
  name: string;
  path: string;
  hasUncommittedChanges: boolean;
  hasNewCommits: boolean;
  onKeep: () => void;
  onRemove: () => void;
  onCancel: () => void;
}

export const WorktreeExitPrompt: React.FC<WorktreeExitPromptProps> = ({
  name,
  path: worktreePath,
  hasUncommittedChanges,
  hasNewCommits,
  onKeep,
  onRemove,
  onCancel,
}) => {
  const [state, dispatch] = useReducer(selectorReducer, {
    selectedIndex: 0,
    pendingDecision: null,
  });

  const { selectedIndex, pendingDecision } = state;

  useInput((_input, key) => {
    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: 1,
      hasInsert: false,
    });
  });

  useEffect(() => {
    if (pendingDecision === "select") {
      if (selectedIndex === 0) {
        onKeep();
      } else {
        onRemove();
      }
      dispatch({ type: "CLEAR_DECISION" });
    } else if (pendingDecision === "cancel") {
      onCancel();
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [pendingDecision, selectedIndex, onKeep, onRemove, onCancel]);

  return (
    <Box flexDirection="column" paddingX={1} marginY={1}>
      <Box marginBottom={1}>
        <Text bold>Exiting worktree session</Text>
      </Box>
      <Box marginBottom={1}>
        {hasUncommittedChanges && hasNewCommits ? (
          <Text>
            You have uncommitted changes and new commits. These will be lost if
            you remove the worktree.
          </Text>
        ) : hasUncommittedChanges ? (
          <Text>
            You have uncommitted changes. These will be lost if you remove the
            worktree.
          </Text>
        ) : (
          <Text>
            You have new commits on worktree-{name}. The branch will be deleted
            if you remove the worktree.
          </Text>
        )}
      </Box>
      <Box flexDirection="column">
        <Box>
          <Text color={selectedIndex === 0 ? "cyan" : undefined}>
            {selectedIndex === 0 ? "❯ " : "  "}Keep worktree Stays at{" "}
            {worktreePath}
          </Text>
        </Box>
        <Box>
          <Text color={selectedIndex === 1 ? "cyan" : undefined}>
            {selectedIndex === 1 ? "❯ " : "  "}Remove worktree All changes and
            commits will be lost.
          </Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter to confirm · Esc to cancel</Text>
      </Box>
    </Box>
  );
};
