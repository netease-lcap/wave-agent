/**
 * 工具插件接口定义
 */

import { ChatCompletionFunctionTool } from "openai/resources.js";

export interface ToolPlugin {
  name: string;
  description: string;
  config: ChatCompletionFunctionTool;
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
  // 图片数据，用于支持多媒体内容
  images?: Array<{
    data: string; // base64 编码的图片数据
    mediaType?: string; // 图片的媒体类型，如 "image/png"
  }>;
}

export interface ToolContext {
  abortSignal?: AbortSignal;
  backgroundBashManager?: import("../managers/backgroundBashManager.js").BackgroundBashManager;
}
