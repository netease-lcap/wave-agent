/**
 * OpenTelemetry Integration Types
 *
 * Type definitions for Wave's OpenTelemetry instrumentation module.
 */

/** Exporter target for telemetry signals */
export type ExporterTarget = "jsonl" | "otlp";

/** OTLP transport protocol */
export type OTLPProtocol = "http/protobuf" | "http/json" | "grpc";

/** Resolved telemetry configuration */
export interface TelemetryConfig {
  /** Master switch for telemetry */
  enabled: boolean;
  /** Trace export target */
  tracesExporter?: ExporterTarget;
  /** Log export target */
  logsExporter?: ExporterTarget;
  /** OTLP collector URL */
  endpoint?: string;
  /** OTLP transport protocol */
  protocol?: OTLPProtocol;
  /** Auth/custom headers */
  headers?: Record<string, string>;
  /** Include prompt text in events */
  logUserPrompts: boolean;
  /** Include tool I/O in events */
  logToolContent: boolean;
  /** Max flush time on exit (default 2000) */
  shutdownTimeoutMs: number;
  /** Stale span eviction TTL (default 1800000 = 30min) */
  spanTtlMs: number;
}

/** Metadata for LLM request spans */
export interface LLMRequestMetadata {
  /** Model identifier */
  model: string;
  /** Scope context */
  context?: "interaction" | "standalone";
  /** Prompt tokens consumed */
  inputTokens?: number;
  /** Completion tokens generated */
  outputTokens?: number;
  /** Cache hit tokens */
  cacheReadTokens?: number;
  /** Cache write tokens */
  cacheCreationTokens?: number;
  /** Time to first token (ms) */
  ttftMs?: number;
  /** Time to last token / total duration (ms) */
  ttltMs?: number;
  /** Request succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Response included tool calls */
  hasToolCall?: boolean;
}

/** Metadata for tool execution spans */
export interface ToolMetadata {
  /** Tool execution succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Execution time (ms) */
  durationMs: number;
}

/** Event names for OTel structured logging */
export type OTelEventName =
  | "session_start"
  | "session_end"
  | "user_prompt"
  | "tool_decision"
  | "compaction"
  | "error";
