import type { ChildProcess } from "child_process";

/**
 * Logger interface definition
 * Compatible with OpenAI package Logger interface
 */
export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export interface Message {
  role: "user" | "assistant";
  blocks: MessageBlock[];
}

export type MessageBlock =
  | TextBlock
  | ErrorBlock
  | ToolBlock
  | ImageBlock
  | DiffBlock
  | CommandOutputBlock
  | CompressBlock
  | MemoryBlock
  | CustomCommandBlock;

export interface TextBlock {
  type: "text";
  content: string;
}

export interface ErrorBlock {
  type: "error";
  content: string;
}

export interface ToolBlock {
  type: "tool";
  parameters?: string;
  result?: string;
  shortResult?: string; // Add shortResult field
  images?: Array<{
    // Add image data support
    data: string; // Base64 encoded image data
    mediaType?: string; // Media type of the image
  }>;
  id?: string;
  name?: string;
  isRunning?: boolean; // Mark if tool is actually executing
  success?: boolean;
  error?: string | Error;
  compactParams?: string; // Compact parameter display
}

export interface ImageBlock {
  type: "image";
  imageUrls?: string[];
}

export interface DiffBlock {
  type: "diff";
  path: string;
  diffResult: Array<{
    value: string;
    added?: boolean;
    removed?: boolean;
  }>;
}

export interface CommandOutputBlock {
  type: "command_output";
  command: string;
  output: string;
  isRunning: boolean;
  exitCode: number | null;
}

export interface CompressBlock {
  type: "compress";
  content: string;
}

export interface MemoryBlock {
  type: "memory";
  content: string;
  isSuccess: boolean;
  memoryType?: "project" | "user"; // Memory type
  storagePath?: string; // Storage path text
}

export interface CustomCommandBlock {
  type: "custom_command";
  commandName: string;
  content: string; // Complete command content, used when passing to AI
  originalInput?: string; // Original user input, used for UI display (e.g., "/fix-issue 123 high")
}

export interface AIRequest {
  content: string;
  files: unknown[];
}

export interface AIResponse {
  content: string;
  status: "success" | "error";
  error?: string;
}

// MCP related types
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerStatus {
  name: string;
  config: McpServerConfig;
  status: "disconnected" | "connected" | "connecting" | "error";
  tools?: McpTool[];
  toolCount?: number;
  capabilities?: string[];
  lastConnected?: number;
  error?: string;
}

// Background bash shell related types
export interface BackgroundShell {
  id: string;
  process: ChildProcess;
  command: string;
  startTime: number;
  status: "running" | "completed" | "killed";
  stdout: string;
  stderr: string;
  exitCode?: number;
  runtime?: number;
}

// Slash Command related types
export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  handler: (args?: string) => Promise<void> | void;
}

export interface CustomSlashCommandConfig {
  allowedTools?: string[];
  model?: string;
  description?: string;
}

export interface CustomSlashCommand {
  id: string;
  name: string;
  description?: string; // Add description field
  filePath: string;
  content: string;
  config?: CustomSlashCommandConfig;
}
