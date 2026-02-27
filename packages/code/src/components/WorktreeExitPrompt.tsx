import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface WorktreeExitPromptProps {
  name: string;
  hasUncommittedChanges: boolean;
  hasNewCommits: boolean;
  onKeep: () => void;
  onRemove: () => void;
  onCancel: () => void;
}

export const WorktreeExitPrompt: React.FC<WorktreeExitPromptProps> = ({
  name,
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
    <Box flexDirection="column" borderStyle="single" borderTop borderBottom borderLeft={false} borderRight={false} paddingX={1} marginY={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">
          ⚠️ Worktree '{name}' has changes:
        </Text>
      </Box>
      {hasUncommittedChanges && (
        <Box marginLeft={2}>
          <Text>- Uncommitted changes detected</Text>
        </Box>
      )}
      {hasNewCommits && (
        <Box marginLeft={2}>
          <Text>- New commits detected</Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text>What would you like to do?</Text>
        <Box marginTop={1}>
          <Text color={selectedIndex === 0 ? 'cyan' : undefined}>
            {selectedIndex === 0 ? '> ' : '  '}Keep worktree (exit CLI, leave worktree and branch intact)
          </Text>
        </Box>
        <Box>
          <Text color={selectedIndex === 1 ? 'cyan' : undefined}>
            {selectedIndex === 1 ? '> ' : '  '}Remove worktree (delete worktree and branch - DATA LOSS!)
          </Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>(Use arrow keys to select, Enter to confirm, Esc to resume session)</Text>
      </Box>
    </Box>
  );
};
