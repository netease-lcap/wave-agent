/**
 * OpenTelemetry Integration Types
 *
 * Type definitions for Wave's OpenTelemetry instrumentation module.
 */

/** Exporter target for telemetry signals */
export type ExporterTarget = "console" | "otlp";

/** OTLP transport protocol */
export type OTLPProtocol = "http/protobuf" | "http/json" | "grpc";

/**
 * Returns the OTLP export headers at send time. Called before every batch
 * export, so a rotating credential can be picked up without restarting the
 * process. It must never reject — the exporter contract treats a rejection as
 * "drop this batch".
 */
export type HeadersProvider = () => Promise<Record<string, string>>;

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
  /**
   * Command whose stdout is a JSON object of OTLP export headers, re-run
   * periodically so a rotating credential (a token with a lifetime, revocable
   * server-side) never has to be written into config or shipped in a build.
   * Aligned with Claude Code's `otelHeadersHelper`.
   *
   * stdout only — it is a credential, so it never reaches a log, an audit
   * trail or a span attribute. Env var `OTEL_EXPORTER_OTLP_HEADERS` and the
   * static `headers` above stay as the base; the helper's keys win per key.
   *
   * Only the user layer (`~/.wave/settings.json`) or the server-managed layer
   * may set this — a checked-out repo must not be able to name a command that
   * runs on this machine (see `loadMergedWaveConfig`).
   */
  headersHelper?: string;
  /**
   * In-process dynamic headers (the code-level counterpart of `headersHelper`,
   * for hosts that embed the SDK). Takes precedence over `headersHelper` when
   * both are set. Functions cannot travel through settings.json, so this one
   * is reachable only by whoever constructs the telemetry config directly.
   */
  headersProvider?: HeadersProvider;
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
  /** Model text output (recorded when logToolContent is true) */
  modelOutput?: string;
}

/** Input context for an LLM request span (content capture gated by logToolContent) */
export interface LLMRequestInput {
  /** Scope context */
  context?: "interaction" | "standalone";
  /** System prompt string (when available) */
  systemPrompt?: string;
  /** Messages array sent to the API */
  inputMessages?: unknown[];
  /** Tool schemas JSON string */
  toolsSchema?: string;
}

/** Metadata for tool execution spans */
export interface ToolMetadata {
  /** Tool execution succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Execution time (ms) */
  durationMs: number;
  /** Tool output content (recorded when logToolContent is true) */
  output?: string;
}

/** Event names for OTel structured logging */
export type OTelEventName =
  | "session_start"
  | "session_end"
  | "user_prompt"
  | "tool_decision"
  | "compaction"
  | "error"
  | "system_prompt"
  | "tool_schema";
