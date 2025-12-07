/**
 * Tool plugin interface definitions
 */

import { ChatCompletionFunctionTool } from "openai/resources.js";

export interface ToolPlugin {
  name: string;
  config: ChatCompletionFunctionTool;
  execute: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<ToolResult>;
  formatCompactParams?: (
    params: Record<string, unknown>,
    context: ToolContext,
  ) => string;
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
  // Short output, used to display summary information in collapsed state
  shortResult?: string;
  // File path for operations that affect files
  filePath?: string;
  // Image data, for supporting multimedia content
  images?: Array<{
    data: string; // base64 encoded image data
    mediaType?: string; // Image media type, such as "image/png"
  }>;
}

export interface ToolContext {
  abortSignal?: AbortSignal;
  backgroundBashManager?: import("../managers/backgroundBashManager.js").BackgroundBashManager;
  workdir: string;
  addDiffBlock?: (
    filePath: string,
    diffResult: Array<{ value: string; added?: boolean; removed?: boolean }>,
  ) => void;
}
