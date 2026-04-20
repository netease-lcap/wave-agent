/**
 * Message and communication block types
 * Dependencies: Core (Usage)
 */

import type { Usage } from "./core.js";

export enum MessageSource {
  USER = "user",
  HOOK = "hook",
}

export interface Message {
  id: string; // Unique identifier for the message
  role: "user" | "assistant";
  blocks: MessageBlock[];
  usage?: Usage; // Usage data for this message's AI operation (assistant messages only)
  additionalFields?: Record<string, unknown>; // Additional metadata from AI responses
  isMeta?: boolean; // Whether the message is a meta message (hidden from UI)
}

export type MessageBlock =
  | TextBlock
  | ErrorBlock
  | ToolBlock
  | ImageBlock
  | BangBlock
  | CompressBlock
  | ReasoningBlock
  | FileHistoryBlock
  | TaskNotificationBlock;

export interface TextBlock {
  type: "text";
  content: string;
  customCommandContent?: string;
  source?: MessageSource;
  stage?: "streaming" | "end";
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
  startLineNumber?: number; // Optional starting line number
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
  isManuallyBackgrounded?: boolean; // Whether the tool was manually backgrounded by the user
  timestamp?: number; // Unix ms, set when tool result is finalized (stage="end")
}

export interface ImageBlock {
  type: "image";
  imageUrls?: string[];
}

export interface BangBlock {
  type: "bang";
  command: string;
  output: string;
  stage: "running" | "end";
  exitCode: number | null;
}

export interface CompressBlock {
  type: "compress";
  content: string;
  sessionId: string;
}

export interface ReasoningBlock {
  type: "reasoning";
  content: string;
  stage?: "streaming" | "end";
}

export interface FileHistoryBlock {
  type: "file_history";
  snapshots: import("./reversion.js").FileSnapshot[];
}

export interface TaskNotificationBlock {
  type: "task_notification";
  taskId: string;
  taskType: "shell" | "agent";
  status: "completed" | "failed" | "killed";
  summary: string;
  outputFile?: string;
}
