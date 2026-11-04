/**
 * Responses API transport (`POST /v1/responses`).
 *
 * Wave speaks Chat Completions everywhere above this module: history, tools and
 * generation params all arrive in that vocabulary. This module is the only place
 * that translates them, so every caller just picks which endpoint to use.
 *
 * Why the endpoint is switchable at all: from GPT-5.4 on, Chat Completions only
 * accepts function tools together with `reasoning_effort: "none"`, and the GPT-6
 * generation dropped the `none` tier entirely ("Tool calling requires the
 * Responses API"): those models are structurally unusable in Wave until their
 * requests go here. Which model uses this transport is *declared* —
 * `models[<name>].capabilities.responsesApi` — never guessed from the name
 * (spec core/responses-api.md).
 *
 * `options` is treated as expert-authored configuration: only the keys whose
 * *name* differs between the two APIs are mapped. Everything else is passed
 * through verbatim, including fields this endpoint does not accept — the server's
 * 400 says which line is wrong, whereas silently dropping a user's setting does
 * not.
 */
import type {
  ChatCompletionContentPart,
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  Responses,
} from "openai/resources.js";

import type { Usage } from "../types/index.js";
import type { OpenAIClient } from "../utils/openaiClient.js";

/** A tool choice that forces one specific function (Chat Completions shape). */
export type ForcedFunctionToolChoice = {
  type: "function";
  function: { name: string };
};

export type AgentToolChoice =
  | "auto"
  | "none"
  | "required"
  | ForcedFunctionToolChoice;

/** Shape of the `onToolUpdate` streaming callback (see CallAgentOptions). */
export type ToolUpdateHandler = (toolCall: {
  id: string;
  name: string;
  parameters?: string;
  parametersChunk?: string;
  stage?: "start" | "streaming" | "running" | "end";
}) => void;

export interface ResponsesRequestInput {
  model: string;
  /**
   * Chat-Completions-shaped history with the system message already prepended —
   * exactly what `callAgent` builds for the other endpoint.
   */
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionFunctionTool[];
  toolChoice?: AgentToolChoice;
  /** Merged generation params (Wave defaults + `models[<name>].options`). */
  params: Record<string, unknown>;
  stream: boolean;
}

/** A parsed response, expressed in Wave's (Chat Completions) vocabulary. */
export interface ParsedResponsesResult {
  content?: string;
  reasoning_content?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
  usage?: Usage;
  /** Attached by the transport (`callAgent`), not by the parser. */
  response_headers?: Record<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

/**
 * Flatten a system message's content into `instructions`. Wave sends either a
 * plain string or Anthropic-style text parts carrying `cache_control` — the
 * markers have no counterpart here, so only the text survives.
 */
function systemContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/**
 * User content parts. `image_url` becomes `input_image` with the URL kept as-is
 * (data URLs included); anything unrecognised is dropped rather than forwarded
 * in a shape the endpoint cannot read.
 */
function translateUserContent(
  content: unknown,
): string | Responses.ResponseInputContent[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: Responses.ResponseInputContent[] = [];
  for (const rawPart of content as ChatCompletionContentPart[]) {
    if (rawPart.type === "text") {
      if (rawPart.text.length > 0) {
        parts.push({ type: "input_text", text: rawPart.text });
      }
      continue;
    }
    if (rawPart.type === "image_url") {
      const image = rawPart.image_url;
      parts.push({
        type: "input_image",
        image_url: typeof image === "string" ? image : image.url,
        detail: typeof image === "string" ? "auto" : (image.detail ?? "auto"),
      });
    }
  }
  return parts;
}

/**
 * Split the chat-shaped history into `instructions` and `input` items.
 *
 * The one thing that cannot be carried over is `reasoning_content`: a `reasoning`
 * item is only replayable with the id the provider issued for it, which Wave does
 * not keep. Reasoning-only turns still carry their explanatory note in `content`,
 * so no information disappears silently.
 */
export function translateMessages(messages: ChatCompletionMessageParam[]): {
  instructions: string;
  input: Responses.ResponseInputItem[];
} {
  const instructions: string[] = [];
  const input: Responses.ResponseInputItem[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "system":
      case "developer": {
        const text = systemContentToText(message.content);
        if (text.length > 0) instructions.push(text);
        break;
      }
      case "user": {
        input.push({
          role: "user",
          content: translateUserContent(message.content),
        });
        break;
      }
      case "assistant": {
        const text =
          typeof message.content === "string" ? message.content : undefined;
        if (text && text.trim().length > 0) {
          input.push({ role: "assistant", content: text });
        }
        for (const call of message.tool_calls ?? []) {
          if (call.type !== "function") continue;
          input.push({
            type: "function_call",
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          });
        }
        break;
      }
      case "tool": {
        input.push({
          type: "function_call_output",
          call_id: message.tool_call_id,
          output: systemContentToText(message.content),
        });
        break;
      }
      default:
        break;
    }
  }

  return { instructions: instructions.join("\n\n"), input };
}

/** Chat Completions nests the function under `function`; here it is flat. */
export function translateTools(
  tools: ChatCompletionFunctionTool[],
): Responses.FunctionTool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.function.name,
    description: tool.function.description ?? null,
    parameters: (tool.function.parameters ?? null) as Record<
      string,
      unknown
    > | null,
    strict: tool.function.strict ?? null,
  }));
}

export function translateToolChoice(
  toolChoice: AgentToolChoice,
): "auto" | "none" | "required" | { type: "function"; name: string } {
  if (typeof toolChoice === "string") return toolChoice;
  return { type: "function", name: toolChoice.function.name };
}

/**
 * `response_format` keeps its shape but loses its `json_schema` wrapper; `text`
 * and `json_object` are spelled the same on both sides.
 */
function translateResponseFormat(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const format = value as { type?: unknown; json_schema?: unknown };
  if (format.type === "json_schema") {
    const schema = asRecord(format.json_schema);
    if (Object.keys(schema).length === 0) return undefined;
    return { ...schema, type: "json_schema" };
  }
  return asRecord(value);
}

/**
 * Map the generation params onto the Responses vocabulary.
 *
 * Only renames happen here — everything unrecognised stays exactly where the
 * user put it. A mapped key never overwrites a value the user already wrote in
 * the Responses shape (`reasoning` / `text`), so the explicit form always wins.
 */
export function translateGenerationParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };
  const text = asRecord(out.text);
  const reasoning = asRecord(out.reasoning);

  // Wave's own default is `max_tokens`; the documented OpenAI name for the same
  // budget is `max_completion_tokens`. Both mean "output cap" here.
  for (const key of ["max_completion_tokens", "max_tokens"] as const) {
    const value = out[key];
    if (value === undefined) continue;
    delete out[key];
    if (out.max_output_tokens === undefined) out.max_output_tokens = value;
  }

  if (out.response_format !== undefined) {
    const format = translateResponseFormat(out.response_format);
    delete out.response_format;
    if (format && text.format === undefined) text.format = format;
  }

  if (out.verbosity !== undefined) {
    if (text.verbosity === undefined) text.verbosity = out.verbosity;
    delete out.verbosity;
  }

  if (out.reasoning_effort !== undefined) {
    if (reasoning.effort === undefined) reasoning.effort = out.reasoning_effort;
    delete out.reasoning_effort;
  }

  if (Object.keys(text).length > 0) out.text = text;
  if (Object.keys(reasoning).length > 0) out.reasoning = reasoning;
  return out;
}

export function buildResponsesRequest(
  request: ResponsesRequestInput,
): Record<string, unknown> {
  const { instructions, input } = translateMessages(request.messages);
  const body: Record<string, unknown> = {
    ...translateGenerationParams(request.params),
    model: request.model,
    input,
    stream: request.stream,
  };

  if (instructions.length > 0) body.instructions = instructions;
  if (request.tools && request.tools.length > 0) {
    body.tools = translateTools(request.tools);
  }
  if (request.toolChoice !== undefined) {
    body.tool_choice = translateToolChoice(request.toolChoice);
  }
  return body;
}

export function mapResponsesUsage(
  usage: Responses.ResponseUsage | null | undefined,
): Usage | undefined {
  if (!usage) return undefined;
  const mapped: Usage = {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
  };
  // Cache fields are reported but deliberately kept out of `total_tokens`, which
  // is what the context-usage display reads (spec core/prompt-cache-control.md).
  const details = usage.input_tokens_details;
  if (details?.cached_tokens != null) {
    mapped.cache_read_input_tokens = details.cached_tokens;
  }
  if (details?.cache_write_tokens != null) {
    mapped.cache_creation_input_tokens = details.cache_write_tokens;
  }
  return mapped;
}

/**
 * Read a completed response into Wave's vocabulary.
 *
 * `finish_reason` is the load-bearing part: mapping "incomplete because we ran
 * out of output tokens" onto `length` is what keeps the truncation auto-continue
 * path (spec core/ai-error-handling.md) working on this endpoint.
 */
export function parseResponsesResult(
  response: Responses.Response,
): ParsedResponsesResult {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCalls: ChatCompletionMessageToolCall[] = [];

  for (const item of response.output ?? []) {
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type === "output_text") textParts.push(part.text);
        else if (part.type === "refusal") textParts.push(part.refusal);
      }
      continue;
    }
    if (item.type === "reasoning") {
      for (const summary of item.summary ?? [])
        reasoningParts.push(summary.text);
      for (const part of item.content ?? []) reasoningParts.push(part.text);
      continue;
    }
    if (item.type === "function_call") {
      // `call_id` — not the item id — is what pairs this call with its output.
      toolCalls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      });
    }
  }

  const result: ParsedResponsesResult = { finish_reason: "stop" };

  const content = textParts.join("").trim();
  if (content.length > 0) result.content = content;

  const reasoning = reasoningParts.join("").trim();
  if (reasoning.length > 0) result.reasoning_content = reasoning;

  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls;
    result.finish_reason = "tool_calls";
  } else if (response.status === "incomplete") {
    result.finish_reason =
      response.incomplete_details?.reason === "content_filter"
        ? "content_filter"
        : "length";
  }

  const usage = mapResponsesUsage(response.usage);
  if (usage) result.usage = usage;

  return result;
}

function failedResponseError(response: Responses.Response): Error {
  const detail = response.error;
  const message = detail?.message
    ? `Responses API request failed: ${detail.message}`
    : "Responses API request failed";
  return new Error(message);
}

export interface ResponsesStreamHandlers {
  onContentDelta?: (delta: string) => void;
  onToolUpdate?: ToolUpdateHandler;
  onReasoningDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
}

/**
 * Consume a Responses event stream.
 *
 * Deltas drive the UI callbacks only; the final result is parsed from the
 * terminal event's response, which carries the complete output. That is what
 * makes streamed and non-streamed requests yield identical results, and it means
 * a stream that dies before a terminal event is unambiguously truncated — it is
 * thrown as such, landing in `callAgent`'s existing non-streaming re-issue.
 */
export async function processResponsesStream(
  stream: AsyncIterable<Responses.ResponseStreamEvent>,
  handlers: ResponsesStreamHandlers,
): Promise<ParsedResponsesResult> {
  let terminal: Responses.Response | undefined;
  const toolCallsByOutputIndex = new Map<
    number,
    { id: string; name: string }
  >();

  for await (const event of stream) {
    if (handlers.abortSignal?.aborted) {
      throw new Error("Request was aborted");
    }

    switch (event.type) {
      case "response.output_text.delta": {
        if (event.delta.length > 0) handlers.onContentDelta?.(event.delta);
        break;
      }
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta": {
        if (event.delta.length > 0) handlers.onReasoningDelta?.(event.delta);
        break;
      }
      case "response.output_item.added": {
        const item = event.item;
        if (item.type !== "function_call") break;
        toolCallsByOutputIndex.set(event.output_index, {
          id: item.call_id,
          name: item.name,
        });
        handlers.onToolUpdate?.({
          id: item.call_id,
          name: item.name,
          parameters: "",
          parametersChunk: "",
          stage: "start",
        });
        break;
      }
      case "response.function_call_arguments.delta": {
        const call = toolCallsByOutputIndex.get(event.output_index);
        if (!call || event.delta.length === 0) break;
        handlers.onToolUpdate?.({
          id: call.id,
          name: call.name,
          parametersChunk: event.delta,
          stage: "streaming",
        });
        break;
      }
      case "response.completed":
      case "response.incomplete": {
        terminal = event.response;
        break;
      }
      case "response.failed": {
        throw failedResponseError(event.response);
      }
      case "error": {
        throw new Error(`Responses API stream error: ${event.message}`);
      }
      default:
        break;
    }
  }

  if (!terminal) {
    // Same rule as the Chat Completions reader: only the protocol may end a
    // turn. A silently closed connection upstream must not be stored as the
    // whole answer.
    throw new Error(
      "Responses stream ended without a terminal event — treating as truncated",
    );
  }

  return parseResponsesResult(terminal);
}

export interface ResponsesTextRequest {
  client: OpenAIClient;
  model: string;
  systemPrompt: string;
  userContent: string;
  /** Merged generation params — the same object the chat path would spread. */
  params: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

/**
 * One-shot, tool-less text request over the Responses endpoint.
 *
 * Web content processing, inline completion and next-edit all need exactly this
 * and nothing else (no tools, no streaming, one string back). They share it so a
 * model that only speaks Responses does not work in the main loop but fail the
 * moment the same model summarises a web page (spec core/responses-api.md 边界情况
 * 8).
 */
export async function requestResponsesText(
  request: ResponsesTextRequest,
): Promise<{ content: string; usage?: Usage }> {
  const body = buildResponsesRequest({
    model: request.model,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userContent },
    ],
    params: request.params,
    stream: false,
  });

  const response = (await request.client.responses.create(
    body as unknown as Responses.ResponseCreateParamsNonStreaming,
    { signal: request.abortSignal },
  )) as Responses.Response;

  const parsed = parseResponsesResult(response);
  return { content: parsed.content ?? "", usage: parsed.usage };
}
