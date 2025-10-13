import { ChatCompletionChunk } from "openai/resources.js";
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

export interface MessageGroupInfo {
  isGroupStart: boolean; // 是否是连续组的开始
  isGroupMember: boolean; // 是否是连续组的成员
  groupRange?: string; // 组的编号范围（如 "2-4"）
}

export interface Message {
  role: "user" | "assistant";
  blocks: MessageBlock[];
  originalDeltas?: ChatCompletionChunk.Choice.Delta[]; // 添加原始 delta 数组
  groupInfo?: MessageGroupInfo; // 添加分组信息
}

export type MessageBlock =
  | TextBlock
  | ErrorBlock
  | ToolBlock
  | ImageBlock
  | DiffBlock
  | CommandOutputBlock
  | CompressBlock
  | MemoryBlock;

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
