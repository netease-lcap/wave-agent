/**
 * Message and communication block types
 * Dependencies: Core (Usage), Hooks (HookEventName)
 */

import type { Usage } from "./core.js";
import type { HookEventName } from "./hooks.js";

export interface Message {
  role: "user" | "assistant";
  blocks: MessageBlock[];
  usage?: Usage; // Usage data for this message's AI operation (assistant messages only)
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
  | CustomCommandBlock
  | SubagentBlock
  | WarnBlock
  | HookBlock;

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
  shortResult?: string; // Add shortResult field
  images?: Array<{
    // Add image data support
    data: string; // Base64 encoded image data
    mediaType?: string; // Media type of the image
  }>;
  id?: string;
  name?: string;
  isRunning?: boolean; // Mark if tool is actually executing
  success?: boolean;
  error?: string | Error;
  compactParams?: string; // Compact parameter display
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
}

export interface MemoryBlock {
  type: "memory";
  content: string;
  isSuccess: boolean;
  memoryType?: "project" | "user"; // Memory type
  storagePath?: string; // Storage path text
}

export interface CustomCommandBlock {
  type: "custom_command";
  commandName: string;
  content: string; // Complete command content, used when passing to AI
  originalInput?: string; // Original user input, used for UI display (e.g., "/fix-issue 123 high")
}

export interface SubagentBlock {
  type: "subagent";
  subagentId: string;
  subagentName: string;
  status: "active" | "completed" | "error" | "aborted";
  messages: Message[];
}

// New message block types for hook output
export interface WarnBlock {
  type: "warn";
  content: string;
}

export interface HookBlock {
  type: "hook";
  hookEvent: HookEventName;
  content: string;
  metadata?: Record<string, unknown>;
}
