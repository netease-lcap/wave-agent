/**
 * 工具插件接口定义
 */

import type { ChatCompletionTool, FileTreeNode } from "../../types/common";

export interface ToolPlugin {
  name: string;
  description: string;
  config: ChatCompletionTool;
  execute: (
    args: Record<string, unknown>,
    context?: ToolContext,
  ) => Promise<ToolResult>;
  formatCompactParams?: (params: Record<string, unknown>) => string;
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
  // 简短输出，用于折叠状态下显示概要信息
  shortResult?: string;
  // 文件编辑工具的额外属性
  originalContent?: string;
  newContent?: string;
  diffResult?: Array<{
    count?: number;
    value: string;
    added?: boolean;
    removed?: boolean;
  }>;
  filePath?: string;
}

export interface ToolRegistry {
  register: (plugin: ToolPlugin) => void;
  execute: (
    name: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ) => Promise<ToolResult>;
  list: () => ToolPlugin[];
  getToolsConfig: () => ChatCompletionTool[];
}

export interface ToolContext {
  flatFiles?: FileTreeNode[];
  abortSignal?: AbortSignal;
  workdir?: string;
}
