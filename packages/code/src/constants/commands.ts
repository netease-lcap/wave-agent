import type { SlashCommand } from "wave-agent-sdk";

export const AVAILABLE_COMMANDS: SlashCommand[] = [
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
    id: "agents",
    name: "agents",
    description: "List available agents and active subagents",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "skills",
    name: "skills",
    description: "List available skills",
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
    description: "Ask a side question without tool use",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "model",
    name: "model",
    description: "Switch between configured AI models",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "login",
    name: "login",
    description: "Authenticate via SSO",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "logout",
    name: "logout",
    description: "Clear SSO authentication",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "workflows",
    name: "workflows",
    description: "View and manage workflow runs",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "plan",
    name: "plan",
    description: "Enable plan mode or view the current session plan",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "clear",
    name: "clear",
    description: "Clear conversation history and reset session",
    handler: () => {},
  },
  {
    id: "compact",
    name: "compact",
    description: "Compact conversation history to reduce context usage",
    handler: () => {},
  },
  {
    id: "add-dir",
    name: "add-dir",
    description: "Add a directory to the session Safe Zone",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
];
