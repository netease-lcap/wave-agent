/**
 * Wire types for the native Anthropic Messages API.
 *
 * Taken from the official SDK as **type-only** imports: `import type` is erased
 * at compile time, so the package never reaches a runtime bundle (`dist` carries
 * no `@anthropic-ai/sdk` import, and `scripts/check-sdk-surface.mjs` keeps the
 * `/host` closure free of third-party deps). Same contract as the `openai` types
 * this repo already borrows for the Chat Completions and Responses shapes: the
 * official package is the authority on the wire format, we only narrow it to
 * what we send and read.
 *
 * Two naming sides on purpose — Anthropic models the request and response shapes
 * separately (`ContentBlockParam` is writable and may carry `cache_control`,
 * `ContentBlock` is what comes back), and using the wrong one silently allows
 * fields the server rejects. Anthropic-only features outside our subset (Batch,
 * Files, citations, computer use, context editing) stay out of scope — spec
 * core/anthropic-messages-api.md 边界情况 3.
 */

import type {
  CacheControlEphemeral,
  ContentBlock,
  ContentBlockParam,
  Message,
  MessageParam,
  RawMessageStreamEvent,
  StopReason,
  Tool,
  ToolChoice,
  ToolUseBlockParam,
  Usage,
} from "@anthropic-ai/sdk/resources/messages";

export type AnthropicCacheControl = CacheControlEphemeral;
/** A content block we build and send (writable, may carry `cache_control`). */
export type AnthropicContentBlock = ContentBlockParam;
/** A content block that came back (every field present, no `cache_control`). */
export type AnthropicResponseContentBlock = ContentBlock;
export type AnthropicToolUseBlock = ToolUseBlockParam;
export type AnthropicMessageParam = MessageParam;
export type AnthropicTool = Tool;
export type AnthropicToolChoice = ToolChoice;
export type AnthropicUsage = Usage;
export type AnthropicStopReason = StopReason;
export type AnthropicMessageResponse = Message;

/**
 * One event off the wire.
 *
 * The SDK models the six events that carry data; `ping` and `error` are sent for
 * real (both observed on the gateway) and are not in its union, so they are
 * declared here, and anything else stays ignorable rather than a type error —
 * the reader treats unknown events as no-ops.
 */
export type AnthropicMessageStreamEvent =
  | RawMessageStreamEvent
  | { type: "ping" }
  | { type: "error"; error?: { type?: string; message?: string } }
  | { type: string; [key: string]: unknown };

/**
 * One thinking block as carried through the flattened assistant message.
 *
 * Deliberately our own shape rather than `ThinkingBlockParam`: the internal list
 * also covers blocks that arrived without a signature (interrupted streams,
 * OpenAI-compatible history), which the wire type forbids — the emitter decides
 * whether a block may go out as `thinking`, and a signature-less one never does
 * (spec 边界情况 5).
 */
export interface ThinkingBlockData {
  thinking: string;
  signature?: string;
  /** Set for a `redacted_thinking` block; `thinking` is then a placeholder. */
  redacted?: string;
}
