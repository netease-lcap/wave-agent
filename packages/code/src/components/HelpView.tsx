import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SlashCommand } from "wave-agent-sdk";
import { AVAILABLE_COMMANDS } from "../constants/commands.js";

export interface HelpViewProps {
  onCancel: () => void;
  commands?: SlashCommand[];
}

export const HelpView: React.FC<HelpViewProps> = ({
  onCancel,
  commands = [],
}) => {
  const [activeTab, setActiveTab] = useState<
    "general" | "commands" | "custom-commands"
  >("general");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const MAX_VISIBLE_ITEMS = 10;

  const tabs: ("general" | "commands" | "custom-commands")[] = [
    "general",
    "commands",
  ];
  if (commands.length > 0) {
    tabs.push("custom-commands");
  }

  useInput((_, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.tab) {
      setActiveTab((prev) => {
        const currentIndex = tabs.indexOf(prev);
        const nextIndex = (currentIndex + 1) % tabs.length;
        return tabs[nextIndex];
      });
      setSelectedIndex(0);
      return;
    }

    if (activeTab === "commands" || activeTab === "custom-commands") {
      const currentCommands =
        activeTab === "commands" ? AVAILABLE_COMMANDS : commands;
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex((prev) =>
          Math.min(currentCommands.length - 1, prev + 1),
        );
      }
    }
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

  // Calculate visible window for commands
  const currentCommands =
    activeTab === "commands" ? AVAILABLE_COMMANDS : commands;
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
