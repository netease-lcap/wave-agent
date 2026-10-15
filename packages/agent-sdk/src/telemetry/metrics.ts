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
 * the line direction, plus the standard surface every record shares (the
 * session, the identity of the user, the deployment's resource attributes and —
 * opt-in — the repository). No prompts, no file paths, no content of any kind.
 */

import type { Attributes, Counter, Histogram, Meter } from "@opentelemetry/api";
import { standardAttributes } from "./attributes.js";
import type { ToolActivity } from "./toolActivity.js";

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

/** What the caller knows about the record it is about to make. */
export interface RecordContext {
  /** Session the record belongs to → `session.id` */
  sessionId?: string;
  /** Session working directory — used only to derive `vcs.repository.*` */
  workdir?: string;
}

/**
 * Attribute policy, resolved once from the telemetry config at init time.
 *
 * `session.id` is a per-record attribute rather than a resource one: one
 * process hosts several sessions (the daemon), so it cannot be resolved once
 * for the provider.
 */
export interface MetricAttributePolicy {
  /** Attach `session.id` to every data point */
  includeSessionId: boolean;
  /** Resolve `vcs.repository.*` (opt-in) */
  includeRepository: boolean;
  /** `OTEL_RESOURCE_ATTRIBUTES` keys projected onto every data point */
  resourceAttributes: Attributes;
}

let apiRequests: Counter | undefined;
let apiErrors: Counter | undefined;
let apiDuration: Histogram | undefined;
let tokens: Counter | undefined;
let sessions: Counter | undefined;
let linesChanged: Counter | undefined;
let commits: Counter | undefined;
let pullRequests: Counter | undefined;

/** Whether the instruments above are live (the policy only matters then). */
let active = false;

let policy: MetricAttributePolicy = {
  includeSessionId: false,
  includeRepository: false,
  resourceAttributes: {},
};

/**
 * Create the instruments on the given meter. Called by `initializeTelemetry()`
 * once the MeterProvider exists; a second call (after a shutdown/restart)
 * simply re-creates them on the fresh meter.
 */
export function initMetrics(
  meter: Meter,
  attributePolicy?: MetricAttributePolicy,
): void {
  policy = attributePolicy ?? policy;
  active = true;
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
  commits = meter.createCounter("wave.commits", {
    description: "Commits created through a tool",
    unit: "{commit}",
  });
  pullRequests = meter.createCounter("wave.pull_requests", {
    description: "Pull requests or merge requests created through a tool",
    unit: "{pull_request}",
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
  commits = undefined;
  pullRequests = undefined;
  active = false;
}

/**
 * The standard attributes of one data point: the identity of the user, the
 * session it belongs to and anything the deployment declared as a resource
 * attribute.
 *
 * Resolves to nothing when no instrument is live — a record made while
 * telemetry is off must not pay for a session lookup or a `git` call.
 */
function attributesWithContext(context?: RecordContext): Attributes {
  if (!active) return {};

  return {
    ...policy.resourceAttributes,
    ...standardAttributes({
      sessionId: policy.includeSessionId ? context?.sessionId : undefined,
      workdir: context?.workdir,
      includeRepository: policy.includeRepository,
    }),
  };
}

/**
 * Record one LLM request: count + duration always, error count on failure,
 * and the token kinds that came back. Called from both the success and the
 * failure path of the turn loop (a failed request still consumed wall clock).
 */
export function recordApiRequest(
  record: ApiRequestRecord,
  context?: RecordContext,
): void {
  const base = attributesWithContext(context);
  const attributes = { ...base, model: record.model };
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
      tokens?.add(value, { ...base, model: record.model, type });
    }
  }
}

/** Record a started session. */
export function recordSession(context?: RecordContext): void {
  sessions?.add(1, attributesWithContext(context));
}

/**
 * Record the creation actions a tool call performed — today the commit and
 * PR/MR counters. A call that created neither records nothing, so the common
 * case costs one call and no instrument lookup.
 */
export function recordToolActivity(
  activity: ToolActivity,
  context?: RecordContext,
): void {
  if (activity.commits) {
    commits?.add(1, attributesWithContext(context));
  }
  if (activity.pullRequests) {
    pullRequests?.add(1, attributesWithContext(context));
  }
}

/**
 * Record lines added/removed by an edit tool. Zero/undefined sides are
 * skipped so a pure insertion and a pure deletion stay distinguishable.
 */
export function recordLinesChanged(
  changed: {
    added?: number;
    removed?: number;
  },
  context?: RecordContext,
): void {
  if (changed.added) {
    linesChanged?.add(changed.added, {
      ...attributesWithContext(context),
      direction: "added",
    });
  }
  if (changed.removed) {
    linesChanged?.add(changed.removed, {
      ...attributesWithContext(context),
      direction: "removed",
    });
  }
}
