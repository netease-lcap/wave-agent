import { Delta } from './types/common';

export interface Message {
  role: 'user' | 'assistant';
  blocks: MessageBlock[];
  originalDeltas?: Delta[]; // 添加原始 delta 数组
}

export type MessageBlock = TextBlock | FileBlock | ErrorBlock | ToolBlock | ImageBlock | DiffBlock | CommandOutputBlock | CompressBlock;

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface FileBlock {
  type: 'file';
  path: string;
  content: string;
  action: 'create' | 'update' | 'delete';
}

export interface ErrorBlock {
  type: 'error';
  content: string;
}

export interface ToolBlock {
  type: 'tool';
  parameters?: string;
  result?: string;
  shortResult?: string; // 添加 shortResult 字段
  attributes?: {
    id?: string;
    name?: string;
    isStreaming?: boolean; // 标记工具参数是否在流式传输中
    isRunning?: boolean; // 标记工具是否在实际执行中
    success?: boolean;
    error?: string | Error;
  };
}

export interface ImageBlock {
  type: 'image';
  content?: string;
  attributes?: {
    imageUrls?: string[];
    [key: string]: unknown;
  };
}

export interface DiffBlock {
  type: 'diff';
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
  type: 'command_output';
  command: string;
  output: string;
  isRunning: boolean;
  exitCode: number | null;
}

export interface CompressBlock {
  type: 'compress';
  content: string;
  compressedMessageCount: number; // 记录压缩了多少条消息
}

export interface AIRequest {
  content: string;
  files: unknown[];
}

export interface AIResponse {
  content: string;
  status: 'success' | 'error';
  error?: string;
}
