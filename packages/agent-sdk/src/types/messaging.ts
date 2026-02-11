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
  id?: string; // Unique identifier for the message
  role: "user" | "assistant";
  blocks: MessageBlock[];
  usage?: Usage; // Usage data for this message's AI operation (assistant messages only)
  additionalFields?: Record<string, unknown>; // Additional metadata from AI responses
}

export type MessageBlock =
  | TextBlock
  | ErrorBlock
  | ToolBlock
  | ImageBlock
  | CommandOutputBlock
  | CompressBlock
  | SubagentBlock
  | ReasoningBlock
  | FileHistoryBlock;

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
  isManuallyBackgrounded?: boolean; // Whether the tool was manually backgrounded by the user
}

export interface ImageBlock {
  type: "image";
  imageUrls?: string[];
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

export interface SubagentBlock {
  type: "subagent";
  subagentId: string;
  subagentName: string;
  status: "active" | "completed" | "error" | "aborted";
  sessionId: string;
  configuration: SubagentConfiguration;
  runInBackground?: boolean;
}

export interface ReasoningBlock {
  type: "reasoning";
  content: string;
}

export interface FileHistoryBlock {
  type: "file_history";
  snapshots: import("./reversion.js").FileSnapshot[];
}
