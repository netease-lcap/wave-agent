import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { TracerProvider } from "@opentelemetry/api";
import type { TelemetryConfig } from "@/types/telemetry.js";

/**
 * These tests deliberately use the REAL `@opentelemetry/api` and the real trace
 * SDK, and only fake the OTLP exporter so spans leaving the process are
 * visible. A mocked API cannot reproduce the bug these lock: the API's global
 * provider slot is set-once, so a second `setGlobalTracerProvider()` silently
 * returns `false` and keeps delegating to the provider that was just shut down.
 */
const { exported } = vi.hoisted(() => ({ exported: [] as string[] }));

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    export(
      spans: ReadableSpan[],
      resultCallback: (result: { code: number }) => void,
    ): void {
      exported.push(...spans.map((span) => span.name));
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
  tracesExporter: "otlp",
  endpoint: "http://localhost:4318",
};

describe("telemetry lifecycle", () => {
  let instrumentation: typeof import("@/telemetry/instrumentation.js");
  let api: typeof import("@opentelemetry/api");
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_TRACES_EXPORTER;
    delete process.env.OTEL_LOGS_EXPORTER;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    exported.length = 0;
    vi.resetModules();

    // The global provider slot lives in the API module, which Node may cache
    // for the whole worker — start from an empty slot regardless.
    api = await import("@opentelemetry/api");
    api.trace.disable();
    instrumentation = await import("@/telemetry/instrumentation.js");
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should export spans again after a shutdown and re-initialization", async () => {
    await instrumentation.initializeTelemetry(OTLP_CONFIG);
    api.trace.getTracer("test").startSpan("before-shutdown").end();
    await instrumentation.shutdownTelemetry();
    expect(exported).toEqual(["before-shutdown"]);

    // A new session in the same process (the daemon hosts many) must collect.
    await instrumentation.initializeTelemetry(OTLP_CONFIG);
    api.trace.getTracer("test").startSpan("after-reinit").end();
    await instrumentation.shutdownTelemetry();

    expect(exported).toEqual(["before-shutdown", "after-reinit"]);
  });

  it("should keep collecting for the surviving agents after one flushes", async () => {
    await instrumentation.initializeTelemetry(OTLP_CONFIG);

    // What one agent's destroy does now — the others must be unaffected.
    await instrumentation.flushTelemetry();

    api.trace.getTracer("test").startSpan("after-flush").end();
    await instrumentation.shutdownTelemetry();

    expect(exported).toEqual(["after-flush"]);
  });

  it("should report a refused global registration instead of staying silent", async () => {
    api.trace.setGlobalTracerProvider({} as unknown as TracerProvider);

    await instrumentation.initializeTelemetry(OTLP_CONFIG);

    const globalLogger = await import("@/utils/globalLogger.js");
    expect(vi.mocked(globalLogger.logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("[otel]"),
    );
  });
});
