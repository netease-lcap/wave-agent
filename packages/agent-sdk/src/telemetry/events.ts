/**
 * OpenTelemetry Event Logging
 *
 * Provides the `logOTelEvent` API for structured session lifecycle events
 * with PII gates.
 */

import type { OTelEventName } from "../types/telemetry.js";
import {
  isInitialized,
  getCurrentConfig,
  getTelemetryAttributes,
} from "./instrumentation.js";

interface OTelLogger {
  emit: (logRecord: {
    body?: unknown;
    attributes?: Record<string, unknown>;
  }) => void;
}

let cachedLogger: OTelLogger | undefined;

async function getOTelLogger(): Promise<OTelLogger | undefined> {
  if (cachedLogger) return cachedLogger;
  try {
    const { logs } = await import("@opentelemetry/api-logs");
    cachedLogger = logs.getLogger("wave") as OTelLogger;
    return cachedLogger;
  } catch {
    return undefined;
  }
}

/**
 * Logs a structured event via the OTEL logs API. Respects PII gates.
 */
export async function logOTelEvent(
  eventName: OTelEventName,
  metadata: Record<string, string | undefined>,
): Promise<void> {
  if (!isInitialized()) return;

  const log = await getOTelLogger();
  if (!log) return;

  // PII gate: strip prompt text if logUserPrompts is false
  const attributes: Record<string, string> = {};
  const config = getCurrentConfig();

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    if (key === "prompt" && !config?.logUserPrompts) continue;
    attributes[key] = value;
  }

  log.emit({
    body: eventName,
    attributes: {
      "event.name": eventName,
      ...getTelemetryAttributes(),
      ...attributes,
    },
  });
}
