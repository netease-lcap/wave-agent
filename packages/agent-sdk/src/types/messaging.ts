/**
 * Message and communication block types
 * Dependencies: Core (Usage)
 */

import type { Usage } from "./core.js";

export interface Message {
  id: string; // Unique identifier for the message
  role: "user" | "assistant";
  blocks: MessageBlock[];
  timestamp: string; // ISO 8601 timestamp, assigned at creation
  usage?: Usage; // Usage data for this message's AI operation (assistant messages only)
  additionalFields?: Record<string, unknown>; // Additional metadata from AI responses
  isMeta?: boolean; // Whether the message is a meta message (hidden from UI)
}

export type MessageBlock =
  | TextBlock
  | ErrorBlock
  | ToolBlock
  | ImageBlock
  | CompactBlock
  | ReasoningBlock
  | FileHistoryBlock
  | TaskNotificationBlock;

export interface TextBlock {
  type: "text";
  content: string;
  customCommandContent?: string;
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
    path?: string; // Persisted temp file path (MCP images under a non-vision model)
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
  // ID of the background task if the command is running in the background
  backgroundTaskId?: string;
  // True if the user manually backgrounded the command (e.g. via Ctrl-B)
  backgroundedByUser?: boolean;
  // True if the command was auto-backgrounded after exceeding the timeout
  assistantAutoBackgrounded?: boolean;
  /**
   * The tool names one `Exec` call reached inside the sandbox, in call order and
   * with repeats kept. Host-side only.
   *
   * A deferred tool is callable from the sandbox but absent from `tools[]`, so its
   * calls leave no `tool` block of their own — the names ride on the `Exec` block
   * that carried them. A host-side judgment asking "has the agent called X" must
   * read this rather than the block name (see `docs/specs/core/exec-tool.md`).
   * Never sent to the model: `convertMessagesForAPI` takes only `id`/`result`/
   * `images` off a tool block.
   */
  nestedToolCalls?: string[];
  timestamp?: number; // Unix ms, set when tool result is finalized (stage="end")
}

export interface ImageBlock {
  type: "image";
  imageUrls?: string[];
}

export interface CompactBlock {
  type: "compact";
  content: string;
}

export interface ReasoningBlock {
  type: "reasoning";
  content: string;
  stage?: "streaming" | "end";
  startTime?: number; // Unix ms, set when the first reasoning content arrives
  endTime?: number; // Unix ms, set when stage transitions to "end"
}

export interface FileHistoryBlock {
  type: "file_history";
  snapshots: import("./reversion.js").FileSnapshot[];
}

export interface TaskNotificationBlock {
  type: "task_notification";
  taskId: string;
  taskType: "shell" | "agent" | "workflow";
  status: "completed" | "failed" | "killed" | "aborted";
  summary: string;
  outputFile?: string;
  /** Full final response of the task (e.g. a fork subagent's result). */
  result?: string;
}
