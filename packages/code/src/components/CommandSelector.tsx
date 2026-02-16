import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SlashCommand } from "wave-agent-sdk";

const AVAILABLE_COMMANDS: SlashCommand[] = [
  {
    id: "tasks",
    name: "tasks",
    description: "View and manage background tasks (shells and subagents)",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "mcp",
    name: "mcp",
    description: "View and manage MCP servers",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "rewind",
    name: "rewind",
    description:
      "Revert conversation and file changes to a previous checkpoint",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
];

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

  // Merge agent commands and local commands
  const allCommands = [...commands, ...AVAILABLE_COMMANDS];

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

  useInput((input, key) => {
    if (key.return) {
      if (
        filteredCommands.length > 0 &&
        selectedIndex < filteredCommands.length
      ) {
        const selectedCommand = filteredCommands[selectedIndex].id;
        onSelect(selectedCommand);
      }
      return;
    }

    if (key.tab && onInsert) {
      if (
        filteredCommands.length > 0 &&
        selectedIndex < filteredCommands.length
      ) {
        const selectedCommand = filteredCommands[selectedIndex].id;
        onInsert(selectedCommand);
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
      setSelectedIndex(
        Math.min(filteredCommands.length - 1, selectedIndex + 1),
      );
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
