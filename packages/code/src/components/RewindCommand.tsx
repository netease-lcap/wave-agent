import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Message } from "wave-agent-sdk";
import { getMessageContent } from "wave-agent-sdk";

export interface RewindCommandProps {
  messages: Message[];
  onSelect: (index: number) => void;
  onCancel: () => void;
  getFullMessageThread?: () => Promise<{
    messages: Message[];
    sessionIds: string[];
  }>;
}

export const RewindCommand: React.FC<RewindCommandProps> = ({
  messages: initialMessages,
  onSelect,
  onCancel,
  getFullMessageThread,
}) => {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(!!getFullMessageThread);

  React.useEffect(() => {
    if (getFullMessageThread) {
      getFullMessageThread().then(({ messages: fullMessages }) => {
        setMessages(fullMessages);
        setIsLoading(false);
      });
    }
  }, [getFullMessageThread]);

  // Filter user messages as checkpoints, excluding meta messages
  const checkpoints = messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => msg.role === "user" && !msg.isMeta);

  const MAX_VISIBLE_ITEMS = 3;
  const [selectedIndex, setSelectedIndex] = useState(checkpoints.length - 1);

  // Update selectedIndex when checkpoints change (after loading full thread)
  React.useEffect(() => {
    setSelectedIndex(checkpoints.length - 1);
  }, [checkpoints.length]);

  // Calculate visible window
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, checkpoints.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleCheckpoints = checkpoints.slice(
    startIndex,
    startIndex + MAX_VISIBLE_ITEMS,
  );

  useInput((input, key) => {
    if (key.return) {
      if (checkpoints.length > 0 && selectedIndex >= 0) {
        onSelect(checkpoints[selectedIndex].index);
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(Math.min(checkpoints.length - 1, selectedIndex + 1));
      return;
    }
  });

  if (isLoading) {
    return (
      <Box
        flexDirection="column"
        paddingX={1}
        borderStyle="single"
        borderColor="cyan"
        borderLeft={false}
        borderRight={false}
      >
        <Text color="cyan">Loading full message thread...</Text>
      </Box>
    );
  }

  if (checkpoints.length === 0) {
    return (
      <Box
        flexDirection="column"
        paddingX={1}
        borderStyle="single"
        borderColor="yellow"
        borderLeft={false}
        borderRight={false}
      >
        <Text color="yellow">No user messages found to rewind to.</Text>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      gap={1}
      borderStyle="single"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
    >
      <Box>
        <Text color="cyan" bold>
          Rewind: Select a message to revert to
        </Text>
      </Box>

      <Box flexDirection="column">
        {visibleCheckpoints.map((checkpoint, index) => {
          const actualIndex = startIndex + index;
          const isSelected = actualIndex === selectedIndex;
          const content = getMessageContent(checkpoint.msg)
            .replace(/\n/g, "\\n")
            .substring(0, 60);

          return (
            <Box key={checkpoint.index}>
              <Text
                color={isSelected ? "black" : "white"}
                backgroundColor={isSelected ? "cyan" : undefined}
              >
                {isSelected ? "▶ " : "  "}[{checkpoint.index}]{" "}
                {content || "(No text content)"}
                {actualIndex === checkpoints.length - 1 ? " (Latest)" : ""}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box>
        <Text dimColor>↑↓ navigate • Enter to rewind • Esc to cancel</Text>
      </Box>
      <Box>
        <Text color="red" dimColor>
          Warning: This will delete all subsequent messages and revert file and
          task list changes.
        </Text>
      </Box>
    </Box>
  );
};
