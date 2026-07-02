import React, { useReducer, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { SlashCommand } from "wave-agent-sdk";
import { AVAILABLE_COMMANDS } from "../constants/commands.js";
import {
  selectorReducer,
  type SelectorState,
} from "../reducers/selectorReducer.js";

export interface CommandSelectorProps {
  searchQuery: string;
  onSelect: (command: string) => void;
  onInsert?: (command: string) => void;
  onCancel: () => void;
  commands?: SlashCommand[];
}

export const CommandSelector: React.FC<CommandSelectorProps> = ({
  searchQuery,
  onSelect,
  onInsert,
  onCancel,
  commands = [],
}) => {
  const MAX_VISIBLE_ITEMS = 3;
  const [state, dispatch] = useReducer(selectorReducer<SlashCommand>, {
    selectedIndex: 0,
    pendingDecision: null,
    items: [],
  } as SelectorState<SlashCommand>);

  const { selectedIndex, pendingDecision, items: filteredCommands } = state;

  // Merge agent commands and local commands, memoized to stabilize useEffect dependencies
  const computedCommands = useMemo(() => {
    const allCommands = [...AVAILABLE_COMMANDS, ...commands];
    return allCommands.filter(
      (command) =>
        !searchQuery ||
        command.id.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [searchQuery, commands]);

  // Sync computed commands into reducer state (SET_ITEMS also resets index)
  useEffect(() => {
    dispatch({ type: "SET_ITEMS", items: computedCommands });
  }, [computedCommands]);

  // Handle decisions from reducer
  useEffect(() => {
    if (!pendingDecision) return;

    if (pendingDecision === "select") {
      if (
        filteredCommands.length > 0 &&
        selectedIndex < filteredCommands.length
      ) {
        onSelect(filteredCommands[selectedIndex].id);
      }
    } else if (pendingDecision === "insert" && onInsert) {
      if (
        filteredCommands.length > 0 &&
        selectedIndex < filteredCommands.length
      ) {
        onInsert(filteredCommands[selectedIndex].id);
      }
    } else if (pendingDecision === "cancel") {
      onCancel();
    }

    dispatch({ type: "CLEAR_DECISION" });
  }, [
    pendingDecision,
    selectedIndex,
    filteredCommands,
    onSelect,
    onInsert,
    onCancel,
  ]);

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
    dispatch({ type: "HANDLE_KEY", key, hasInsert: !!onInsert });
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
