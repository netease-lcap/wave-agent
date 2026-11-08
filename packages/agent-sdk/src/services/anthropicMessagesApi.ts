/**
 * Native Anthropic Messages API translation layer.
 *
 * Sits exactly where `services/responsesApi.ts` sits for the Responses endpoint:
 * everything above this module still speaks Chat Completions (the internal
 * message model is flattened into `ChatCompletionMessageParam[]` by
 * `utils/convertMessagesForAPI.ts`), and this file turns that shape into a
 * Messages request body and turns the response back into `CallAgentResult`.
 *
 * Three things are *not* lossy in this direction and are the reason the
 * endpoint exists (spec core/anthropic-messages-api.md):
 *
 * 1. Thinking blocks stay blocks. The flattened assistant message carries the
 *    ordered list on a private `anthropic_thinking` field, emitted here as
 *    `{type:"thinking", thinking, signature}` — signature verbatim. A thinking
 *    block without a signature is **never** emitted as a `thinking` block: the
 *    server rejects unsigned thinking, so the text goes out as assistant
 *    content instead (边界情况 5).
 * 2. `thinking` / `cache_control` need no translation at all — the values Wave
 *    already configures are the native shapes.
 * 3. Tool results pair by `tool_use_id` inside the following user turn.
 */

import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources.js";
import { logger } from "../utils/globalLogger.js";
import { serializeError } from "../utils/errorUtils.js";
import type { Usage } from "../types/index.js";
import type { SystemPromptBlock } from "../prompts/index.js";
import type {
  AnthropicContentBlock,
  AnthropicMessageParam,
  AnthropicMessageResponse,
  AnthropicMessageStreamEvent,
  AnthropicResponseContentBlock,
  AnthropicStopReason,
  AnthropicTool,
  AnthropicToolChoice,
  AnthropicToolUseBlock,
  ThinkingBlockData,
} from "../types/anthropicMessages.js";

/**
 * The flattened assistant message may carry the ordered thinking blocks.
 *
 * A private field rather than extra content parts on purpose: the same array is
 * handed to all three transports, and an OpenAI-compatible body must never see
 * `anthropic_thinking` (spec「请求结构翻译」场景 1).
 */
export type FlattenedAssistantMessage = ChatCompletionMessageParam & {
  anthropic_thinking?: ThinkingBlockData[];
};

export interface MessagesRequestOptions {
  model: string;
  systemPrompt?: string | SystemPromptBlock[];
  /** Flattened history WITHOUT the system message. */
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionFunctionTool[];
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  /** Model config: `model`, `max_tokens`, and the user's `options` verbatim. */
  params: Record<string, unknown>;
  stream: boolean;
  supportsCaching: boolean;
}

export interface MessagesCallbacks {
  onContentDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  onToolUpdate?: (toolCall: {
    id: string;
    name: string;
    parameters?: string;
    parametersChunk?: string;
    stage?: "start" | "streaming" | "running" | "end";
  }) => void;
  abortSignal?: AbortSignal;
}

export interface MessagesParsedResult {
  content?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
  reasoning_content?: string;
  thinking_blocks?: ThinkingBlockData[];
  usage?: Usage;
  finish_reason?:
    | "stop"
    | "length"
    | "tool_calls"
    | "content_filter"
    | "function_call"
    | null;
}

// ---------------------------------------------------------------------------
// Request: Chat Completions shape -> Messages body
// ---------------------------------------------------------------------------

function toSystemBlocks(
  systemPrompt: string | SystemPromptBlock[] | undefined,
  supportsCaching: boolean,
): AnthropicContentBlock[] | undefined {
  if (systemPrompt === undefined || systemPrompt === "") return undefined;
  if (typeof systemPrompt === "string") {
    return [{ type: "text", text: systemPrompt }];
  }
  const blocks: AnthropicContentBlock[] = systemPrompt.map((block) => {
    // `cache_control` is native here — the same marker Wave already attaches on
    // OpenAI content parts (utils/cacheControlUtils.ts) rides along unchanged
    // (spec 边界情况：promptCaching 与 apiType 组合).
    if (supportsCaching && block.cacheable) {
      return {
        type: "text",
        text: block.text,
        cache_control: { type: "ephemeral" },
      };
    }
    return { type: "text", text: block.text };
  });
  return blocks.length > 0 ? blocks : undefined;
}

/** `data:` URLs become base64 sources; everything else stays a URL source. */
function toImageBlock(url: string): AnthropicContentBlock | undefined {
  const dataUrl = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (dataUrl) {
    return {
      type: "image",
      source: {
        type: "base64",
        // Anthropic accepts four media types; the value comes from the `data:`
        // URL we were handed and goes out as-is. An unsupported one is a 400 the
        // user can act on, never a type we guessed at (same rule as `options`).
        media_type: dataUrl[1] as "image/png",
        data: dataUrl[2],
      },
    };
  }
  if (url) {
    return { type: "image", source: { type: "url", url } };
  }
  return undefined;
}

type LooseMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
  anthropic_thinking?: ThinkingBlockData[];
};

function contentPartsToBlocks(content: unknown): AnthropicContentBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const blocks: AnthropicContentBlock[] = [];
  for (const raw of content) {
    const part = raw as {
      type?: string;
      text?: string;
      image_url?: { url?: string };
    };
    if (part.type === "text" && typeof part.text === "string") {
      blocks.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "image_url" && part.image_url?.url) {
      const image = toImageBlock(part.image_url.url);
      if (image) blocks.push(image);
    }
  }
  return blocks;
}

function toolCallsToBlocks(toolCalls: unknown): AnthropicToolUseBlock[] {
  if (!Array.isArray(toolCalls)) return [];
  const blocks: AnthropicToolUseBlock[] = [];
  for (const raw of toolCalls) {
    const call = raw as {
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    if (!call.id || !call.function?.name) continue;
    let input: unknown = {};
    try {
      input = call.function.arguments
        ? JSON.parse(call.function.arguments)
        : {};
    } catch (e) {
      // `convertMessagesForAPI` already guarantees parseable JSON
      // (`safeToolArguments`); reaching here means the guarantee slipped, and an
      // unparseable input must not silently become an empty call.
      logger.warn("Replaying a tool call whose arguments are not JSON", {
        tool: call.function.name,
        error: serializeError(e),
      });
      input = {};
    }
    blocks.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input,
    });
  }
  return blocks;
}

function thinkingBlockToContent(
  data: ThinkingBlockData,
): AnthropicContentBlock | undefined {
  if (data.redacted) {
    return { type: "redacted_thinking", data: data.redacted };
  }
  if (!data.signature) {
    // Unsigned thinking cannot be replayed as a thinking block; leaving it out
    // is the only valid move (the server would reject it).
    return undefined;
  }
  return {
    type: "thinking",
    thinking: data.thinking,
    signature: data.signature,
  };
}

function assistantToParam(
  message: LooseMessage,
): AnthropicMessageParam | undefined {
  const blocks: AnthropicContentBlock[] = [];

  // Thinking blocks go first: Anthropic requires them to precede tool_use in a
  // turn that carries both.
  const thinking = message.anthropic_thinking ?? [];
  const unsignedThinking: string[] = [];
  for (const entry of thinking) {
    const block = thinkingBlockToContent(entry);
    if (block) {
      blocks.push(block);
    } else if (entry.thinking.trim().length > 0) {
      unsignedThinking.push(entry.thinking);
    }
  }

  const bodyBlocks = contentPartsToBlocks(message.content);
  // An unsigned thinking block survives as plain assistant text — the model then
  // at least sees what it thought last turn, and the request stays valid.
  if (unsignedThinking.length > 0) {
    blocks.push({ type: "text", text: unsignedThinking.join("\n") });
  }
  blocks.push(...bodyBlocks);
  blocks.push(...toolCallsToBlocks(message.tool_calls));

  if (blocks.length === 0) return undefined;
  return { role: "assistant", content: blocks };
}

/**
 * Fold the flattened history into Anthropic's alternating user/assistant turns.
 *
 * Two shapes only exist on this side:
 * - `role:"tool"` messages become `tool_result` blocks at the FRONT of the next
 *   user turn (Anthropic has no `tool` role, and tool_result blocks must lead the
 *   content array).
 * - Adjacent same-role turns merge, because Anthropic rejects two `user` or two
 *   `assistant` messages in a row while Wave's flattened history does produce
 *   them (a tool-result turn followed by a user interjection).
 */
function toMessagesParam(
  messages: ChatCompletionMessageParam[],
): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = [];
  let pendingToolResults: AnthropicContentBlock[] = [];

  const pushBlocks = (
    role: "user" | "assistant",
    blocks: AnthropicContentBlock[],
  ) => {
    if (blocks.length === 0) return;
    const last = result[result.length - 1];
    if (last && last.role === role) {
      const existing = Array.isArray(last.content)
        ? last.content
        : last.content
          ? [{ type: "text", text: last.content } as AnthropicContentBlock]
          : [];
      last.content = [...existing, ...blocks];
      return;
    }
    result.push({ role, content: blocks });
  };

  for (const raw of messages) {
    const message = raw as LooseMessage;
    if (message.role === "system" || message.role === "developer") continue;

    if (message.role === "tool") {
      if (!message.tool_call_id) continue;
      const text =
        typeof message.content === "string"
          ? message.content
          : contentPartsToBlocks(message.content)
              .map((block) => (block.type === "text" ? block.text : ""))
              .join("");
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: text,
      });
      continue;
    }

    if (message.role === "assistant") {
      // A tool_result group has to close here, before the assistant turn that
      // follows it. Waiting for the next *user* turn — the shape every
      // second round of the agent loop has — would hoist the result past the
      // model's own reply and merge the two assistant turns into one whose
      // `tool_use` is followed by text, hiding the tool exchange from the
      // model.
      if (pendingToolResults.length > 0) {
        pushBlocks("user", pendingToolResults);
        pendingToolResults = [];
      }
      const param = assistantToParam(message);
      if (param)
        pushBlocks("assistant", param.content as AnthropicContentBlock[]);
      continue;
    }

    // user
    const blocks = [
      ...pendingToolResults,
      ...contentPartsToBlocks(message.content),
    ];
    pendingToolResults = [];
    pushBlocks("user", blocks);
  }

  // A trailing tool-result group with no user turn after it still needs a home.
  if (pendingToolResults.length > 0) {
    pushBlocks("user", pendingToolResults);
  }

  return result;
}

function toToolsParam(
  tools?: ChatCompletionFunctionTool[],
): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => {
    const parameters = tool.function.parameters;
    return {
      name: tool.function.name,
      ...(tool.function.description
        ? { description: tool.function.description }
        : {}),
      // `type: "object"` is required by Anthropic, and a function's parameters
      // are an object schema by definition — the OpenAI shape simply leaves the
      // keyword optional, so it is filled in here.
      input_schema: {
        ...((parameters ?? {}) as Record<string, unknown>),
        type: "object",
      },
    };
  });
}

function toToolChoiceParam(
  toolChoice: MessagesRequestOptions["toolChoice"],
): AnthropicToolChoice | undefined {
  if (toolChoice === undefined) return undefined;
  if (toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "none") return { type: "none" };
  if (toolChoice === "required") return { type: "any" };
  return { type: "tool", name: toolChoice.function.name };
}

/** Mark the last text block of the last turn — the rolling cache breakpoint. */
function markRollingCacheBreakpoint(messages: AnthropicMessageParam[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i].content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (block.type === "text") {
        content[j] = { ...block, cache_control: { type: "ephemeral" } };
        return;
      }
    }
  }
}

export function buildMessagesRequest(
  options: MessagesRequestOptions,
): Record<string, unknown> {
  const messages = toMessagesParam(options.messages);
  if (options.supportsCaching) {
    markRollingCacheBreakpoint(messages);
  }

  const system = toSystemBlocks(options.systemPrompt, options.supportsCaching);
  const tools = toToolsParam(options.tools);
  const toolChoice = toToolChoiceParam(options.toolChoice);

  // Everything the user wrote in `options` rides through untouched — including
  // keys Anthropic has no use for (`reasoning_effort`), which the server rejects
  // with a 400 the user can act on. Silently dropping configuration was decided
  // against in the Responses spec and applies here as well (边界情况 4).
  const body: Record<string, unknown> = {
    ...options.params,
    model: options.model,
    messages,
    max_tokens: options.params.max_tokens,
    stream: options.stream,
  };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  return body;
}

// ---------------------------------------------------------------------------
// Response: Messages body -> CallAgentResult shape
// ---------------------------------------------------------------------------

function toFinishReason(
  stopReason: AnthropicStopReason | null | undefined,
): MessagesParsedResult["finish_reason"] {
  if (stopReason === "end_turn" || stopReason === "stop_sequence")
    return "stop";
  if (stopReason === "tool_use") return "tool_calls";
  if (stopReason === "max_tokens") return "length";
  // `pause_turn` / `refusal` / anything unknown: completing-with-unknown is the
  // only mapping that cannot make the truncation auto-continue misfire.
  return stopReason ? "stop" : null;
}

/**
 * `prompt_tokens` is the sum of uncached input plus both cache buckets: the
 * context-occupancy readout takes `total_tokens`, and Anthropic reports the
 * buckets separately — adding them here keeps the semantics identical to the
 * Chat Completions path (spec「响应解析与用量口径」场景 3).
 */
/**
 * The usage fields Wave reads. Kept loose because the stream reports them in two
 * places (`message_start` carries a full `Usage`, `message_delta` a partial one)
 * and the SDK types both cache buckets as `number | null`.
 */
type UsageNumbers = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function toUsage(usage: UsageNumbers | undefined): Usage | undefined {
  if (!usage) return undefined;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const promptTokens = (usage.input_tokens ?? 0) + cacheRead + cacheCreation;
  const completionTokens = usage.output_tokens ?? 0;
  const result: Usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
  if (cacheRead > 0) result.cache_read_input_tokens = cacheRead;
  if (cacheCreation > 0) result.cache_creation_input_tokens = cacheCreation;
  return result;
}

function thinkingBlocksFromContent(
  content: AnthropicResponseContentBlock[],
): ThinkingBlockData[] {
  const blocks: ThinkingBlockData[] = [];
  for (const block of content) {
    if (block.type === "thinking") {
      blocks.push({ thinking: block.thinking, signature: block.signature });
    } else if (block.type === "redacted_thinking") {
      // Opaque: never decoded, never shown, only replayed.
      blocks.push({ thinking: "", redacted: block.data });
    }
  }
  return blocks;
}

export function parseMessagesResult(
  response: AnthropicMessageResponse,
): MessagesParsedResult {
  const content = response.content ?? [];
  const text = content
    .filter(
      (
        block,
      ): block is Extract<AnthropicResponseContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("");

  const thinkingBlocks = thinkingBlocksFromContent(content);
  const reasoningText = thinkingBlocks
    .map((block) => block.thinking)
    .filter((value) => value.trim().length > 0)
    .join("\n");

  const toolCalls: ChatCompletionMessageToolCall[] = content
    .filter(
      (
        block,
      ): block is Extract<
        AnthropicResponseContentBlock,
        { type: "tool_use" }
      > => block.type === "tool_use",
    )
    .map((block) => ({
      id: block.id,
      type: "function" as const,
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      },
    }));

  const result: MessagesParsedResult = {};
  if (text.trim().length > 0) result.content = text;
  if (reasoningText.length > 0) result.reasoning_content = reasoningText;
  if (thinkingBlocks.length > 0) result.thinking_blocks = thinkingBlocks;
  if (toolCalls.length > 0) result.tool_calls = toolCalls;

  const usage = toUsage(response.usage);
  if (usage) result.usage = usage;

  const finishReason = toFinishReason(response.stop_reason);
  if (finishReason) result.finish_reason = finishReason;

  return result;
}

interface StreamBlockState {
  type: "text" | "thinking" | "tool_use" | "redacted_thinking" | "other";
  text: string;
  thinking: string;
  signature?: string;
  redacted?: string;
  toolId?: string;
  toolName?: string;
  partialJson: string;
}

/**
 * Consume a Messages event stream.
 *
 * The protocol sends the signature as its own `signature_delta` right before
 * the block's `content_block_stop`, i.e. body and signature arrive separately —
 * which is exactly why the signature is accumulated per block index here rather
 * than attached to the text as it streams.
 */
export async function processMessagesStream(
  stream: AsyncIterable<AnthropicMessageStreamEvent>,
  callbacks: MessagesCallbacks,
  responseHeaders?: Record<string, string>,
): Promise<
  MessagesParsedResult & { response_headers?: Record<string, string> }
> {
  const blocks = new Map<number, StreamBlockState>();
  let stopReason: AnthropicStopReason | null = null;
  let usage: ReturnType<typeof toUsage>;
  let lastUsageRaw: UsageNumbers | undefined;

  for await (const event of stream) {
    switch (event.type) {
      case "message_start": {
        const started = event as Extract<
          AnthropicMessageStreamEvent,
          { type: "message_start" }
        >;
        lastUsageRaw = started.message?.usage ?? lastUsageRaw;
        break;
      }
      case "content_block_start": {
        const started = event as Extract<
          AnthropicMessageStreamEvent,
          { type: "content_block_start" }
        >;
        const block = started.content_block;
        const state: StreamBlockState = {
          type: "other",
          text: "",
          thinking: "",
          partialJson: "",
        };
        if (block.type === "text") {
          state.type = "text";
          // A block may start with content already (rare but legal).
          if (block.text) {
            state.text = block.text;
            callbacks.onContentDelta?.(block.text);
          }
        } else if (block.type === "thinking") {
          state.type = "thinking";
          state.signature = block.signature;
          if (block.thinking) {
            state.thinking = block.thinking;
            callbacks.onReasoningDelta?.(block.thinking);
          }
        } else if (block.type === "redacted_thinking") {
          state.type = "redacted_thinking";
          state.redacted = block.data;
        } else if (block.type === "tool_use") {
          state.type = "tool_use";
          state.toolId = block.id;
          state.toolName = block.name;
          state.partialJson =
            block.input && Object.keys(block.input as object).length > 0
              ? JSON.stringify(block.input)
              : "";
          if (state.toolId && state.toolName) {
            callbacks.onToolUpdate?.({
              id: state.toolId,
              name: state.toolName,
              stage: "start",
              ...(state.partialJson ? { parameters: state.partialJson } : {}),
            });
          }
        }
        blocks.set(started.index, state);
        break;
      }
      case "content_block_delta": {
        const deltaEvent = event as Extract<
          AnthropicMessageStreamEvent,
          { type: "content_block_delta" }
        >;
        const state = blocks.get(deltaEvent.index);
        if (!state) break;
        const delta = deltaEvent.delta;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          state.text += delta.text;
          callbacks.onContentDelta?.(delta.text);
        } else if (
          delta.type === "thinking_delta" &&
          typeof delta.thinking === "string"
        ) {
          state.thinking += delta.thinking;
          callbacks.onReasoningDelta?.(delta.thinking);
        } else if (
          delta.type === "signature_delta" &&
          typeof delta.signature === "string"
        ) {
          state.signature = delta.signature;
        } else if (
          delta.type === "input_json_delta" &&
          typeof delta.partial_json === "string"
        ) {
          state.partialJson += delta.partial_json;
          if (state.toolId && state.toolName) {
            callbacks.onToolUpdate?.({
              id: state.toolId,
              name: state.toolName,
              parametersChunk: delta.partial_json,
              stage: "streaming",
            });
          }
        }
        break;
      }
      case "content_block_stop": {
        const stopEvent = event as Extract<
          AnthropicMessageStreamEvent,
          { type: "content_block_stop" }
        >;
        const state = blocks.get(stopEvent.index);
        if (state?.type === "tool_use" && state.toolId && state.toolName) {
          callbacks.onToolUpdate?.({
            id: state.toolId,
            name: state.toolName,
            parameters: state.partialJson || "{}",
            stage: "end",
          });
        }
        break;
      }
      case "message_delta": {
        const deltaEvent = event as Extract<
          AnthropicMessageStreamEvent,
          { type: "message_delta" }
        >;
        if (deltaEvent.delta?.stop_reason !== undefined) {
          stopReason = deltaEvent.delta.stop_reason;
        }
        if (deltaEvent.usage) {
          lastUsageRaw = { ...lastUsageRaw, ...deltaEvent.usage };
        }
        break;
      }
      case "message_stop":
        break;
      case "ping":
        break;
      case "error": {
        const errorEvent = event as Extract<
          AnthropicMessageStreamEvent,
          { type: "error" }
        >;
        throw new Error(
          `Anthropic Messages error: ${errorEvent.error?.type ?? "unknown"}: ${errorEvent.error?.message ?? ""}`,
        );
      }
      default:
        break;
    }
  }

  if (stopReason === null && !callbacks.abortSignal?.aborted) {
    // Same truncation verdict as the Chat Completions reader: a body that ended
    // without a stop reason cannot be trusted as complete, and the caller
    // re-issues it non-streaming.
    throw new Error("Stream ended without a stop_reason (truncated response)");
  }

  const ordered = Array.from(blocks.entries())
    .sort(([a], [b]) => a - b)
    .map(([, state]) => state);

  const content = ordered
    .filter((state) => state.type === "text")
    .map((state) => state.text)
    .join("");

  const thinkingBlocks: ThinkingBlockData[] = ordered
    .filter(
      (state) =>
        state.type === "thinking" || state.type === "redacted_thinking",
    )
    .map((state) =>
      state.type === "redacted_thinking"
        ? { thinking: "", redacted: state.redacted }
        : { thinking: state.thinking, signature: state.signature },
    );

  const toolCalls: ChatCompletionMessageToolCall[] = ordered
    .filter(
      (state) => state.type === "tool_use" && state.toolId && state.toolName,
    )
    .map((state) => ({
      id: state.toolId!,
      type: "function" as const,
      function: {
        name: state.toolName!,
        arguments: state.partialJson || "{}",
      },
    }));

  usage = toUsage(lastUsageRaw);

  const result: MessagesParsedResult & {
    response_headers?: Record<string, string>;
  } = {};
  if (content.trim().length > 0) result.content = content;
  const reasoningText = thinkingBlocks
    .map((block) => block.thinking)
    .filter((value) => value.trim().length > 0)
    .join("\n");
  if (reasoningText.length > 0) result.reasoning_content = reasoningText;
  if (thinkingBlocks.length > 0) result.thinking_blocks = thinkingBlocks;
  if (toolCalls.length > 0) result.tool_calls = toolCalls;
  if (usage) result.usage = usage;
  const finishReason = toFinishReason(stopReason);
  if (finishReason) result.finish_reason = finishReason;
  if (responseHeaders && Object.keys(responseHeaders).length > 0) {
    result.response_headers = responseHeaders;
  }
  return result;
}

/** Single-shot text request for the non-agent paths (web content, completion, next-edit). */
export async function requestMessagesText(args: {
  client: {
    messages: {
      create: (
        params: Record<string, unknown> & {
          model: string;
          messages: unknown[];
          max_tokens: number;
        },
        options?: { signal?: AbortSignal },
      ) => Promise<unknown>;
    };
  };
  model: string;
  systemPrompt?: string | SystemPromptBlock[];
  userContent: string;
  params: Record<string, unknown>;
  abortSignal?: AbortSignal;
}): Promise<{ content: string; usage?: Usage }> {
  const body = buildMessagesRequest({
    model: args.model,
    systemPrompt: args.systemPrompt,
    messages: [{ role: "user", content: args.userContent }],
    params: args.params,
    stream: false,
    supportsCaching: false,
  });

  const response = (await args.client.messages.create(
    body as Record<string, unknown> & {
      model: string;
      messages: unknown[];
      max_tokens: number;
    },
    { signal: args.abortSignal },
  )) as AnthropicMessageResponse;

  const parsed = parseMessagesResult(response);
  return {
    content: parsed.content ?? "",
    usage: parsed.usage,
  };
}
