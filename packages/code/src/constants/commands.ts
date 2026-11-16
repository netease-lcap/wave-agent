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
    id: "hooks",
    name: "hooks",
    description: "View configured hooks",
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
    id: "context",
    name: "context",
    // CC 写 "Visualize current context usage as a colored grid"；我们的 CLI 报告
    // 落到消息流里（纯文本，无法逐块着色），只有桌面端面板是彩色的，所以描述
    // 不承诺配色。
    description: "Show what's occupying the context window",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "diff",
    name: "diff",
    description: "View uncommitted changes and per-turn diffs",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "plugin",
    name: "plugin",
    description: "View and manage plugins",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "reload-plugins",
    name: "reload-plugins",
    description: "Reload plugins in place, without restarting the session",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "btw",
    name: "btw",
    description: "Ask a side question without tool use",
    // 唯一需要用户补内容的本地命令：`/btw` 插进输入框后以暗色提示问题形状。
    argumentHint: "<your question>",
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
    // CC 写 `[open|<description>]`，但 `/plan open` 三端都不支持（spec
    // plan-mode.md），提示里不列这个填不出来的词。
    argumentHint: "[description]",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "resume",
    name: "resume",
    description: "Switch to another conversation without leaving the session",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "rename",
    name: "rename",
    description: "Set a custom title for the current conversation",
    // 与 `Usage: /rename <title>` 逐字一致（CC 的同一个命令写 `[name]`）。
    argumentHint: "<title>",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
  {
    id: "remote-control",
    name: "remote-control",
    description: "Serve this terminal's session to a phone",
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
    // 可选的压缩指令（`/compact 只留结论`），CC 的措辞太长，这里压成一段。
    argumentHint: "[instructions]",
    handler: () => {},
  },
  {
    id: "add-dir",
    name: "add-dir",
    description: "Add a directory to the session Safe Zone",
    // 与 `Usage: /add-dir <path> [--remember]` 逐字一致。
    argumentHint: "<path> [--remember]",
    handler: () => {}, // Handler here won't be used, actual processing is in the hook
  },
];
