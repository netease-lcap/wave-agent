import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { SlashCommand } from "wave-agent-sdk";
import { AVAILABLE_COMMANDS } from "../constants/commands.js";
import { helpSelectorReducer } from "../reducers/helpSelectorReducer.js";

export interface HelpViewProps {
  onCancel: () => void;
  commands?: SlashCommand[];
}

export const HelpView: React.FC<HelpViewProps> = ({
  onCancel,
  commands = [],
}) => {
  const MAX_VISIBLE_ITEMS = 10;

  const tabs: ("general" | "commands" | "custom-commands")[] = [
    "general",
    "commands",
  ];
  if (commands.length > 0) {
    tabs.push("custom-commands");
  }

  const [state, dispatch] = useReducer(helpSelectorReducer, {
    selectedIndex: 0,
    activeTab: "general",
    pendingDecision: null,
  });

  const { selectedIndex, activeTab, pendingDecision } = state;

  // Handle decisions from reducer
  useEffect(() => {
    if (pendingDecision === "cancel") {
      onCancel();
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [pendingDecision, onCancel]);

  const currentCommands =
    activeTab === "commands" ? AVAILABLE_COMMANDS : commands;

  // Calculate visible window for commands
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, currentCommands.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleCommands = currentCommands.slice(
    startIndex,
    startIndex + MAX_VISIBLE_ITEMS,
  );

  useInput((_, key) => {
    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: activeTab === "general" ? 0 : currentCommands.length - 1,
      tabs,
    });
  });

  const helpItems = [
    { key: "@", description: "Reference files" },
    { key: "/", description: "Commands" },
    { key: "!", description: "Shell commands (e.g. !ls)" },
    { key: "Ctrl+R", description: "Search history" },
    { key: "Ctrl+O", description: "Expand/collapse messages" },
    { key: "Ctrl+T", description: "Toggle task list" },
    { key: "Ctrl+B", description: "Background current task" },
    { key: "Ctrl+V", description: "Paste image" },
    { key: "Ctrl+J", description: "Newline" },
    { key: "Shift+Tab", description: "Cycle permission mode" },
    {
      key: "Esc",
      description: "Interrupt AI or command / Cancel selector / Close help",
    },
  ];

  const footerText = [
    "Tab switch",
    activeTab !== "general" && "↑↓ navigate",
    "Esc close",
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      width="100%"
    >
      <Box marginBottom={1} gap={2}>
        <Text
          color={activeTab === "general" ? "cyan" : "gray"}
          bold
          underline={activeTab === "general"}
        >
          General
        </Text>
        <Text
          color={activeTab === "commands" ? "cyan" : "gray"}
          bold
          underline={activeTab === "commands"}
        >
          Commands
        </Text>
        {commands.length > 0 && (
          <Text
            color={activeTab === "custom-commands" ? "cyan" : "gray"}
            bold
            underline={activeTab === "custom-commands"}
          >
            Custom Commands
          </Text>
        )}
      </Box>

      {activeTab === "general" ? (
        <Box flexDirection="column">
          {helpItems.map((item, index) => (
            <Box key={index}>
              <Box width={20}>
                <Text color="yellow">{item.key}</Text>
              </Box>
              <Text color="white">{item.description}</Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box flexDirection="column">
          {visibleCommands.map((command, index) => {
            const actualIndex = startIndex + index;
            const isSelected = actualIndex === selectedIndex;
            return (
              <Box key={command.id} flexDirection="column">
                <Text
                  color={isSelected ? "black" : "white"}
                  backgroundColor={isSelected ? "cyan" : undefined}
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
      )}

      <Box marginTop={1}>
        <Text dimColor>{footerText}</Text>
      </Box>
    </Box>
  );
};
