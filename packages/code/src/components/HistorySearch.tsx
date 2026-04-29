import React, { useReducer, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { PromptHistoryManager, type PromptEntry } from "wave-agent-sdk";
import {
  selectorReducer,
  type SelectorState,
} from "../reducers/selectorReducer.js";

export interface HistorySearchProps {
  searchQuery: string;
  onSelect: (entry: PromptEntry) => void;
  onCancel: () => void;
}

export const HistorySearch: React.FC<HistorySearchProps> = ({
  searchQuery,
  onSelect,
  onCancel,
}) => {
  const MAX_VISIBLE_ITEMS = 5;
  const [state, dispatch] = useReducer(selectorReducer, {
    selectedIndex: 0,
    pendingDecision: null,
  } as SelectorState);
  const [entries, setEntries] = useState<PromptEntry[]>([]);

  const { selectedIndex, pendingDecision } = state;

  useEffect(() => {
    const fetchHistory = async () => {
      const results = await PromptHistoryManager.searchHistory(searchQuery);
      const limitedResults = results.slice(0, 20);
      setEntries(limitedResults);
      dispatch({ type: "RESET_INDEX" });
    };
    fetchHistory();
  }, [searchQuery]);

  // Handle decisions from reducer
  useEffect(() => {
    if (!pendingDecision) return;

    if (pendingDecision === "select") {
      if (entries.length > 0 && selectedIndex < entries.length) {
        onSelect(entries[selectedIndex]);
      }
    } else if (pendingDecision === "cancel") {
      onCancel();
    }

    dispatch({ type: "CLEAR_DECISION" });
  }, [pendingDecision, selectedIndex, entries, onSelect, onCancel]);

  useInput((input, key) => {
    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: entries.length - 1,
      hasInsert: false,
    });
  });

  if (entries.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="yellow"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Text color="yellow">
          No history found {searchQuery && `for "${searchQuery}"`}
        </Text>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    );
  }

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return diffMinutes > 0 ? `${diffMinutes}m ago` : "just now";
    }
  };

  // Calculate visible window
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, entries.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleEntries = entries.slice(
    startIndex,
    startIndex + MAX_VISIBLE_ITEMS,
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="blue"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      gap={1}
    >
      <Box>
        <Text color="blue" bold>
          Prompt History {searchQuery && `(filtering: "${searchQuery}")`}
        </Text>
      </Box>

      <Box flexDirection="column">
        {visibleEntries.map((entry, index) => {
          const actualIndex = startIndex + index;
          const isSelected = actualIndex === selectedIndex;
          return (
            <Box
              key={actualIndex}
              flexDirection="row"
              justifyContent="space-between"
            >
              <Box flexShrink={1}>
                <Text
                  color={isSelected ? "black" : "white"}
                  backgroundColor={isSelected ? "blue" : undefined}
                  wrap="truncate-end"
                >
                  {isSelected ? "> " : "  "}
                  {entry.prompt.replace(/\n/g, " ")}
                </Text>
              </Box>
              {isSelected && (
                <Box marginLeft={2} flexShrink={0}>
                  <Text color="gray" dimColor>
                    {formatTimestamp(entry.timestamp)}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box>
        <Text dimColor>
          Use ↑↓ to navigate, Enter to select, Escape to cancel
        </Text>
      </Box>
    </Box>
  );
};
