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
 * off has two doors — `WAVE_DISABLE_TELEMETRY=1` and an explicit
 * `monitoring.telemetry.firstPartyEnabled: false` — and both deliberately
 * leave (1) alone (spec 场景 3).
 */

import type { HeadersProvider, TelemetryConfig } from "../types/telemetry.js";
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
 * Turning it off has two doors, in precedence order:
 *
 * 1. `WAVE_DISABLE_TELEMETRY=1|true` — the operator's exit switch; it wins over
 *    everything, config file included.
 * 2. `monitoring.telemetry.firstPartyEnabled: false` — the explicit door, in
 *    `settings.json` or pushed down by the server-managed config (an admin
 *    turning the channel off for the whole fleet).
 */
export const FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED = true;

/** `WAVE_DISABLE_TELEMETRY=1|true` is the exit switch for this channel. */
export function isFirstPartyTelemetryDisabledByEnv(): boolean {
  const value = process.env.WAVE_DISABLE_TELEMETRY?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * Whether the first-party channel is on.
 *
 * On unless someone turns it off: `monitoring.telemetry.firstPartyEnabled` in
 * settings.json (or in the server-managed config, which wins on a clash) is
 * that door, and `FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED` is what an unset value
 * falls back to. The env switch wins over both — an operator turning telemetry
 * off must not be overruled by a config file.
 */
export function resolveFirstPartyEnabled(
  config?: Partial<TelemetryConfig>,
): boolean {
  if (isFirstPartyTelemetryDisabledByEnv()) return false;
  return config?.firstPartyEnabled ?? FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED;
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
 * (spec 场景 4) rather than export batches whose only possible outcome is a
 * 401 and a retry storm.
 *
 * `WAVE_OTEL_URL` overrides the derived endpoint, which is what lets a machine
 * point the channel at a local sink without faking the server URL.
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

  const override = process.env.WAVE_OTEL_URL?.trim();
  const endpoint = (override || `${serverUrl}/otel`).replace(/\/+$/, "");

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
