import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

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
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev === 1 ? 0 : 1));
    }
    if (key.return) {
      if (selectedIndex === 0) {
        onKeep();
      } else {
        onRemove();
      }
    }
    if (key.escape) {
      onCancel();
    }
  });

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
