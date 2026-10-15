/**
 * OpenTelemetry Metrics
 *
 * The operational metric families (see docs/specs/enterprise/opentelemetry.md):
 * request counts / errors / duration, token usage, session count and lines
 * changed. Instruments are created once per initialized MeterProvider by
 * `initMetrics()`; until then — and after `resetMetrics()` — every record call
 * is a no-op, so callers never have to check whether telemetry is on.
 *
 * Attributes stay low-cardinality on purpose: the model id, the token kind and
 * the line direction. No prompts, no file paths, no content of any kind.
 */

import type { Counter, Histogram, Meter } from "@opentelemetry/api";

/** One LLM request's outcome, as recorded by the metrics family. */
export interface ApiRequestRecord {
  /** Model id the request went to (low-cardinality attribute) */
  model: string;
  /** Wall-clock duration of the request in ms */
  durationMs: number;
  /** Whether the request completed without error */
  success: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

let apiRequests: Counter | undefined;
let apiErrors: Counter | undefined;
let apiDuration: Histogram | undefined;
let tokens: Counter | undefined;
let sessions: Counter | undefined;
let linesChanged: Counter | undefined;

/**
 * Create the instruments on the given meter. Called by `initializeTelemetry()`
 * once the MeterProvider exists; a second call (after a shutdown/restart)
 * simply re-creates them on the fresh meter.
 */
export function initMetrics(meter: Meter): void {
  apiRequests = meter.createCounter("wave.api.requests", {
    description: "LLM API requests",
    unit: "{request}",
  });
  apiErrors = meter.createCounter("wave.api.errors", {
    description: "Failed LLM API requests",
    unit: "{request}",
  });
  apiDuration = meter.createHistogram("wave.api.duration", {
    description: "LLM API request duration",
    unit: "ms",
  });
  tokens = meter.createCounter("wave.tokens", {
    description: "Tokens consumed, by model and kind",
    unit: "{token}",
  });
  sessions = meter.createCounter("wave.sessions", {
    description: "Agent sessions started",
    unit: "{session}",
  });
  linesChanged = meter.createCounter("wave.lines.changed", {
    description: "Lines added or removed by edit tools",
    unit: "{line}",
  });
}

/** Drop the instruments: telemetry was shut down, later records must no-op. */
export function resetMetrics(): void {
  apiRequests = undefined;
  apiErrors = undefined;
  apiDuration = undefined;
  tokens = undefined;
  sessions = undefined;
  linesChanged = undefined;
}

/**
 * Record one LLM request: count + duration always, error count on failure,
 * and the token kinds that came back. Called from both the success and the
 * failure path of the turn loop (a failed request still consumed wall clock).
 */
export function recordApiRequest(record: ApiRequestRecord): void {
  const attributes = { model: record.model };
  apiRequests?.add(1, attributes);
  apiDuration?.record(record.durationMs, attributes);
  if (!record.success) {
    apiErrors?.add(1, attributes);
  }

  const kinds: Array<[string, number | undefined]> = [
    ["input", record.inputTokens],
    ["output", record.outputTokens],
    ["cache_read", record.cacheReadTokens],
    ["cache_creation", record.cacheCreationTokens],
  ];
  for (const [type, value] of kinds) {
    if (value != null) {
      tokens?.add(value, { model: record.model, type });
    }
  }
}

/** Record a started session. */
export function recordSession(): void {
  sessions?.add(1);
}

/**
 * Record lines added/removed by an edit tool. Zero/undefined sides are
 * skipped so a pure insertion and a pure deletion stay distinguishable.
 */
export function recordLinesChanged(changed: {
  added?: number;
  removed?: number;
}): void {
  if (changed.added) {
    linesChanged?.add(changed.added, { direction: "added" });
  }
  if (changed.removed) {
    linesChanged?.add(changed.removed, { direction: "removed" });
  }
}
