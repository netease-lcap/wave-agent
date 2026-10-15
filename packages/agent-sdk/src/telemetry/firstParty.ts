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
 * Turning (2) off is `WAVE_DISABLE_TELEMETRY=1`, which deliberately leaves (1)
 * alone (spec 场景 3).
 */

import type { HeadersProvider, TelemetryConfig } from "../types/telemetry.js";
import { logger } from "../utils/globalLogger.js";
import { AuthService } from "../services/authService.js";

/**
 * Default state of the first-party channel.
 *
 * Deliberately `false` until the server-side intake exists in every
 * environment: the client half lands first, so switching the feature on is
 * exactly one constant (or one settings key). See the boundary case
 * 「如果服务端入口尚未就绪（客户端能力先发布）会怎样？」.
 */
export const FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED = false;

/** `WAVE_DISABLE_TELEMETRY=1|true` is the exit switch for this channel. */
export function isFirstPartyTelemetryDisabledByEnv(): boolean {
  const value = process.env.WAVE_DISABLE_TELEMETRY?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * Whether the first-party channel is on.
 *
 * `monitoring.telemetry.firstPartyEnabled` in settings.json is the explicit
 * door (that is how a machine self-tests the channel before the default is
 * flipped); the constant is what it falls back to. The env switch wins over
 * both — an operator turning telemetry off must not be overruled by a config
 * file.
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
