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
import type { Span } from "@opentelemetry/api";
import {
  getOTELApi,
  isInitialized,
  getCurrentConfig,
} from "./instrumentation.js";
import type { LLMRequestMetadata, ToolMetadata } from "../types/telemetry.js";

// -- AsyncLocalStorage for context propagation --

const interactionContext = new AsyncLocalStorage<Span | undefined>();
const toolContext = new AsyncLocalStorage<Span | undefined>();

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
 * Creates an LLM request span as a child of the interaction span.
 * Does NOT enter any ALS — the span must be passed explicitly to endLLMRequestSpan.
 */
export function startLLMRequestSpan(
  model: string,
  options?: { context?: string },
): Span | undefined {
  const tracer = getTracer();
  if (!tracer) return undefined;

  const attributes: Record<string, string> = {
    "span.type": "llm_request",
    model,
  };
  if (options?.context) {
    attributes["llm_request.context"] = options.context;
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
  const attributes: Record<string, string | number> = {
    "span.type": "tool",
    tool_name: toolName,
  };
  if (config?.logToolContent && input !== undefined) {
    let inputStr = typeof input === "string" ? input : JSON.stringify(input);
    if (inputStr.length > 1000) {
      inputStr = inputStr.substring(0, 1000);
    }
    attributes.tool_input = inputStr;
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
    let outputStr = metadata.output;
    if (outputStr.length > 1000) {
      outputStr = outputStr.substring(0, 1000);
    }
    span.setAttribute("tool_output", outputStr);
  }

  span.end();
  toolContext.enterWith(undefined);
}
