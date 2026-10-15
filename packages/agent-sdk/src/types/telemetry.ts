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
  /** Metric export target */
  metricsExporter?: ExporterTarget;
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
   * stdout only — it is a credential, so it never reaches a log or an audit
   * trail. Env var `OTEL_EXPORTER_OTLP_HEADERS` and the static `headers` above
   * stay as the base; the helper's keys win per key.
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
  /**
   * Attach `session.id` to metric data points (default true). Events always
   * carry it; this switch only controls the metrics side, hence the name —
   * aligned with Claude Code's `OTEL_METRICS_INCLUDE_SESSION_ID`.
   */
  includeSessionId: boolean;
  /**
   * Project `OTEL_RESOURCE_ATTRIBUTES` onto metric data points (default true).
   * The resource keeps them either way; the projection is what makes them
   * filterable when a collector does not turn resource attributes into series
   * labels. Env var `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES`.
   */
  includeResourceAttributes: boolean;
  /**
   * Attach `vcs.repository.*` (owner / name / provider / url) to every record
   * (default false). Off by default so telemetry never leaks internal
   * repository coordinates unless the deployment asks for them. Env var
   * `OTEL_METRICS_INCLUDE_REPOSITORY`.
   */
  includeRepository: boolean;
  /**
   * Attach `app.entrypoint` (the host that created the session) to metric data
   * points (default false). Events always carry it; this switch only controls
   * the metrics side — aligned with Claude Code's
   * `OTEL_METRICS_INCLUDE_ENTRYPOINT`.
   */
  includeEntrypoint: boolean;
  /** Max flush time on exit (default 2000) */
  shutdownTimeoutMs: number;
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
