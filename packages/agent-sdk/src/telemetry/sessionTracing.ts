/**
 * Session Tracing -- OpenTelemetry Span Management
 *
 * Provides span creation/ending APIs for interactions, LLM requests, and tool
 * executions with AsyncLocalStorage context propagation and stale span cleanup.
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

const spanContext = new AsyncLocalStorage<Span>();

// -- LIFO stacks for nested span tracking --

const llmSpans: Span[] = [];
const toolSpans: Span[] = [];

// -- Tracer accessor --

function getTracer() {
  if (!isInitialized()) return undefined;
  const otelApi = getOTELApi();
  if (!otelApi) return undefined;
  return otelApi.trace.getTracer("wave");
}

// -- Helper: create child span with parent context --

function startChildSpan(
  name: string,
  attributes: Record<string, string | number>,
): Span | undefined {
  const tracer = getTracer();
  if (!tracer) return undefined;

  const parent = spanContext.getStore();
  let span: Span;
  if (parent) {
    const otelApi = getOTELApi()!;
    const ctx = otelApi.trace.setSpan(otelApi.context.active(), parent);
    span = tracer.startSpan(name, { attributes }, ctx);
  } else {
    span = tracer.startSpan(name, { attributes });
  }
  spanContext.enterWith(span);
  return span;
}

// -- Public API --

/**
 * Creates an interaction span for a user turn.
 */
export function startInteractionSpan(
  userPrompt: string,
  sequence: number,
): Span | undefined {
  const config = getCurrentConfig();
  const attributes: Record<string, string | number> = {
    "span.type": "interaction",
    user_prompt_length: userPrompt.length,
    "interaction.sequence": sequence,
  };
  if (config?.logUserPrompts) {
    attributes.user_prompt = userPrompt;
  }
  return startChildSpan("interaction", attributes);
}

/**
 * Ends the current active interaction span.
 */
export function endInteractionSpan(): void {
  const span = spanContext.getStore();
  if (!span) return;
  span.end();
}

/**
 * Creates an LLM request span as a child of the current active span.
 */
export function startLLMRequestSpan(
  model: string,
  options?: { context?: string },
): Span | undefined {
  const attributes: Record<string, string> = {
    "span.type": "llm_request",
    model,
  };
  if (options?.context) {
    attributes["llm_request.context"] = options.context;
  }

  const span = startChildSpan("llm.request", attributes);
  if (span) {
    llmSpans.push(span);
  }
  return span;
}

/**
 * Ends the most recent LLM request span with response metadata.
 */
export function endLLMRequestSpan(metadata: LLMRequestMetadata): void {
  const span = llmSpans.pop();
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

  if (llmSpans.length > 0) {
    spanContext.enterWith(llmSpans[llmSpans.length - 1]);
  }
}

/**
 * Creates a tool execution span as a child of the current active span.
 */
export function startToolSpan(
  toolName: string,
  input?: unknown,
): Span | undefined {
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

  const span = startChildSpan(`tool.${toolName}`, attributes);
  if (span) {
    toolSpans.push(span);
  }
  return span;
}

/**
 * Ends a tool span with execution metadata.
 */
export function endToolSpan(metadata: ToolMetadata): void {
  const span = toolSpans.pop();
  if (!span) return;

  span.setAttribute("success", metadata.success);
  if (metadata.error) span.setAttribute("error", metadata.error);
  span.setAttribute("duration_ms", metadata.durationMs);

  span.end();

  if (toolSpans.length > 0) {
    spanContext.enterWith(toolSpans[toolSpans.length - 1]);
  }
}

/**
 * Returns the current active span from ALS context.
 */
export function getActiveInteractionSpan(): Span | undefined {
  return spanContext.getStore();
}

/**
 * Executes `fn` with `span` as the active context via ALS.
 * Useful for parallel tool calls that each need their own span context.
 */
export function withSpanContext<T>(span: Span, fn: () => T): T {
  return spanContext.run(span, fn);
}
