/**
 * OpenTelemetry Instrumentation Module
 *
 * Handles SDK initialization, provider setup, exporter configuration,
 * and graceful shutdown for Wave's OpenTelemetry integration.
 */

import type {
  TelemetryConfig,
  ExporterTarget,
  OTLPProtocol,
} from "../types/telemetry.js";
import { logger } from "../utils/globalLogger.js";
import * as fs from "node:fs";

import type {
  SpanExporter,
  ReadableSpan,
  BasicTracerProvider,
} from "@opentelemetry/sdk-trace-base";
import type {
  LogRecordExporter,
  ReadableLogRecord,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
  AuthService,
  getOrCreateAnonymousId,
} from "../services/authService.js";

// Lazy-loaded OTEL modules — only imported when telemetry is initialized
let sdkTraceBase: typeof import("@opentelemetry/sdk-trace-base") | undefined;
let otelResources: typeof import("@opentelemetry/resources") | undefined;
let api: typeof import("@opentelemetry/api") | undefined;
let apiLogs: typeof import("@opentelemetry/api-logs") | undefined;
let sdkLogs: typeof import("@opentelemetry/sdk-logs") | undefined;
let exporterTraceOtlpHttp:
  | typeof import("@opentelemetry/exporter-trace-otlp-http")
  | undefined;
let exporterLogsOtlpHttp:
  | typeof import("@opentelemetry/exporter-logs-otlp-http")
  | undefined;

/** Internal trace provider instance */
let tracerProvider: BasicTracerProvider | undefined;

/** Internal log provider instance */
let loggerProvider: LoggerProvider | undefined;

/** Whether telemetry has been initialized */
let initialized = false;

/** Current resolved config */
let currentConfig: TelemetryConfig | undefined;

/** Default telemetry file path */
const DEFAULT_TELEMETRY_FILE = "~/.wave/telemetry.jsonl";

/**
 * Resolve the telemetry file path, expanding ~ to home directory.
 */
function resolveTelemetryFilePath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return DEFAULT_TELEMETRY_FILE.replace("~", homeDir);
}

/**
 * Load OTEL SDK modules via dynamic import (lazy loading to avoid startup penalty).
 */
async function loadOTELModules(): Promise<void> {
  if (api) return; // Already loaded

  [
    sdkTraceBase,
    otelResources,
    api,
    apiLogs,
    sdkLogs,
    exporterTraceOtlpHttp,
    exporterLogsOtlpHttp,
  ] = await Promise.all([
    import("@opentelemetry/sdk-trace-base"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/api"),
    import("@opentelemetry/api-logs"),
    import("@opentelemetry/sdk-logs"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/exporter-logs-otlp-http"),
  ]);
}

/**
 * Resolve the exporter target from environment variable or config.
 * Environment variable takes precedence over settings.json config.
 */
function resolveExporter(
  signal: "traces" | "logs",
  config?: Partial<TelemetryConfig>,
): ExporterTarget | undefined {
  const envVar = `OTEL_${signal.toUpperCase()}_EXPORTER`;
  const envValue = process.env[envVar];
  if (envValue === "jsonl" || envValue === "otlp") {
    return envValue;
  }
  if (envValue && envValue !== "none") {
    logger?.warn(`Unknown OTEL exporter: ${envValue}, ignoring`);
  }

  const configKey = `${signal}Exporter` as keyof TelemetryConfig;
  return config?.[configKey] as ExporterTarget | undefined;
}

/**
 * Resolve the OTLP endpoint from environment variable or config.
 */
function resolveEndpoint(
  config?: Partial<TelemetryConfig>,
): string | undefined {
  return process.env.OTEL_EXPORTER_OTLP_ENDPOINT || config?.endpoint;
}

/**
 * Resolve the OTLP protocol from environment variable or config.
 */
function resolveProtocol(
  config?: Partial<TelemetryConfig>,
): OTLPProtocol | undefined {
  const envProtocol = process.env.OTEL_EXPORTER_OTLP_PROTOCOL as
    | OTLPProtocol
    | undefined;
  if (envProtocol) return envProtocol;
  return config?.protocol;
}

/**
 * Resolve OTLP headers from environment variable or config.
 * Env var format: "key1=value1,key2=value2"
 */
function resolveHeaders(
  config?: Partial<TelemetryConfig>,
): Record<string, string> | undefined {
  const envHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (envHeaders) {
    const headers: Record<string, string> = {};
    for (const pair of envHeaders.split(",")) {
      const [key, ...valueParts] = pair.split("=");
      if (key && valueParts.length > 0) {
        headers[key.trim()] = valueParts.join("=").trim();
      }
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
  }
  return config?.headers;
}

/**
 * Resolve PII gate flags from environment variables.
 */
function resolveLogUserPrompts(config?: Partial<TelemetryConfig>): boolean {
  const envValue = process.env.OTEL_LOG_USER_PROMPTS;
  if (envValue === "1" || envValue === "true") return true;
  if (envValue === "0" || envValue === "false") return false;
  return config?.logUserPrompts ?? false;
}

function resolveLogToolContent(config?: Partial<TelemetryConfig>): boolean {
  const envValue = process.env.OTEL_LOG_TOOL_CONTENT;
  if (envValue === "1" || envValue === "true") return true;
  if (envValue === "0" || envValue === "false") return false;
  return config?.logToolContent ?? false;
}

/**
 * Resolve span TTL from environment variable or config.
 */
function resolveSpanTtlMs(config?: Partial<TelemetryConfig>): number {
  const envValue = process.env.OTEL_SPAN_TTL_MS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return config?.spanTtlMs ?? 1_800_000; // 30 minutes default
}

/**
 * Resolve shutdown timeout from environment variable or config.
 */
function resolveShutdownTimeoutMs(config?: Partial<TelemetryConfig>): number {
  const envValue = process.env.OTEL_SHUTDOWN_TIMEOUT_MS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return config?.shutdownTimeoutMs ?? 2_000; // 2 seconds default
}

/**
 * Resolve the full TelemetryConfig from env vars + settings.json.
 * Env vars take precedence over settings.json.
 */
export function resolveTelemetryConfig(
  settingsConfig?: Partial<TelemetryConfig>,
): TelemetryConfig {
  const tracesExporter = resolveExporter("traces", settingsConfig);
  const logsExporter = resolveExporter("logs", settingsConfig);

  return {
    enabled:
      process.env.OTEL_ENABLED === "false"
        ? false
        : (settingsConfig?.enabled ?? !!(tracesExporter || logsExporter)),
    tracesExporter,
    logsExporter,
    endpoint: resolveEndpoint(settingsConfig),
    protocol: resolveProtocol(settingsConfig),
    headers: resolveHeaders(settingsConfig),
    logUserPrompts: resolveLogUserPrompts(settingsConfig),
    logToolContent: resolveLogToolContent(settingsConfig),
    shutdownTimeoutMs: resolveShutdownTimeoutMs(settingsConfig),
    spanTtlMs: resolveSpanTtlMs(settingsConfig),
  };
}

/**
 * Create an OTLP trace exporter configured with endpoint, protocol, and headers.
 */
function createOTLPTraceExporter(config: TelemetryConfig) {
  const exporterConfig: {
    url?: string;
    headers?: Record<string, string>;
  } = {};

  if (config.endpoint) {
    exporterConfig.url = `${config.endpoint}/v1/traces`;
  }
  if (config.headers) {
    exporterConfig.headers = config.headers;
  }

  return new exporterTraceOtlpHttp!.OTLPTraceExporter(exporterConfig);
}

/**
 * Create an OTLP log exporter.
 */
function createOTLPLogExporter(config: TelemetryConfig) {
  const exporterConfig: {
    url?: string;
    headers?: Record<string, string>;
  } = {};

  if (config.endpoint) {
    exporterConfig.url = `${config.endpoint}/v1/logs`;
  }
  if (config.headers) {
    exporterConfig.headers = config.headers;
  }

  return new exporterLogsOtlpHttp!.OTLPLogExporter(exporterConfig);
}

/**
 * JSONL Span Exporter — writes span data as JSON lines to a file.
 */
class JsonlSpanExporter implements SpanExporter {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || resolveTelemetryFilePath();
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number }) => void,
  ): void {
    try {
      const lines = spans.map((span) => {
        const record: Record<string, unknown> = {
          type: "span",
          span_name: span.name,
          trace_id: span.spanContext().traceId,
          span_id: span.spanContext().spanId,
          parent_span_id: span.parentSpanContext?.spanId,
          start_time: span.startTime,
          end_time: span.endTime,
          status: span.status.code,
          attributes: span.attributes,
        };
        return JSON.stringify(record);
      });
      fs.appendFileSync(this.filePath, lines.join("\n") + "\n", "utf8");
      resultCallback({ code: 0 });
    } catch (error) {
      logger?.warn("JSONL span export failed:", error);
      resultCallback({ code: 1 });
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * JSONL Log Exporter — writes log records as JSON lines to a file.
 */
class JsonlLogExporter implements LogRecordExporter {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || resolveTelemetryFilePath();
  }

  export(
    logs: ReadableLogRecord[],
    resultCallback: (result: { code: number }) => void,
  ): void {
    try {
      const lines = logs.map((log) => {
        const record: Record<string, unknown> = {
          type: "log",
          event_name: (log.attributes as Record<string, unknown>)?.[
            "event.name"
          ],
          severity: log.severityNumber,
          body: log.body,
          timestamp: log.hrTime,
          attributes: log.attributes,
        };
        return JSON.stringify(record);
      });
      fs.appendFileSync(this.filePath, lines.join("\n") + "\n", "utf8");
      resultCallback({ code: 0 });
    } catch (error) {
      logger?.warn("JSONL log export failed:", error);
      resultCallback({ code: 1 });
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Initialize OpenTelemetry SDK with providers and exporters.
 * Idempotent — safe to call multiple times.
 *
 * @param config - Optional TelemetryConfig. If not provided, resolved from env vars.
 */
export async function initializeTelemetry(
  config?: Partial<TelemetryConfig>,
): Promise<void> {
  if (initialized) {
    logger?.debug("Telemetry already initialized, skipping");
    return;
  }

  try {
    await loadOTELModules();
  } catch (error) {
    logger?.warn(
      "Failed to load OpenTelemetry modules. Telemetry will be disabled:",
      error,
    );
    return;
  }

  try {
    currentConfig = resolveTelemetryConfig(config);

    if (!currentConfig.enabled) {
      logger?.debug("Telemetry not enabled (no exporters configured)");
      return;
    }

    const { tracesExporter, logsExporter } = currentConfig;

    // Build resource attributes (lightweight assembly: sdk-trace-base + resources)
    const resource = otelResources!.defaultResource().merge(
      otelResources!.resourceFromAttributes({
        "service.name": "wave",
        "service.version": process.env.npm_package_version || "unknown",
        "os.type": process.platform,
        "host.arch": process.arch,
      }),
    );

    const spanProcessors: import("@opentelemetry/sdk-trace-base").SpanProcessor[] =
      [];

    if (tracesExporter === "otlp" && currentConfig.endpoint) {
      spanProcessors.push(
        new sdkTraceBase!.BatchSpanProcessor(
          createOTLPTraceExporter(currentConfig),
        ),
      );
    } else if (tracesExporter === "jsonl") {
      spanProcessors.push(
        new sdkTraceBase!.BatchSpanProcessor(new JsonlSpanExporter()),
      );
    }

    const logProcessors: import("@opentelemetry/sdk-logs").LogRecordProcessor[] =
      [];

    if (logsExporter === "otlp" && currentConfig.endpoint) {
      logProcessors.push(
        new sdkLogs!.BatchLogRecordProcessor(
          createOTLPLogExporter(currentConfig),
        ),
      );
    } else if (logsExporter === "jsonl") {
      logProcessors.push(
        new sdkLogs!.BatchLogRecordProcessor(new JsonlLogExporter()),
      );
    }

    // Only initialize providers if at least one exporter is configured
    if (spanProcessors.length > 0 || logProcessors.length > 0) {
      if (spanProcessors.length > 0) {
        tracerProvider = new sdkTraceBase!.BasicTracerProvider({
          resource,
          spanProcessors,
        });
        api!.trace.setGlobalTracerProvider(tracerProvider);
      }

      if (logProcessors.length > 0) {
        loggerProvider = new sdkLogs!.LoggerProvider({
          resource,
          processors: logProcessors,
        });
        apiLogs!.logs.setGlobalLoggerProvider(loggerProvider);
      }

      initialized = true;

      logger?.info("OpenTelemetry initialized", {
        tracesExporter,
        logsExporter,
        endpoint: currentConfig.endpoint,
      });
    } else {
      logger?.debug("No telemetry exporters configured, skipping init");
    }
  } catch (error) {
    logger?.warn(
      "OpenTelemetry initialization failed, continuing without telemetry:",
      error,
    );
    // Graceful degradation — do not crash
  }
}

/**
 * Shut down OpenTelemetry, flushing all pending data.
 * Respects shutdownTimeoutMs config.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!tracerProvider && !loggerProvider) {
    return;
  }

  try {
    const timeout = currentConfig?.shutdownTimeoutMs ?? 2_000;
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(
        () => reject(new Error("Telemetry shutdown timed out")),
        timeout,
      );
    });

    const shutdowns: Promise<void>[] = [];
    if (tracerProvider) shutdowns.push(tracerProvider.shutdown());
    if (loggerProvider) shutdowns.push(loggerProvider.shutdown());

    await Promise.race([Promise.all(shutdowns), timeoutPromise]);
    logger?.debug("OpenTelemetry shut down successfully");
  } catch (error) {
    logger?.warn("OpenTelemetry shutdown failed:", error);
  } finally {
    tracerProvider = undefined;
    loggerProvider = undefined;
    initialized = false;
    currentConfig = undefined;
  }
}

/**
 * Get the OTEL API module (for creating tracers, meters, etc.).
 * Returns undefined if telemetry is not initialized.
 */
export function getOTELApi(): typeof import("@opentelemetry/api") | undefined {
  return api;
}

/**
 * Get the current resolved config.
 */
export function getCurrentConfig(): TelemetryConfig | undefined {
  return currentConfig;
}

/**
 * Check if telemetry is initialized.
 */
export function isInitialized(): boolean {
  return initialized;
}

// Export JSONL exporters for testing
export { JsonlSpanExporter, JsonlLogExporter };

/**
 * Get telemetry attributes for the current session.
 *
 * Priority:
 * 1. SSO authenticated → server-provided user.id + user.email
 * 2. Not authenticated → persistent anonymous ID from ~/.wave/config.json
 */
export function getTelemetryAttributes(): Record<string, string> {
  try {
    const user = AuthService.getInstance().getAuthUser();
    if (user) {
      const attrs: Record<string, string> = { "user.id": user.id };
      if (user.email) {
        attrs["user.email"] = user.email;
      }
      return attrs;
    }
  } catch {
    // AuthService not available or not authenticated
  }

  // Fallback to anonymous ID
  return { "user.id": getOrCreateAnonymousId() };
}
