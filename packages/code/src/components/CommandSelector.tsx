import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SlashCommand } from "wave-agent-sdk";
import { AVAILABLE_COMMANDS } from "../constants/commands.js";

export interface CommandSelectorProps {
  searchQuery: string;
  onSelect: (command: string) => void;
  onInsert?: (command: string) => void; // New: Tab key to insert command into input box
  onCancel: () => void;
  commands?: SlashCommand[]; // New optional command list parameter
}

export const CommandSelector: React.FC<CommandSelectorProps> = ({
  searchQuery,
  onSelect,
  onInsert,
  onCancel,
  commands = [], // Default to empty array
}) => {
  const MAX_VISIBLE_ITEMS = 3;
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selected index when search query changes
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Merge agent commands and local commands
  const allCommands = [...AVAILABLE_COMMANDS, ...commands];

  // Filter command list
  const filteredCommands = allCommands.filter(
    (command) =>
      !searchQuery ||
      command.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Calculate visible window
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, filteredCommands.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleCommands = filteredCommands.slice(
    startIndex,
    startIndex + MAX_VISIBLE_ITEMS,
  );

  const stateRef = React.useRef({ filteredCommands, selectedIndex });
  React.useEffect(() => {
    stateRef.current = { filteredCommands, selectedIndex };
  }, [filteredCommands, selectedIndex]);

  useInput((input, key) => {
    const { filteredCommands: currentCommands, selectedIndex: currentIndex } =
      stateRef.current;

    if (key.return) {
      if (currentCommands.length > 0 && currentIndex < currentCommands.length) {
        const selectedCommand = currentCommands[currentIndex].id;
        onSelect(selectedCommand);
      }
      return;
    }

    if (key.tab && onInsert) {
      if (currentCommands.length > 0 && currentIndex < currentCommands.length) {
        const selectedCommand = currentCommands[currentIndex].id;
        onInsert(selectedCommand);
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, currentIndex - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(Math.min(currentCommands.length - 1, currentIndex + 1));
      return;
    }
  });

  if (filteredCommands.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="yellow"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Text color="yellow">No commands found for "{searchQuery}"</Text>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="magenta"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      gap={1}
    >
      <Box>
        <Text color="magenta" bold>
          Command Selector {searchQuery && `(filtering: "${searchQuery}")`}
        </Text>
      </Box>

      <Box flexDirection="column">
        {visibleCommands.map((command, index) => {
          const actualIndex = startIndex + index;
          const isSelected = actualIndex === selectedIndex;
          return (
            <Box key={command.id} flexDirection="column">
              <Text
                color={isSelected ? "black" : "white"}
                backgroundColor={isSelected ? "magenta" : undefined}
              >
                {isSelected ? "▶ " : "  "}/{command.id}
              </Text>
              {isSelected && (
                <Box marginLeft={4}>
                  <Text color="gray" dimColor>
                    {command.description}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box>
        <Text dimColor>
          ↑↓ navigate • Enter execute • {onInsert ? "Tab insert • " : ""}Esc
          cancel
        </Text>
      </Box>
    </Box>
  );
};
