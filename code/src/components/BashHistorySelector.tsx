import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { searchBashHistory, type BashHistoryEntry } from "wave-agent-sdk";
import { logger } from "../utils/logger.js";

export interface BashHistorySelectorProps {
  searchQuery: string;
  onSelect: (command: string) => void;
  onCancel: () => void;
}

export const BashHistorySelector: React.FC<BashHistorySelectorProps> = ({
  searchQuery,
  onSelect,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [commands, setCommands] = useState<BashHistoryEntry[]>([]);

  // 搜索bash历史
  useEffect(() => {
    const results = searchBashHistory(searchQuery, 10);
    setCommands(results);
    setSelectedIndex(0);
    logger.debug("Bash history search:", {
      searchQuery,
      resultCount: results.length,
    });
  }, [searchQuery]);

  useInput((input, key) => {
    logger.debug("BashHistorySelector useInput:", {
      input,
      key,
      commandsLength: commands.length,
      selectedIndex,
    });

    if (key.return) {
      if (commands.length > 0 && selectedIndex < commands.length) {
        const selectedCommand = commands[selectedIndex];
        onSelect(selectedCommand.command);
      } else if (commands.length === 0 && searchQuery.trim()) {
        // 当没有历史记录匹配时，将搜索查询作为新命令执行
        onSelect(searchQuery.trim());
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
      setSelectedIndex(Math.min(commands.length - 1, selectedIndex + 1));
      return;
    }
  });

  if (commands.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="yellow"
        padding={1}
        marginBottom={1}
      >
        <Text color="yellow">
          No bash history found {searchQuery && `for "${searchQuery}"`}
        </Text>
        {searchQuery.trim() && (
          <Text color="green">Press Enter to execute: {searchQuery}</Text>
        )}
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
      padding={1}
      gap={1}
      marginBottom={1}
    >
      <Box>
        <Text color="blue" bold>
          Bash History {searchQuery && `(filtering: "${searchQuery}")`}
        </Text>
      </Box>

      {commands.map((cmd, index) => (
        <Box key={index} flexDirection="column">
          <Text
            color={index === selectedIndex ? "black" : "white"}
            backgroundColor={index === selectedIndex ? "blue" : undefined}
          >
            {cmd.command}
          </Text>
          {index === selectedIndex && (
            <Box marginLeft={4} flexDirection="column">
              <Text color="gray" dimColor>
                {formatTimestamp(cmd.timestamp)}
                {cmd.workdir !== process.cwd() && ` • in ${cmd.workdir}`}
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
