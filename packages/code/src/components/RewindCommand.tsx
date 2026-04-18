import React, { useReducer } from "react";
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

interface RewindState {
  messages: Message[];
  isLoading: boolean;
  selectedIndex: number;
}

type RewindAction =
  | { type: "SET_MESSAGES"; messages: Message[] }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "NAVIGATE_UP" }
  | { type: "NAVIGATE_DOWN"; max: number }
  | { type: "RESET_INDEX"; index: number };

function rewindReducer(state: RewindState, action: RewindAction): RewindState {
  switch (action.type) {
    case "SET_MESSAGES":
      return { ...state, messages: action.messages, isLoading: false };
    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };
    case "NAVIGATE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "NAVIGATE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(action.max, state.selectedIndex + 1),
      };
    case "RESET_INDEX":
      return { ...state, selectedIndex: action.index };
    default:
      return state;
  }
}

export const RewindCommand: React.FC<RewindCommandProps> = ({
  messages: initialMessages,
  onSelect,
  onCancel,
  getFullMessageThread,
}) => {
  const [state, dispatch] = useReducer(rewindReducer, {
    messages: initialMessages,
    isLoading: !!getFullMessageThread,
    selectedIndex: 0,
  });

  React.useEffect(() => {
    if (getFullMessageThread) {
      getFullMessageThread().then(({ messages: fullMessages }) => {
        dispatch({ type: "SET_MESSAGES", messages: fullMessages });
      });
    }
  }, [getFullMessageThread]);

  // Filter user messages as checkpoints, excluding meta messages
  const checkpoints = state.messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => msg.role === "user" && !msg.isMeta);

  const MAX_VISIBLE_ITEMS = 3;

  // Calculate visible window
  const startIndex = Math.max(
    0,
    Math.min(
      state.selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, checkpoints.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleCheckpoints = checkpoints.slice(
    startIndex,
    startIndex + MAX_VISIBLE_ITEMS,
  );

  useInput((input, key) => {
    if (key.return) {
      if (checkpoints.length > 0 && state.selectedIndex >= 0) {
        onSelect(checkpoints[state.selectedIndex].index);
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      dispatch({ type: "NAVIGATE_UP" });
      return;
    }

    if (key.downArrow) {
      dispatch({ type: "NAVIGATE_DOWN", max: checkpoints.length - 1 });
      return;
    }
  });

  if (state.isLoading) {
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
          const isSelected = actualIndex === state.selectedIndex;
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
