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
  HeadersProvider,
} from "../types/telemetry.js";
import { logger } from "../utils/globalLogger.js";
import { createHeadersHelperProvider } from "./headersHelper.js";
import { initMetrics, resetMetrics } from "./metrics.js";
import {
  resolveFirstPartyChannel,
  resolveFirstPartyEnabled,
} from "./firstParty.js";
import type { FirstPartyChannel } from "./firstParty.js";
import { getServiceVersion } from "./attributes.js";

import type { MeterProvider } from "@opentelemetry/sdk-metrics";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";

// Lazy-loaded OTEL modules — only imported when telemetry is initialized
let sdkMetrics: typeof import("@opentelemetry/sdk-metrics") | undefined;
let otelResources: typeof import("@opentelemetry/resources") | undefined;
let api: typeof import("@opentelemetry/api") | undefined;
let apiLogs: typeof import("@opentelemetry/api-logs") | undefined;
let sdkLogs: typeof import("@opentelemetry/sdk-logs") | undefined;
let exporterMetricsOtlpHttp:
  | typeof import("@opentelemetry/exporter-metrics-otlp-http")
  | undefined;
let exporterLogsOtlpHttp:
  | typeof import("@opentelemetry/exporter-logs-otlp-http")
  | undefined;

/** Internal metric provider instance */
let meterProvider: MeterProvider | undefined;

/** Internal log provider instance */
let loggerProvider: LoggerProvider | undefined;

/** Whether telemetry has been initialized */
let initialized = false;

/** Current resolved config */
let currentConfig: TelemetryConfig | undefined;

/**
 * Dynamic header source for this process, resolved once per initialization.
 * Both exporters must share one instance: its cache and in-flight dedup are
 * per-instance, so two instances would run the helper twice per refresh.
 */
let headersProvider: HeadersProvider | undefined;

/**
 * Whether stdout is a structured channel in this host (`--stdio` JSON-RPC,
 * `--print` result stream). The CLI entries turn this on before any agent
 * exists; console exporters print to stdout and would corrupt those channels,
 * so they are stripped at config resolution — same treatment as Claude Code's
 * stream-json mode, which removes `console` from the exporter env vars.
 */
let stdoutProtected = false;

export function setTelemetryStdoutProtected(value = true): void {
  stdoutProtected = value;
}

/**
 * Load OTEL SDK modules via dynamic import (lazy loading to avoid startup penalty).
 */
async function loadOTELModules(): Promise<void> {
  if (api) return; // Already loaded

  [
    sdkMetrics,
    otelResources,
    api,
    apiLogs,
    sdkLogs,
    exporterMetricsOtlpHttp,
    exporterLogsOtlpHttp,
  ] = await Promise.all([
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/api"),
    import("@opentelemetry/api-logs"),
    import("@opentelemetry/sdk-logs"),
    import("@opentelemetry/exporter-metrics-otlp-http"),
    import("@opentelemetry/exporter-logs-otlp-http"),
  ]);

  installDiagLogger(api!);
}

/**
 * Route the OTel API's own diagnostics into wave's logger.
 *
 * Everything the API refuses to do (a second global provider registration, a
 * failed export, an invalid config) is reported only through `diag`, whose
 * default logger drops the message on the floor. Without this, telemetry that
 * never took effect is indistinguishable from telemetry that works.
 */
function installDiagLogger(otelApi: typeof import("@opentelemetry/api")): void {
  otelApi.diag.setLogger(
    {
      error: (message: string) => logger?.warn(`[otel] ${message}`),
      warn: (message: string) => logger?.debug(`[otel] ${message}`),
      info: () => {},
      debug: () => {},
      verbose: () => {},
    },
    otelApi.DiagLogLevel.ERROR,
  );
}

/**
 * Resolve the exporter target from environment variable or config.
 * Environment variable takes precedence over settings.json config.
 */
function resolveExporter(
  signal: "metrics" | "logs",
  config?: Partial<TelemetryConfig>,
): ExporterTarget | undefined {
  const envVar = `OTEL_${signal.toUpperCase()}_EXPORTER`;
  const envValue = process.env[envVar];
  if (envValue === "console" || envValue === "otlp") {
    return envValue;
  }
  // `none` is an explicit "do not export this signal", not an unknown value:
  // it must win over the configured exporter instead of falling back to it.
  if (envValue === "none") {
    logger?.debug(`${envVar}=none: ${signal} export disabled`);
    return undefined;
  }
  if (envValue) {
    logger?.warn(`Unknown OTEL exporter: ${envValue}, ignoring`);
  }

  const configKey = `${signal}Exporter` as keyof TelemetryConfig;
  const configValue = config?.[configKey] as unknown;
  if (
    configValue !== undefined &&
    configValue !== "console" &&
    configValue !== "otlp"
  ) {
    // A value this version does not know (an old `jsonl`, a typo) must not be
    // passed through as if it were usable.
    logger?.warn(
      `Unknown OTEL exporter in config: ${String(configValue)}, ignoring`,
    );
    return undefined;
  }
  return configValue as ExporterTarget | undefined;
}

/**
 * Drop the console exporter on hosts whose stdout is a structured channel
 * (`--stdio` / `--print`); see `setTelemetryStdoutProtected`.
 */
function stripConsoleOnProtectedStdout(
  target: ExporterTarget | undefined,
): ExporterTarget | undefined {
  if (target === "console" && stdoutProtected) {
    logger?.debug(
      "console exporter stripped: this host's stdout is a structured channel",
    );
    return undefined;
  }
  return target;
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
 * Resolve the static OTLP headers from environment variable or config.
 * Env var format: "key1=value1,key2=value2"
 */
function resolveStaticHeaders(
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
 * Resolve the dynamic OTLP headers source, if any.
 *
 * Two doors onto the same slot, in precedence order:
 * 1. `headersProvider` — injected in process (a host embedding the SDK);
 * 2. `headersHelper` — a command from settings.json / the managed layer whose
 *    stdout is the header object, re-run on a refresh interval so a rotating
 *    credential is picked up without a restart.
 *
 * Neither can travel through `OTEL_EXPORTER_OTLP_HEADERS`, and a function
 * cannot travel through settings.json, which is why both exist.
 */
function resolveHeadersProvider(
  config?: Partial<TelemetryConfig>,
): HeadersProvider | undefined {
  if (config?.headersProvider) {
    return config.headersProvider;
  }
  const command = config?.headersHelper?.trim();
  if (!command) {
    return undefined;
  }
  return createHeadersHelperProvider({ command });
}

/**
 * Build the `headers` value handed to the OTLP exporters.
 *
 * A static map is passed through as-is (the exporter accepts either form); a
 * dynamic source becomes an async factory, which the exporter transport calls
 * before every batch send. Dynamic keys win per key over the static base, so
 * `OTEL_EXPORTER_OTLP_HEADERS` stays usable for local overrides while the
 * helper supplies the rotating ones (same composition as Claude Code).
 */
function buildExporterHeaders(
  config: TelemetryConfig,
): Record<string, string> | HeadersProvider | undefined {
  const provider = headersProvider;
  if (!provider) {
    return config.headers;
  }
  const baseHeaders = config.headers;
  return async () => ({ ...baseHeaders, ...(await provider()) });
}

/**
 * Resolve a boolean switch: env var > settings config > default.
 *
 * Same precedence as the rest of the telemetry config, and the same env names
 * Claude Code uses, so a fleet that already sets them for the collector keeps
 * one configuration vocabulary.
 */
function resolveBooleanSwitch(
  envVar: string,
  configValue: boolean | undefined,
  defaultValue: boolean,
): boolean {
  const envValue = process.env[envVar];
  if (envValue === "1" || envValue === "true") return true;
  if (envValue === "0" || envValue === "false") return false;
  return configValue ?? defaultValue;
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
  // Legacy keys from earlier versions. Traces (and their knobs) no longer
  // exist; a config still carrying them must not fail initialization, but it
  // must not be dropped in silence either — a key that never takes effect is
  // indistinguishable from one that never arrived.
  const legacy = settingsConfig as Record<string, unknown> | undefined;
  if (legacy?.tracesExporter !== undefined || legacy?.spanTtlMs !== undefined) {
    logger?.warn(
      "monitoring.telemetry.tracesExporter / spanTtlMs are no longer supported (trace collection was removed); ignoring them",
    );
  }

  const metricsExporter = stripConsoleOnProtectedStdout(
    resolveExporter("metrics", settingsConfig),
  );
  const logsExporter = stripConsoleOnProtectedStdout(
    resolveExporter("logs", settingsConfig),
  );

  return {
    enabled:
      process.env.OTEL_ENABLED === "false"
        ? false
        : (settingsConfig?.enabled ?? !!(metricsExporter || logsExporter)),
    firstPartyEnabled: resolveFirstPartyEnabled(settingsConfig),
    metricsExporter,
    logsExporter,
    endpoint: resolveEndpoint(settingsConfig),
    protocol: resolveProtocol(settingsConfig),
    headers: resolveStaticHeaders(settingsConfig),
    headersHelper: settingsConfig?.headersHelper?.trim() || undefined,
    headersProvider: settingsConfig?.headersProvider,
    logUserPrompts: resolveBooleanSwitch(
      "OTEL_LOG_USER_PROMPTS",
      settingsConfig?.logUserPrompts,
      false,
    ),
    logToolContent: resolveBooleanSwitch(
      "OTEL_LOG_TOOL_CONTENT",
      settingsConfig?.logToolContent,
      false,
    ),
    includeSessionId: resolveBooleanSwitch(
      "OTEL_METRICS_INCLUDE_SESSION_ID",
      settingsConfig?.includeSessionId,
      true,
    ),
    includeResourceAttributes: resolveBooleanSwitch(
      "OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES",
      settingsConfig?.includeResourceAttributes,
      true,
    ),
    includeRepository: resolveBooleanSwitch(
      "OTEL_METRICS_INCLUDE_REPOSITORY",
      settingsConfig?.includeRepository,
      false,
    ),
    includeEntrypoint: resolveBooleanSwitch(
      "OTEL_METRICS_INCLUDE_ENTRYPOINT",
      settingsConfig?.includeEntrypoint,
      false,
    ),
    shutdownTimeoutMs: resolveShutdownTimeoutMs(settingsConfig),
  };
}

/**
 * Create an OTLP metric exporter configured with endpoint, protocol, and headers.
 *
 * Deliberately passes **no** `temporalityPreference`, so the deployment's own
 * collector keeps the OTLP default (cumulative) and honours
 * `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` if it sets one. A
 * customer's time-series store computes `rate()` / `increase()` from a
 * monotonically growing total; feeding it deltas breaks every counter panel
 * built on top of it. The first-party channel is the opposite case and has its
 * own constructor below — do not merge the two.
 */
function createOTLPMetricExporter(config: TelemetryConfig) {
  const exporterConfig: {
    url?: string;
    headers?: Record<string, string> | HeadersProvider;
  } = {};

  if (config.endpoint) {
    exporterConfig.url = `${config.endpoint}/v1/metrics`;
  }
  const headers = buildExporterHeaders(config);
  if (headers) {
    exporterConfig.headers = headers;
  }

  return new exporterMetricsOtlpHttp!.OTLPMetricExporter(exporterConfig);
}

/**
 * How often the first-party channel ships metrics.
 *
 * Five minutes rather than the OTLP default of 60 s, because this channel
 * exists to be **stored and aggregated later**, not to be charted live: nothing
 * on the console needs minute resolution, and a longer window cuts the number
 * of payloads (and rows the intake has to write) by 5× for free. Claude Code
 * lands on the same number for the same reason (`5 * 60 * 1000` at its
 * first-party reader).
 */
const FIRST_PARTY_METRIC_EXPORT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Create the first-party metric exporter: same transport as the collector one,
 * with the two settings that make the intake cheap to aggregate.
 *
 * **DELTA is not a tuning knob — DO NOT CHANGE THIS TO CUMULATIVE.** The
 * first-party intake stores every point and the console sums them per time
 * window long after the fact. Under cumulative semantics each point carries the
 * process's whole history, so (a) every export re-sends every series the
 * process has ever recorded, and (b) the only way to answer "how many requests
 * yesterday" is to pull the raw points back and difference them in application
 * memory — which is exactly what made the engineering-metrics dashboard take
 * ~50 s. A delta point already *is* the answer for its interval, so the query
 * is a `sum`.
 *
 * The preference is passed explicitly rather than left to
 * `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE`: that env var is
 * machine-wide and would otherwise decide this channel's semantics (it also
 * governs the customer exporter, which must stay cumulative). An explicit
 * preference wins over the env var, so a deployment that sets the env var for
 * its own collector cannot silently turn the first-party channel back into
 * cumulative.
 */
function createFirstPartyMetricExporter(channel: FirstPartyChannel) {
  return new exporterMetricsOtlpHttp!.OTLPMetricExporter({
    url: `${channel.endpoint}/v1/metrics`,
    headers: channel.headers,
    temporalityPreference:
      exporterMetricsOtlpHttp!.AggregationTemporalityPreference.DELTA,
  });
}

/**
 * Create an OTLP log exporter.
 */
function createOTLPLogExporter(config: TelemetryConfig) {
  const exporterConfig: {
    url?: string;
    headers?: Record<string, string> | HeadersProvider;
  } = {};

  if (config.endpoint) {
    exporterConfig.url = `${config.endpoint}/v1/logs`;
  }
  const headers = buildExporterHeaders(config);
  if (headers) {
    exporterConfig.headers = headers;
  }

  return new exporterLogsOtlpHttp!.OTLPLogExporter(exporterConfig);
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
    headersProvider = resolveHeadersProvider(currentConfig);

    // The two pipelines are independent, so neither decides for the other: a
    // machine with nothing configured still reports to Wave while the
    // first-party channel is on, and one whose first-party channel is off
    // still exports to its own collector.
    const firstParty = currentConfig.firstPartyEnabled
      ? resolveFirstPartyChannel()
      : undefined;

    if (!currentConfig.enabled && !firstParty) {
      logger?.debug("Telemetry not enabled (no exporters configured)");
      return;
    }

    const { metricsExporter, logsExporter } = currentConfig;

    // Build resource attributes (lightweight assembly: sdk-metrics + resources).
    // `OTEL_RESOURCE_ATTRIBUTES` is the hook an enterprise uses to label its own
    // fleet (department, team, cost centre), so the detected resource is part of
    // the merge; ours come last and therefore win, keeping `service.name` at the
    // value the collector contract expects.
    //
    // `aggregation.temporality` (same key Claude Code's first-party exporter
    // carries) tells the intake — and anyone reading a raw payload — which
    // dialect these counters are in, without having to guess. It is stated only
    // when the resource can be unambiguous: one resource serves every reader,
    // so with a customer metric pipeline alongside, the very same resource ships
    // with cumulative points as well; a marker there would be a claim about the
    // wrong payload, so it is omitted rather than made wrong.
    const customerMetricsConfigured =
      (metricsExporter === "otlp" && !!currentConfig.endpoint) ||
      metricsExporter === "console";
    const temporalityAttributes =
      firstParty && !customerMetricsConfigured
        ? { "aggregation.temporality": "delta" }
        : {};

    const envResource = otelResources!.detectResources({
      detectors: [otelResources!.envDetector],
    });
    const resource = otelResources!
      .defaultResource()
      .merge(envResource)
      .merge(
        otelResources!.resourceFromAttributes({
          "service.name": "wave",
          "service.version": getServiceVersion(),
          "os.type": process.platform,
          "host.arch": process.arch,
          ...temporalityAttributes,
        }),
      );

    const metricReaders: import("@opentelemetry/sdk-metrics").MetricReader[] =
      [];

    if (metricsExporter === "otlp" && currentConfig.endpoint) {
      metricReaders.push(
        new sdkMetrics!.PeriodicExportingMetricReader({
          exporter: createOTLPMetricExporter(currentConfig),
        }),
      );
    } else if (metricsExporter === "console") {
      metricReaders.push(
        new sdkMetrics!.PeriodicExportingMetricReader({
          exporter: new sdkMetrics!.ConsoleMetricExporter(),
        }),
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
    } else if (logsExporter === "console") {
      logProcessors.push(
        new sdkLogs!.BatchLogRecordProcessor(
          new sdkLogs!.ConsoleLogRecordExporter(),
        ),
      );
    }

    // First-party channel: the same exporters with a different endpoint and
    // credential. Additive on purpose — whatever the block above configured
    // keeps receiving everything (spec 场景 2), and this one never borrows its
    // endpoint, so pointing Wave at a customer collector cannot misfile
    // first-party data.
    //
    // It is also the one place where the channel's *dialect* differs: DELTA and
    // a 5-minute window, versus the collector's cumulative / 60 s. Both settings
    // hang off this reader, and the interval is its own constant rather than a
    // shared one, so tuning one channel can never move the other.
    if (firstParty) {
      metricReaders.push(
        new sdkMetrics!.PeriodicExportingMetricReader({
          exporter: createFirstPartyMetricExporter(firstParty),
          exportIntervalMillis: FIRST_PARTY_METRIC_EXPORT_INTERVAL_MS,
        }),
      );
      logProcessors.push(
        new sdkLogs!.BatchLogRecordProcessor(
          new exporterLogsOtlpHttp!.OTLPLogExporter({
            url: `${firstParty.endpoint}/v1/logs`,
            headers: firstParty.headers,
          }),
        ),
      );
    }

    // Only initialize providers if at least one exporter is configured
    if (metricReaders.length > 0 || logProcessors.length > 0) {
      if (metricReaders.length > 0) {
        meterProvider = new sdkMetrics!.MeterProvider({
          resource,
          readers: metricReaders,
        });
        api!.metrics.setGlobalMeterProvider(meterProvider);
        // Instruments are created on the meter and held by the metrics module;
        // before this call every record function no-ops. The attribute policy
        // rides along: `session.id` is per-record (one process hosts several
        // sessions), and the resource keys the deployment declared are projected
        // onto the data points as well, so a collector that does not turn
        // resource attributes into series labels still lets them filter by team.
        initMetrics(meterProvider.getMeter("wave"), {
          includeSessionId: currentConfig.includeSessionId,
          includeRepository: currentConfig.includeRepository,
          includeEntrypoint: currentConfig.includeEntrypoint,
          resourceAttributes: currentConfig.includeResourceAttributes
            ? envResource.attributes
            : {},
        });
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
        metricsExporter,
        logsExporter,
        endpoint: currentConfig.endpoint,
        firstPartyEndpoint: firstParty?.endpoint,
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
 * Flush pending telemetry without tearing anything down.
 *
 * The providers are process-scoped: agents come and go inside one process (the
 * daemon hosts every session of a remote desktop, `--stdio` re-creates the
 * agent on `updateConfig`), and one of them finishing must not stop collection
 * for the sessions still running. So an agent's teardown only flushes — the
 * lifetime teardown is `shutdownTelemetry()`, which callers reach for when the
 * process itself is done. Respects shutdownTimeoutMs config.
 */
export async function flushTelemetry(): Promise<void> {
  if (!meterProvider && !loggerProvider) {
    return;
  }

  const timeout = currentConfig?.shutdownTimeoutMs ?? 2_000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<void>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Telemetry flush timed out")),
        timeout,
      );
    });

    const flushes: Promise<void>[] = [];
    if (meterProvider) flushes.push(meterProvider.forceFlush());
    if (loggerProvider) flushes.push(loggerProvider.forceFlush());

    await Promise.race([Promise.all(flushes), timeoutPromise]);
    logger?.debug("OpenTelemetry flushed");
  } catch (error) {
    logger?.warn("OpenTelemetry flush failed:", error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shut down OpenTelemetry, flushing all pending data and unregistering the
 * global providers.
 * Respects shutdownTimeoutMs config.
 *
 * The unregistration matters: `@opentelemetry/api` refuses to replace an
 * already-registered global provider — the second `setGlobalMeterProvider()`
 * returns `false` without touching the delegate — so leaving the providers
 * registered would make every later `initializeTelemetry()` in the same process
 * a silent no-op that keeps delegating to this shut-down provider (and
 * `initialized = true`, so nothing complains). Only `disable()` clears the slot.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!meterProvider && !loggerProvider) {
    return;
  }

  const timeout = currentConfig?.shutdownTimeoutMs ?? 2_000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<void>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Telemetry shutdown timed out")),
        timeout,
      );
    });

    const shutdowns: Promise<void>[] = [];
    if (meterProvider) shutdowns.push(meterProvider.shutdown());
    if (loggerProvider) shutdowns.push(loggerProvider.shutdown());

    await Promise.race([Promise.all(shutdowns), timeoutPromise]);
    logger?.debug("OpenTelemetry shut down successfully");
  } catch (error) {
    logger?.warn("OpenTelemetry shutdown failed:", error);
  } finally {
    clearTimeout(timer);
    // Unregister only what this module registered — the global slots are
    // process-wide, and a host may have put its own provider there.
    if (meterProvider) api?.metrics.disable();
    if (loggerProvider) apiLogs?.logs.disable();
    meterProvider = undefined;
    loggerProvider = undefined;
    initialized = false;
    currentConfig = undefined;
    headersProvider = undefined;
    resetMetrics();
  }
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
