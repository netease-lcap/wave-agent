/**
 * Session Tracing -- OpenTelemetry Span Management
 *
 * Provides span creation/ending APIs for interactions, LLM requests, and tool
 * executions. Uses two independent AsyncLocalStorage contexts:
 * - interactionContext: holds the interaction span for the entire turn
 * - toolContext: holds the current tool span (cleared on end)
 *
 * LLM request spans do not enter any ALS; they are passed explicitly to
 * endLLMRequestSpan, aligning with Claude Code's approach.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { Span } from "@opentelemetry/api";
import {
  getOTELApi,
  isInitialized,
  getCurrentConfig,
} from "./instrumentation.js";
import { logOTelEvent } from "./events.js";
import type {
  LLMRequestMetadata,
  LLMRequestInput,
  ToolMetadata,
} from "../types/telemetry.js";

// -- Constants --

/** Max content length for span attributes (60KB, aligning with Claude Code) */
const MAX_CONTENT_LENGTH = 60000;

// -- AsyncLocalStorage for context propagation --

const interactionContext = new AsyncLocalStorage<Span | undefined>();
const toolContext = new AsyncLocalStorage<Span | undefined>();

// -- Incremental tracking state (module-level, per session) --

/** Number of messages already reported in new_context; only deltas are sent */
let lastReportedMessageCount = 0;
/** Set of system prompt hashes already emitted via logOTelEvent */
const seenSystemPromptHashes = new Set<string>();
/** Set of tool schema hashes already emitted via logOTelEvent */
const seenToolSchemaHashes = new Set<string>();

// -- Helpers --

/** Computes SHA-256 hash of content, returns first 12 hex characters */
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 12);
}

/** Truncates content to MAX_CONTENT_LENGTH, returns [truncated, originalLength] */
function truncateContent(content: string): [string, number] {
  const originalLength = content.length;
  if (originalLength > MAX_CONTENT_LENGTH) {
    return [content.substring(0, MAX_CONTENT_LENGTH), originalLength];
  }
  return [content, originalLength];
}

// -- Tracer accessor --

function getTracer() {
  if (!isInitialized()) return undefined;
  const otelApi = getOTELApi();
  if (!otelApi) return undefined;
  return otelApi.trace.getTracer("wave");
}

// -- Public API --

/**
 * Creates an interaction span for a user turn.
 * The span is stored in interactionContext for the duration of the turn.
 */
export function startInteractionSpan(
  userPrompt: string,
  sequence: number,
): Span | undefined {
  const tracer = getTracer();
  if (!tracer) return undefined;

  const config = getCurrentConfig();
  const attributes: Record<string, string | number> = {
    "span.type": "interaction",
    user_prompt_length: userPrompt.length,
    "interaction.sequence": sequence,
  };
  if (config?.logUserPrompts) {
    attributes.user_prompt = userPrompt;
  }

  const span = tracer.startSpan("interaction", { attributes });
  interactionContext.enterWith(span);
  return span;
}

/**
 * Ends the current interaction span and clears the context.
 */
export function endInteractionSpan(): void {
  const span = interactionContext.getStore();
  if (!span) return;
  span.end();
  interactionContext.enterWith(undefined);
}

/**
 * Resets incremental tracing state. Should be called after compaction to
 * prevent incorrect delta calculations.
 */
export function resetTracingState(): void {
  lastReportedMessageCount = 0;
  seenSystemPromptHashes.clear();
  seenToolSchemaHashes.clear();
}

/**
 * Creates an LLM request span as a child of the interaction span.
 * Does NOT enter any ALS — the span must be passed explicitly to endLLMRequestSpan.
 *
 * When logToolContent is enabled, captures:
 * - system_prompt_hash / system_prompt_preview / system_prompt_length
 * - new_context (incremental messages delta)
 * - tools (JSON array of {name, hash}) / tools_count
 */
export function startLLMRequestSpan(
  model: string,
  options?: LLMRequestInput,
): Span | undefined {
  const tracer = getTracer();
  if (!tracer) return undefined;

  const attributes: Record<string, string | number | boolean> = {
    "span.type": "llm_request",
    model,
  };
  if (options?.context) {
    attributes["llm_request.context"] = options.context;
  }

  const config = getCurrentConfig();

  // Content capture gated by logToolContent
  if (config?.logToolContent) {
    // System prompt: hash + preview + length
    if (options?.systemPrompt) {
      const hash = hashContent(options.systemPrompt);
      attributes.system_prompt_hash = hash;
      attributes.system_prompt_length = options.systemPrompt.length;
      const preview =
        options.systemPrompt.length > 500
          ? options.systemPrompt.substring(0, 500)
          : options.systemPrompt;
      attributes.system_prompt_preview = preview;

      // Emit full system prompt via event only once per hash
      if (!seenSystemPromptHashes.has(hash)) {
        seenSystemPromptHashes.add(hash);
        logOTelEvent("system_prompt", {
          system_prompt_hash: hash,
          system_prompt: options.systemPrompt,
        }).catch(() => {});
      }
    }

    // Incremental input messages: only send new messages since last report
    if (options?.inputMessages && options.inputMessages.length > 0) {
      const totalCount = options.inputMessages.length;
      const deltaCount = totalCount - lastReportedMessageCount;
      if (deltaCount > 0) {
        const newMessages = options.inputMessages.slice(
          lastReportedMessageCount,
        );
        const newContextStr = JSON.stringify(newMessages);
        const [truncated, originalLength] = truncateContent(newContextStr);
        attributes.new_context = truncated;
        attributes.new_context_message_count = deltaCount;
        if (originalLength > MAX_CONTENT_LENGTH) {
          attributes.new_context_truncated = true;
          attributes.new_context_original_length = originalLength;
        }
      }
      lastReportedMessageCount = totalCount;
    }

    // Tool schemas: hash per tool + count
    if (options?.toolsSchema) {
      try {
        const tools = JSON.parse(options.toolsSchema);
        if (Array.isArray(tools)) {
          const toolHashes = tools.map(
            (tool: { function?: { name?: string } }) => {
              const name = tool.function?.name || "unknown";
              const toolStr = JSON.stringify(tool);
              const hash = hashContent(toolStr);
              return { name, hash };
            },
          );
          attributes.tools = JSON.stringify(toolHashes);
          attributes.tools_count = toolHashes.length;

          // Emit full tool schema via event only once per hash
          for (const { name, hash } of toolHashes) {
            if (!seenToolSchemaHashes.has(hash)) {
              seenToolSchemaHashes.add(hash);
              const fullTool = tools.find(
                (t: { function?: { name?: string } }) =>
                  t.function?.name === name,
              );
              if (fullTool) {
                logOTelEvent("tool_schema", {
                  tool_name: name,
                  tool_hash: hash,
                  tool_schema: JSON.stringify(fullTool),
                }).catch(() => {});
              }
            }
          }
        }
      } catch {
        // toolsSchema is not valid JSON — skip
      }
    }
  }

  const parent = interactionContext.getStore();
  let span: Span;
  if (parent) {
    const otelApi = getOTELApi()!;
    const ctx = otelApi.trace.setSpan(otelApi.context.active(), parent);
    span = tracer.startSpan("llm.request", { attributes }, ctx);
  } else {
    span = tracer.startSpan("llm.request", { attributes });
  }
  return span;
}

/**
 * Ends an LLM request span with response metadata.
 * The span is passed explicitly — no ALS is read or modified.
 *
 * When logToolContent is enabled, captures response.model_output.
 */
export function endLLMRequestSpan(
  span: Span | undefined,
  metadata: LLMRequestMetadata,
): void {
  if (!span) return;

  if (metadata.inputTokens != null)
    span.setAttribute("input_tokens", metadata.inputTokens);
  if (metadata.outputTokens != null)
    span.setAttribute("output_tokens", metadata.outputTokens);
  if (metadata.cacheReadTokens != null)
    span.setAttribute("cache_read_tokens", metadata.cacheReadTokens);
  if (metadata.cacheCreationTokens != null)
    span.setAttribute("cache_creation_tokens", metadata.cacheCreationTokens);
  if (metadata.ttftMs != null) span.setAttribute("ttft_ms", metadata.ttftMs);
  if (metadata.ttltMs != null) span.setAttribute("ttlt_ms", metadata.ttltMs);
  span.setAttribute("success", metadata.success);
  if (metadata.error) span.setAttribute("error", metadata.error);
  if (metadata.hasToolCall != null)
    span.setAttribute("has_tool_call", metadata.hasToolCall);

  // Content capture gated by logToolContent
  const config = getCurrentConfig();
  if (config?.logToolContent && metadata.modelOutput) {
    const [truncated, originalLength] = truncateContent(metadata.modelOutput);
    span.setAttribute("response.model_output", truncated);
    if (originalLength > MAX_CONTENT_LENGTH) {
      span.setAttribute("response.model_output_truncated", true);
      span.setAttribute(
        "response.model_output_original_length",
        originalLength,
      );
    }
  }

  span.end();
}

/**
 * Creates a tool execution span as a child of the interaction span.
 * Enters toolContext with the new span.
 */
export function startToolSpan(
  toolName: string,
  input?: unknown,
): Span | undefined {
  const tracer = getTracer();
  if (!tracer) return undefined;

  const config = getCurrentConfig();
  const attributes: Record<string, string | number | boolean> = {
    "span.type": "tool",
    tool_name: toolName,
  };
  if (config?.logToolContent && input !== undefined) {
    const inputStr = typeof input === "string" ? input : JSON.stringify(input);
    const [truncated, originalLength] = truncateContent(inputStr);
    attributes.tool_input = truncated;
    if (originalLength > MAX_CONTENT_LENGTH) {
      attributes.tool_input_truncated = true;
      attributes.tool_input_original_length = originalLength;
    }
  }

  const parent = interactionContext.getStore();
  let span: Span;
  if (parent) {
    const otelApi = getOTELApi()!;
    const ctx = otelApi.trace.setSpan(otelApi.context.active(), parent);
    span = tracer.startSpan(`tool.${toolName}`, { attributes }, ctx);
  } else {
    span = tracer.startSpan(`tool.${toolName}`, { attributes });
  }
  toolContext.enterWith(span);
  return span;
}

/**
 * Ends the current tool span with execution metadata.
 * Reads the span from toolContext, then clears it.
 */
export function endToolSpan(metadata: ToolMetadata): void {
  const span = toolContext.getStore();
  if (!span) return;

  span.setAttribute("success", metadata.success);
  if (metadata.error) span.setAttribute("error", metadata.error);
  span.setAttribute("duration_ms", metadata.durationMs);

  const config = getCurrentConfig();
  if (config?.logToolContent && metadata.output) {
    const [truncated, originalLength] = truncateContent(metadata.output);
    span.setAttribute("tool_output", truncated);
    if (originalLength > MAX_CONTENT_LENGTH) {
      span.setAttribute("tool_output_truncated", true);
      span.setAttribute("tool_output_original_length", originalLength);
    }
  }

  span.end();
  toolContext.enterWith(undefined);
}
