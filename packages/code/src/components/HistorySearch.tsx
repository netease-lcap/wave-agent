import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { PromptHistoryManager, type PromptEntry } from "wave-agent-sdk";

export interface HistorySearchProps {
  searchQuery: string;
  onSelect: (prompt: string) => void;
  onCancel: () => void;
}

export const HistorySearch: React.FC<HistorySearchProps> = ({
  searchQuery,
  onSelect,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entries, setEntries] = useState<PromptEntry[]>([]);

  const entriesRef = React.useRef<PromptEntry[]>([]);
  const selectedIndexRef = React.useRef(0);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    const fetchHistory = async () => {
      const results = await PromptHistoryManager.searchHistory(searchQuery);
      const limitedResults = results.slice(0, 10);
      setEntries(limitedResults); // Limit to 10 results
      setSelectedIndex(0);
    };
    fetchHistory();
  }, [searchQuery]);

  useInput((input, key) => {
    if (key.return) {
      if (
        entriesRef.current.length > 0 &&
        selectedIndexRef.current < entriesRef.current.length
      ) {
        onSelect(entriesRef.current[selectedIndexRef.current].prompt);
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) =>
        Math.min(entriesRef.current.length - 1, prev + 1),
      );
      return;
    }
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
        paddingTop={1}
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

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="blue"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={1}
      gap={1}
    >
      <Box>
        <Text color="blue" bold>
          Prompt History {searchQuery && `(filtering: "${searchQuery}")`}
        </Text>
      </Box>

      {entries.map((entry, index) => (
        <Box key={index} flexDirection="column">
          <Text
            color={index === selectedIndex ? "black" : "white"}
            backgroundColor={index === selectedIndex ? "blue" : undefined}
            wrap="truncate-end"
          >
            {entry.prompt.replace(/\n/g, " ")}
          </Text>
          {index === selectedIndex && (
            <Box marginLeft={4}>
              <Text color="gray" dimColor>
                {formatTimestamp(entry.timestamp)}
              </Text>
            </Box>
          )}
        </Box>
      ))}

      <Box>
        <Text dimColor>
          Use ↑↓ to navigate, Enter to select, Escape to cancel
        </Text>
      </Box>
    </Box>
  );
};
