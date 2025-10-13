import type { ChildProcess } from "child_process";

/**
 * Logger 接口定义
 * 与 OpenAI 包的 Logger 接口兼容
 */
export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export interface Message {
  role: "user" | "assistant" | "subAgent";
  blocks: MessageBlock[];
  messages?: Message[]; // For subAgent role, contains the sub-conversation
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
  shortResult?: string; // 添加 shortResult 字段
  images?: Array<{
    // 添加图片数据支持
    data: string; // base64 编码的图片数据
    mediaType?: string; // 图片的媒体类型
  }>;
  attributes?: {
    id?: string;
    name?: string;
    isRunning?: boolean; // 标记工具是否在实际执行中
    success?: boolean;
    error?: string | Error;
    compactParams?: string; // 紧凑参数显示
  };
}

export interface ImageBlock {
  type: "image";
  content?: string;
  attributes?: {
    imageUrls?: string[];
    [key: string]: unknown;
  };
}

export interface DiffBlock {
  type: "diff";
  path: string;
  original: string;
  modified: string;
  diffResult: Array<{
    value: string;
    added?: boolean;
    removed?: boolean;
  }>;
  warning?: string;
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
  memoryType?: "project" | "user"; // 记忆类型
  storagePath?: string; // 存储路径文案
}

export interface CustomCommandBlock {
  type: "custom_command";
  commandName: string;
  content: string; // 完整的命令内容，传给AI时使用
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
  handler: () => Promise<void> | void;
}

export interface CustomSlashCommandConfig {
  allowedTools?: string[];
  model?: string;
}

export interface CustomSlashCommand {
  id: string;
  name: string;
  filePath: string;
  content: string;
  config?: CustomSlashCommandConfig;
}
