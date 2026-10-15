/**
 * OpenTelemetry Event Logging
 *
 * Provides the `logOTelEvent` API for structured session lifecycle events
 * with PII gates.
 */

import type { OTelEventName } from "../types/telemetry.js";
import { createHash } from "node:crypto";
import { isInitialized, getCurrentConfig } from "./instrumentation.js";
import { standardAttributes } from "./attributes.js";
import type { StandardAttributeContext } from "./attributes.js";

interface OTelLogger {
  emit: (logRecord: {
    body?: unknown;
    attributes?: Record<string, unknown>;
  }) => void;
}

let cachedLogger: OTelLogger | undefined;
let cachedProvider: unknown;

async function getOTelLogger(): Promise<OTelLogger | undefined> {
  try {
    const { logs } = await import("@opentelemetry/api-logs");
    // Keyed on the provider: `shutdownTelemetry()` unregisters it, and a logger
    // captured from the retired provider would keep dropping every event.
    const provider = logs.getLoggerProvider();
    if (!cachedLogger || cachedProvider !== provider) {
      cachedLogger = logs.getLogger("wave") as OTelLogger;
      cachedProvider = provider;
    }
    return cachedLogger;
  } catch {
    return undefined;
  }
}

/**
 * Logs a structured event via the OTEL logs API. Respects PII gates.
 *
 * `context` carries what the caller knows about the record (the session it
 * belongs to, and its working directory); every event gets the standard
 * attributes, not just `session_start` — one process hosts several sessions,
 * so an event without `session.id` cannot be attributed to the turn it
 * describes.
 */
export async function logOTelEvent(
  eventName: OTelEventName,
  metadata: Record<string, string | undefined>,
  context?: StandardAttributeContext,
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
      // The whole context rides along (session, entrypoint, …): events carry
      // the standard attributes unconditionally, and re-listing the fields here
      // is how `app.entrypoint` went missing while metrics kept it.
      ...standardAttributes({
        ...context,
        includeRepository: config?.includeRepository,
      }),
      ...attributes,
    },
  });
}

// -- Request-content events (opt-in via OTEL_LOG_TOOL_CONTENT) --

/** System prompt hashes already emitted — the full text is sent once per hash */
const seenSystemPromptHashes = new Set<string>();
/** Tool schema hashes already emitted — one event per tool per hash */
const seenToolSchemaHashes = new Set<string>();

/** SHA-256 of content, first 12 hex chars — the dedupe key for content events */
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 12);
}

/**
 * Emit the content-level request events: the full system prompt and each
 * tool's schema, both deduped by hash so a long session sends each variant
 * once instead of on every request. Gated by `OTEL_LOG_TOOL_CONTENT` — with
 * the gate off this is a no-op, and the caller does not have to check.
 */
export async function logRequestContentEvents(
  input: {
    systemPrompt?: string;
    toolsSchema?: string;
  },
  context?: StandardAttributeContext,
): Promise<void> {
  if (!isInitialized()) return;
  const config = getCurrentConfig();
  if (!config?.logToolContent) return;

  if (input.systemPrompt) {
    const hash = hashContent(input.systemPrompt);
    if (!seenSystemPromptHashes.has(hash)) {
      seenSystemPromptHashes.add(hash);
      logOTelEvent(
        "system_prompt",
        {
          system_prompt_hash: hash,
          system_prompt: input.systemPrompt,
        },
        context,
      ).catch(() => {});
    }
  }

  if (input.toolsSchema) {
    try {
      const tools = JSON.parse(input.toolsSchema);
      if (Array.isArray(tools)) {
        for (const tool of tools) {
          const name =
            (tool as { function?: { name?: string } })?.function?.name ||
            "unknown";
          const hash = hashContent(JSON.stringify(tool));
          if (seenToolSchemaHashes.has(hash)) continue;
          seenToolSchemaHashes.add(hash);
          logOTelEvent(
            "tool_schema",
            {
              tool_name: name,
              tool_hash: hash,
              tool_schema: JSON.stringify(tool),
            },
            context,
          ).catch(() => {});
        }
      }
    } catch {
      // toolsSchema is not valid JSON — skip
    }
  }
}

/**
 * Forget which content variants were already sent. Called after compaction:
 * the next request's context is a different shape, and re-reporting it is what
 * the dedupe would otherwise suppress.
 */
export function resetContentEventState(): void {
  seenSystemPromptHashes.clear();
  seenToolSchemaHashes.clear();
}
