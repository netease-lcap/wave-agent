import type { SlashCommand } from "wave-agent-sdk";

export const AVAILABLE_COMMANDS: SlashCommand[] = [
  {
    id: "clear",
    name: "clear",
    description: "Clear the chat session and terminal",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
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
  {
    id: "help",
    name: "help",
    description: "Show help and key bindings",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "status",
    name: "status",
    description: "Show agent status and configuration",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "plugin",
    name: "plugin",
    description: "View and manage plugins",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "btw",
    name: "btw",
    description: "Ask a side question without blocking the main task",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
];
