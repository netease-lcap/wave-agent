import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface Command {
  name: string;
  description: string;
}

const AVAILABLE_COMMANDS: Command[] = [
  {
    name: "clean",
    description: "Clear the chat session",
  },
  {
    name: "bashes",
    description: "View and manage background bash shells",
  },
  {
    name: "mcp",
    description: "View and manage MCP servers",
  },
];

export interface CommandSelectorProps {
  searchQuery: string;
  onSelect: (command: string) => void;
  onCancel: () => void;
}

export const CommandSelector: React.FC<CommandSelectorProps> = ({
  searchQuery,
  onSelect,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 过滤命令列表
  const filteredCommands = AVAILABLE_COMMANDS.filter(
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
          Use ↑↓ to navigate, Enter to select, Escape to cancel
        </Text>
      </Box>
    </Box>
  );
};
