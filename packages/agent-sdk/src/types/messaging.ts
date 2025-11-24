/**
 * Message and communication block types
 * Dependencies: Core (Usage)
 */

import type { Usage } from "./core.js";
import type { SubagentConfiguration } from "../utils/subagentParser.js";

export enum MessageSource {
  USER = "user",
  HOOK = "hook",
}

export interface Message {
  role: "user" | "assistant";
  blocks: MessageBlock[];
  usage?: Usage; // Usage data for this message's AI operation (assistant messages only)
  metadata?: Record<string, unknown>; // Additional metadata from AI responses
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
  | SubagentBlock;

export interface TextBlock {
  type: "text";
  content: string;
  customCommandContent?: string;
  source?: MessageSource;
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
  /**
   * Tool execution stage:
   * - 'start': Tool call initiated (from AI service streaming)
   * - 'streaming': Tool parameters being streamed (from AI service)
   * - 'running': Tool execution in progress (from AI manager)
   * - 'end': Tool execution completed (from AI manager)
   */
  stage: "start" | "streaming" | "running" | "end";
  success?: boolean;
  error?: string | Error;
  compactParams?: string; // Compact parameter display
  parametersChunk?: string; // Incremental parameter updates for streaming
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
  sessionId: string;
}

export interface MemoryBlock {
  type: "memory";
  content: string;
  isSuccess: boolean;
  memoryType?: "project" | "user"; // Memory type
  storagePath?: string; // Storage path text
}

export interface SubagentBlock {
  type: "subagent";
  subagentId: string;
  subagentName: string;
  status: "active" | "completed" | "error" | "aborted";
  sessionId: string;
  configuration: SubagentConfiguration;
}
