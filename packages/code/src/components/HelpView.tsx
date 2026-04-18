import React, { useReducer } from "react";
import { Box, Text, useInput } from "ink";
import type { SlashCommand } from "wave-agent-sdk";
import { AVAILABLE_COMMANDS } from "../constants/commands.js";

export interface HelpViewProps {
  onCancel: () => void;
  commands?: SlashCommand[];
}

type HelpState = {
  activeTab: "general" | "commands" | "custom-commands";
  selectedIndex: number;
};

type HelpAction =
  | { type: "NEXT_TAB"; tabs: ("general" | "commands" | "custom-commands")[] }
  | { type: "NAVIGATE_UP" }
  | { type: "NAVIGATE_DOWN"; max: number };

function helpReducer(state: HelpState, action: HelpAction): HelpState {
  switch (action.type) {
    case "NEXT_TAB": {
      const currentIndex = action.tabs.indexOf(state.activeTab);
      const nextIndex = (currentIndex + 1) % action.tabs.length;
      return { activeTab: action.tabs[nextIndex], selectedIndex: 0 };
    }
    case "NAVIGATE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "NAVIGATE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(action.max, state.selectedIndex + 1),
      };
    default:
      return state;
  }
}

export const HelpView: React.FC<HelpViewProps> = ({
  onCancel,
  commands = [],
}) => {
  const [state, dispatch] = useReducer(helpReducer, {
    activeTab: "general",
    selectedIndex: 0,
  });
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
      dispatch({ type: "NEXT_TAB", tabs });
      return;
    }

    if (
      state.activeTab === "commands" ||
      state.activeTab === "custom-commands"
    ) {
      const currentCommands =
        state.activeTab === "commands" ? AVAILABLE_COMMANDS : commands;
      if (key.upArrow) {
        dispatch({ type: "NAVIGATE_UP" });
      } else if (key.downArrow) {
        dispatch({ type: "NAVIGATE_DOWN", max: currentCommands.length - 1 });
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
    state.activeTab === "commands" ? AVAILABLE_COMMANDS : commands;
  const startIndex = Math.max(
    0,
    Math.min(
      state.selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, currentCommands.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visibleCommands = currentCommands.slice(
    startIndex,
    startIndex + MAX_VISIBLE_ITEMS,
  );

  const footerText = [
    "Tab switch",
    state.activeTab !== "general" && "↑↓ navigate",
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
          color={state.activeTab === "general" ? "cyan" : "gray"}
          bold
          underline={state.activeTab === "general"}
        >
          General
        </Text>
        <Text
          color={state.activeTab === "commands" ? "cyan" : "gray"}
          bold
          underline={state.activeTab === "commands"}
        >
          Commands
        </Text>
        {commands.length > 0 && (
          <Text
            color={state.activeTab === "custom-commands" ? "cyan" : "gray"}
            bold
            underline={state.activeTab === "custom-commands"}
          >
            Custom Commands
          </Text>
        )}
      </Box>

      {state.activeTab === "general" ? (
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
            const isSelected = actualIndex === state.selectedIndex;
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
