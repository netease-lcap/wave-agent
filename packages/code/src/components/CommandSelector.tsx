import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SlashCommand } from "wave-agent-sdk";

const AVAILABLE_COMMANDS: SlashCommand[] = [
  {
    id: "bashes",
    name: "bashes",
    description: "View and manage background bash shells",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "mcp",
    name: "mcp",
    description: "View and manage MCP servers",
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
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Merge agent commands and local commands
  const allCommands = [...commands, ...AVAILABLE_COMMANDS];

  // Filter command list
  const filteredCommands = allCommands.filter(
    (command) =>
      !searchQuery ||
      command.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  useInput((input, key) => {
    if (key.return) {
      if (
        filteredCommands.length > 0 &&
        selectedIndex < filteredCommands.length
      ) {
        const selectedCommand = filteredCommands[selectedIndex].name;
        onSelect(selectedCommand);
      }
      return;
    }

    if (key.tab && onInsert) {
      if (
        filteredCommands.length > 0 &&
        selectedIndex < filteredCommands.length
      ) {
        const selectedCommand = filteredCommands[selectedIndex].name;
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
        padding={1}
        marginBottom={1}
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
      padding={1}
      gap={1}
      marginBottom={1}
    >
      <Box>
        <Text color="magenta" bold>
          Command Selector {searchQuery && `(filtering: "${searchQuery}")`}
        </Text>
      </Box>

      {filteredCommands.map((command, index) => (
        <Box key={command.name} flexDirection="column">
          <Text
            color={index === selectedIndex ? "black" : "white"}
            backgroundColor={index === selectedIndex ? "magenta" : undefined}
          >
            {index === selectedIndex ? "▶ " : "  "}/{command.name}
          </Text>
          {index === selectedIndex && (
            <Box marginLeft={4}>
              <Text color="gray" dimColor>
                {command.description}
              </Text>
            </Box>
          )}
        </Box>
      ))}

      <Box>
        <Text dimColor>
          ↑↓ navigate • Enter execute • {onInsert ? "Tab insert • " : ""}Esc
          cancel
        </Text>
      </Box>
    </Box>
  );
};
