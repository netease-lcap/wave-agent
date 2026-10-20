/**
 * First-party telemetry channel — the Wave server's own intake.
 *
 * Wave ships **two independent OTLP pipelines** (docs/specs/enterprise/opentelemetry.md):
 *
 * 1. the deployment's own collector — off unless someone configures an
 *    endpoint / exporter explicitly (`resolveExporter` & friends);
 * 2. this one: the Wave server, so the console can show engineering metrics
 *    (sessions, tokens, commits, PRs, changed lines) without the deployment
 *    having to stand up a collector of its own.
 *
 * They never substitute for one another. Configuring (1) does not switch (2)
 * off, and (2) never borrows (1)'s endpoint — a customer that points Wave at
 * its own collector keeps getting first-party reporting, and vice versa.
 *
 * (2) is on by default: the server-side intake lives in `{serverUrl}/otel`, so
 * a signed-in machine reports without anyone configuring anything. Turning it
 * off means the telemetry master switch `DISABLE_TELEMETRY=1`, which stops (1)
 * as well — there is no first-party-only door (spec 场景 3), matching Claude
 * Code.
 *
 * The two also disagree on the metrics *dialect*, and must keep disagreeing:
 * this channel reports DELTA over a 5-minute window (the intake stores the
 * points and sums them later), while (1) keeps the OTLP default CUMULATIVE at
 * 60 s (a customer's Prometheus-style store needs totals for `rate()` /
 * `increase()`). See `createFirstPartyMetricExporter` in `instrumentation.ts`.
 */

import type { HeadersProvider } from "../types/telemetry.js";
import { logger } from "../utils/globalLogger.js";
import { AuthService } from "../services/authService.js";

/**
 * Default state of the first-party channel: **on**.
 *
 * This was `false` while the server-side intake did not exist in every
 * environment. That precondition is gone — every environment accepts
 * `{serverUrl}/otel/v1/{metrics,logs}` — and the console's engineering-metrics
 * page has no data until the client is on by default, so the default is the
 * feature.
 *
 * Turning it off is the telemetry **master switch**, not a per-pipeline one:
 * `DISABLE_TELEMETRY=1` (same name and meaning as Claude Code) stops this
 * channel and the deployment's own exporters together. There is deliberately
 * no "first-party only" door — Claude Code has no such switch either, and a
 * deployment that wants to collect everything itself can point `serverUrl` at
 * its own server (this channel's intake *is* the deployment's server).
 */
export const FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED = true;

/** The environment view telemetry resolves against: settings `env` over OS env. */
export type TelemetryEnv = Record<string, string | undefined>;

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/**
 * The master switch: `DISABLE_TELEMETRY=1` stops every telemetry pipeline
 * (first-party intake and the deployment's own exporters alike).
 */
export function isTelemetryDisabledByEnv(
  env: TelemetryEnv = process.env,
): boolean {
  return isTruthy(env.DISABLE_TELEMETRY);
}

/**
 * Whether the first-party channel is on: on unless the master switch is set.
 *
 * `FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED` is what an unset value falls back to;
 * there is no config-file key of its own (aligned with Claude Code, whose
 * first-party logging follows the same global privacy switch).
 */
export function resolveFirstPartyEnabled(
  env: TelemetryEnv = process.env,
): boolean {
  if (isTelemetryDisabledByEnv(env)) return false;
  return FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED;
}

export interface FirstPartyChannel {
  /** Intake base; the exporters append `/v1/metrics` and `/v1/logs`. */
  endpoint: string;
  /** Bearer credential, read per batch so a renewed login needs no restart. */
  headers: HeadersProvider;
}

/**
 * Resolve the first-party channel, or `undefined` when it must not send.
 *
 * Returns `undefined` when the machine is not signed in or has no server URL:
 * an unauthenticated client must not generate first-party traffic at all
 * (spec 场景 5) rather than export batches whose only possible outcome is a
 * 401 and a retry storm.
 *
 * The endpoint is always derived from the deployment's own server URL — there
 * is no endpoint knob of its own. Sending first-party data somewhere else is
 * what `OTEL_EXPORTER_OTLP_ENDPOINT` (the deployment's own pipeline) or a
 * different `WAVE_SERVER_URL` is for.
 */
export function resolveFirstPartyChannel(): FirstPartyChannel | undefined {
  let auth: AuthService;
  try {
    auth = AuthService.getInstance();
  } catch {
    return undefined;
  }

  const token = auth.getSSOToken?.();
  if (!token) {
    logger?.debug("First-party telemetry skipped: not signed in");
    return undefined;
  }

  const serverUrl = auth.getServerUrl?.();
  if (!serverUrl) return undefined;

  const endpoint = `${serverUrl.replace(/\/+$/, "")}/otel`;

  return {
    endpoint,
    headers: async (): Promise<Record<string, string>> => {
      // Re-read per batch: SSO tokens are short-lived, so caching this here
      // would start 401-ing halfway through a long session.
      const current = AuthService.getInstance().getSSOToken?.();
      return current ? { Authorization: `Bearer ${current}` } : {};
    },
  };
}
