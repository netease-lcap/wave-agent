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
    path?: string; // Local file the image can be reopened from (source file, or the persisted original)
    /**
     * "original WxH, displayed at …" note added when the image was shrunk on the
     * way into the list (utils/toolImageIngest.ts). Emitted ahead of the image
     * in the request so the model can map coordinates back to the original.
     */
    note?: string;
  }>;
  id?: string;
  name?: string;
  /**
   * Structured extras a tool attached to its result (`ToolResult.metadata`),
   * carried through to the hosts so they can render a richer block than the
   * plain text result. Hosts must treat every key as optional and fall back to
   * the text rendering when it is absent or malformed — the CLI ignores it
   * entirely.
   */
  metadata?: Record<string, unknown>;
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

/**
 * An image arriving with a user message. `path` is what the message block
 * keeps: a data URL for paste (bytes live in the block and the transcript) or a
 * file path for images that only exist as a file. `filePath` is the host-side
 * file the same bytes were written to, kept only for `[Image source: <path>]`.
 */
export interface UserImage {
  path: string;
  mimeType: string;
  filePath?: string;
}

export interface ImageBlock {
  type: "image";
  /**
   * What the UI renders: an inline data URL for images whose bytes we keep
   * (webview pastes — the transcript keeps them too, aligned with Claude Code),
   * or a file path for images that only exist as a file (CLI pastes, images a
   * tool pointed at). The remote page's copy blanks these out to keep frames
   * under the relay's budget — the array length and order still drive the
   * `[imageN]` tags in the text block.
   */
  imageUrls?: string[];
  /**
   * Where the same bytes live on the session host (a temp file the CLI wrote),
   * same order as `imageUrls`. The model gets it as `[Image source: <path>]`
   * so a vision subagent can read the file; the UI never needs it.
   */
  imagePaths?: string[];
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
  /**
   * `"hook"` is not a task: it is an async hook with `asyncRewake` that exited
   * with code 2, delivered through this channel because a notification is the
   * only way to reach the model once the turn that launched the hook is over.
   */
  taskType: "shell" | "agent" | "workflow" | "hook";
  /**
   * `"running"` is the one non-terminal member: a task that is still alive can
   * still notify about itself, and a consumer must not read that as "this task
   * is over". Every other value ends the task. (No producer sends it today —
   * the workflow size warning that used to is UI-only now — but the channel
   * keeps the member: a task that reports progress through a notification is a
   * shape consumers have to handle, not a workflow-specific quirk.)
   */
  status: "running" | "completed" | "failed" | "killed" | "aborted";
  summary: string;
  outputFile?: string;
  /**
   * The task's own result payload: a fork subagent's final response, or a
   * workflow script's `return` value (JSON-serialized, truncated past
   * `MAX_RESULT_CHARS_IN_SUMMARY` with a pointer to the full value).
   */
  result?: string;
}
