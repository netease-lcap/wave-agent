import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { MeterProvider } from "@opentelemetry/api";
import type { TelemetryConfig } from "@/types/telemetry.js";

/**
 * These tests deliberately use the REAL `@opentelemetry/api` and the real
 * metrics SDK, and only fake the OTLP exporter so metrics leaving the process
 * are visible. A mocked API cannot reproduce the bug these lock: the API's
 * global provider slot is set-once, so a second `setGlobalMeterProvider()`
 * silently returns `false` and keeps delegating to the provider that was just
 * shut down.
 */
const { exported } = vi.hoisted(() => ({
  exported: [] as Array<{ name: string; values: number[] }>,
}));

vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
  OTLPMetricExporter: class {
    export(
      metrics: ResourceMetrics,
      resultCallback: (result: { code: number }) => void,
    ): void {
      for (const scope of metrics.scopeMetrics) {
        for (const metric of scope.metrics) {
          const loose = metric as unknown as {
            descriptor: { name: string };
            dataPoints: Array<{ value: unknown }>;
          };
          exported.push({
            name: loose.descriptor.name,
            // A sum point carries a number, a histogram point a bucket summary.
            values: loose.dataPoints.map((point) =>
              typeof point.value === "number"
                ? point.value
                : (point.value as { count: number }).count,
            ),
          });
        }
      }
      resultCallback({ code: 0 });
    }
    shutdown(): Promise<void> {
      return Promise.resolve();
    }
    forceFlush(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock("@/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const OTLP_CONFIG: Partial<TelemetryConfig> = {
  enabled: true,
  metricsExporter: "otlp",
  endpoint: "http://localhost:4318",
};

describe("telemetry lifecycle", () => {
  let instrumentation: typeof import("@/telemetry/instrumentation.js");
  let metrics: typeof import("@/telemetry/metrics.js");
  let api: typeof import("@opentelemetry/api");
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    delete process.env.DISABLE_TELEMETRY;
    delete process.env.OTEL_METRICS_EXPORTER;
    delete process.env.OTEL_LOGS_EXPORTER;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    exported.length = 0;
    vi.resetModules();

    // The global provider slot lives in the API module, which Node may cache
    // for the whole worker — start from an empty slot regardless.
    api = await import("@opentelemetry/api");
    api.metrics.disable();
    instrumentation = await import("@/telemetry/instrumentation.js");
    metrics = await import("@/telemetry/metrics.js");
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should export metrics again after a shutdown and re-initialization", async () => {
    await instrumentation.initializeTelemetry(OTLP_CONFIG);
    metrics.recordSession();
    await instrumentation.flushTelemetry();
    expect(exported).toEqual([{ name: "wave.sessions", values: [1] }]);

    await instrumentation.shutdownTelemetry();
    // The SDK's own final export on shutdown is not what this test locks.
    exported.length = 0;

    // A new session in the same process (the daemon hosts many) must collect.
    await instrumentation.initializeTelemetry(OTLP_CONFIG);
    metrics.recordSession();
    await instrumentation.flushTelemetry();

    expect(exported).toEqual([{ name: "wave.sessions", values: [1] }]);
  });

  it("should keep collecting for the surviving agents after one flushes", async () => {
    await instrumentation.initializeTelemetry(OTLP_CONFIG);
    metrics.recordSession();

    // What one agent's destroy does now — the others must be unaffected.
    await instrumentation.flushTelemetry();
    exported.length = 0;

    metrics.recordSession();
    await instrumentation.flushTelemetry();

    // Cumulative and still running: the second agent's record added to the first.
    expect(exported).toEqual([{ name: "wave.sessions", values: [2] }]);
    expect(instrumentation.isInitialized()).toBe(true);
  });

  it("should report a refused global registration instead of staying silent", async () => {
    api.metrics.setGlobalMeterProvider({} as unknown as MeterProvider);

    await instrumentation.initializeTelemetry(OTLP_CONFIG);

    const globalLogger = await import("@/utils/globalLogger.js");
    expect(vi.mocked(globalLogger.logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("[otel]"),
    );
  });
});
