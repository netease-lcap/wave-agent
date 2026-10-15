import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { TelemetryConfig } from "@/types/telemetry.js";

// Mock globalLogger to suppress output
vi.mock("@/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * The OTLP headers helper shells out, so `spawn` is stubbed here: this file is
 * about the wiring (config → provider → exporter headers), not about running
 * commands — `tests/telemetry/headersHelper.test.ts` covers the executor.
 */
const spawnMock = vi.fn();
vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) };
});

/** A fake shell child that writes `stdout` and exits 0. */
function fakeHelperChild(stdout: string): EventEmitter {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  queueMicrotask(() => {
    child.stdout.emit("data", Buffer.from(stdout));
    child.emit("close", 0, null);
  });
  return child;
}

/** The six instrument names the metrics module creates on the meter. */
const COUNTER_NAMES = [
  "wave.api.requests",
  "wave.api.errors",
  "wave.tokens",
  "wave.sessions",
  "wave.lines.changed",
];

function setupMocks() {
  const mockMeterShutdown = vi.fn().mockResolvedValue(undefined);
  const mockLoggerShutdown = vi.fn().mockResolvedValue(undefined);
  const mockMeterFlush = vi.fn().mockResolvedValue(undefined);
  const mockLoggerFlush = vi.fn().mockResolvedValue(undefined);

  const mockCreateCounter = vi.fn(() => ({ add: vi.fn() }));
  const mockCreateHistogram = vi.fn(() => ({ record: vi.fn() }));
  const mockGetMeter = vi.fn(() => ({
    createCounter: mockCreateCounter,
    createHistogram: mockCreateHistogram,
  }));

  const mockMeterProvider = vi.fn().mockImplementation(function () {
    return {
      shutdown: mockMeterShutdown,
      forceFlush: mockMeterFlush,
      getMeter: mockGetMeter,
    };
  });
  const mockLoggerProvider = vi.fn().mockImplementation(function () {
    return { shutdown: mockLoggerShutdown, forceFlush: mockLoggerFlush };
  });
  const mockPeriodicExportingMetricReader = vi.fn();
  const mockBatchLogRecordProcessor = vi.fn();
  const mockSetGlobalMeterProvider = vi.fn();
  const mockSetGlobalLoggerProvider = vi.fn();
  const mockMetricsDisable = vi.fn();
  const mockLogsDisable = vi.fn();
  const mockDiagSetLogger = vi.fn();

  const mockOTLPMetricExporter = vi.fn();
  const mockOTLPLogExporter = vi.fn();
  const mockConsoleMetricExporter = vi.fn();
  const mockConsoleLogRecordExporter = vi.fn();

  const mockResource = {
    defaultResource: vi.fn().mockReturnValue({
      merge: vi.fn().mockReturnValue({}),
    }),
    resourceFromAttributes: vi.fn().mockReturnValue({}),
  };

  vi.doMock("@opentelemetry/sdk-metrics", () => ({
    MeterProvider: mockMeterProvider,
    PeriodicExportingMetricReader: mockPeriodicExportingMetricReader,
    ConsoleMetricExporter: mockConsoleMetricExporter,
  }));

  vi.doMock("@opentelemetry/resources", () => mockResource);

  vi.doMock("@opentelemetry/api", () => ({
    metrics: {
      setGlobalMeterProvider: mockSetGlobalMeterProvider,
      disable: mockMetricsDisable,
    },
    diag: { setLogger: mockDiagSetLogger },
    DiagLogLevel: { ERROR: 0 },
  }));

  vi.doMock("@opentelemetry/api-logs", () => ({
    logs: {
      setGlobalLoggerProvider: mockSetGlobalLoggerProvider,
      disable: mockLogsDisable,
    },
  }));

  vi.doMock("@opentelemetry/sdk-logs", () => ({
    LoggerProvider: mockLoggerProvider,
    BatchLogRecordProcessor: mockBatchLogRecordProcessor,
    ConsoleLogRecordExporter: mockConsoleLogRecordExporter,
  }));

  vi.doMock("@opentelemetry/exporter-metrics-otlp-http", () => ({
    OTLPMetricExporter: mockOTLPMetricExporter,
  }));

  vi.doMock("@opentelemetry/exporter-logs-otlp-http", () => ({
    OTLPLogExporter: mockOTLPLogExporter,
  }));

  return {
    mockMeterProvider,
    mockLoggerProvider,
    mockPeriodicExportingMetricReader,
    mockBatchLogRecordProcessor,
    mockMeterShutdown,
    mockLoggerShutdown,
    mockMeterFlush,
    mockLoggerFlush,
    mockGetMeter,
    mockCreateCounter,
    mockCreateHistogram,
    mockSetGlobalMeterProvider,
    mockSetGlobalLoggerProvider,
    mockMetricsDisable,
    mockLogsDisable,
    mockDiagSetLogger,
    mockOTLPMetricExporter,
    mockOTLPLogExporter,
    mockConsoleMetricExporter,
    mockConsoleLogRecordExporter,
    mockResource,
  };
}

/** The exporter config object a mocked OTLP exporter was constructed with. */
function exporterConfig(
  mock: ReturnType<typeof vi.fn>,
  index = 0,
): { url?: string; headers?: unknown } {
  return mock.mock.calls[index]![0] as { url?: string; headers?: unknown };
}

/** The instrument names a mocked meter was asked to create (counters first). */
function createdCounterNames(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls.map((call) => call[0]);
}

describe("instrumentation", () => {
  let instrumentation: typeof import("@/telemetry/instrumentation.js");
  let mocks: ReturnType<typeof setupMocks>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    // Strip OTEL env vars to prevent local shell config from poisoning tests
    delete process.env.OTEL_METRICS_EXPORTER;
    delete process.env.OTEL_LOGS_EXPORTER;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_LOG_USER_PROMPTS;
    delete process.env.OTEL_LOG_TOOL_CONTENT;
    delete process.env.OTEL_SHUTDOWN_TIMEOUT_MS;
    spawnMock.mockReset();
    vi.resetModules();
    mocks = setupMocks();
    instrumentation = await import("@/telemetry/instrumentation.js");
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("resolveTelemetryConfig", () => {
    it("should return defaults when no config or env vars provided", () => {
      const config = instrumentation.resolveTelemetryConfig();
      expect(config.enabled).toBe(false);
      expect(config.metricsExporter).toBeUndefined();
      expect(config.logsExporter).toBeUndefined();
      expect(config.logUserPrompts).toBe(false);
      expect(config.logToolContent).toBe(false);
      expect(config.shutdownTimeoutMs).toBe(2000);
    });

    it("should read from settings config", () => {
      const config = instrumentation.resolveTelemetryConfig({
        enabled: true,
        metricsExporter: "console",
        logsExporter: "otlp",
        endpoint: "http://localhost:4318",
        logUserPrompts: true,
      });
      expect(config.enabled).toBe(true);
      expect(config.metricsExporter).toBe("console");
      expect(config.logsExporter).toBe("otlp");
      expect(config.endpoint).toBe("http://localhost:4318");
      expect(config.logUserPrompts).toBe(true);
    });

    it("should let env vars take precedence over settings config", () => {
      process.env.OTEL_METRICS_EXPORTER = "otlp";
      process.env.OTEL_ENABLED = "false";
      process.env.OTEL_LOG_USER_PROMPTS = "true";

      const config = instrumentation.resolveTelemetryConfig({
        enabled: true,
        metricsExporter: "console",
        logUserPrompts: false,
      });

      expect(config.enabled).toBe(false);
      expect(config.metricsExporter).toBe("otlp");
      expect(config.logUserPrompts).toBe(true);
    });

    it("should parse OTEL_EXPORTER_OTLP_HEADERS env var", () => {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = "api-key=abc123,org-id=xyz";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.headers).toEqual({ "api-key": "abc123", "org-id": "xyz" });
    });

    it("should parse OTEL_EXPORTER_OTLP_PROTOCOL env var", () => {
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/json";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.protocol).toBe("http/json");
    });

    it("should handle OTEL_ENABLED=false from env", () => {
      process.env.OTEL_ENABLED = "false";

      const config = instrumentation.resolveTelemetryConfig({
        enabled: true,
        metricsExporter: "console",
      });
      expect(config.enabled).toBe(false);
    });

    it("should enable telemetry when exporters are configured", () => {
      const config = instrumentation.resolveTelemetryConfig({
        metricsExporter: "console",
      });
      expect(config.enabled).toBe(true);
    });

    it("should warn on unknown exporter env value", async () => {
      process.env.OTEL_METRICS_EXPORTER = "unknown_exporter";

      const config = instrumentation.resolveTelemetryConfig({
        metricsExporter: "console",
      });

      // Falls through to config value since unknown is not console/otlp
      expect(config.metricsExporter).toBe("console");
      const { logger } = await import("@/utils/globalLogger.js");
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("Unknown OTEL exporter"),
      );
    });

    it("should treat OTEL_METRICS_EXPORTER=none as unset (fall to config)", () => {
      process.env.OTEL_METRICS_EXPORTER = "none";

      const config = instrumentation.resolveTelemetryConfig({
        metricsExporter: "console",
      });

      expect(config.metricsExporter).toBe("console");
    });

    it("should use logs exporter from env var", () => {
      process.env.OTEL_LOGS_EXPORTER = "console";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.logsExporter).toBe("console");
    });

    it("should enable telemetry when only logs exporter configured", () => {
      const config = instrumentation.resolveTelemetryConfig({
        logsExporter: "console",
      });
      expect(config.enabled).toBe(true);
    });

    it("should ignore an exporter value from config that this version does not know", async () => {
      // A settings.json left over from the JSONL/traces era must not be handed
      // to the SDK as if it were usable.
      const config = instrumentation.resolveTelemetryConfig({
        metricsExporter: "jsonl",
      } as unknown as Partial<TelemetryConfig>);

      expect(config.metricsExporter).toBeUndefined();
      const { logger } = await import("@/utils/globalLogger.js");
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("Unknown OTEL exporter in config"),
      );
    });

    it("should warn about legacy traces keys and drop them", async () => {
      const config = instrumentation.resolveTelemetryConfig({
        tracesExporter: "otlp",
        spanTtlMs: 60000,
      } as unknown as Partial<TelemetryConfig>);

      expect("tracesExporter" in config).toBe(false);
      expect(config.enabled).toBe(false);
      const { logger } = await import("@/utils/globalLogger.js");
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("no longer supported"),
      );
    });

    it("should use endpoint from env var over config", () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://env-endpoint:4318";

      const config = instrumentation.resolveTelemetryConfig({
        endpoint: "http://config-endpoint:4318",
      });
      expect(config.endpoint).toBe("http://env-endpoint:4318");
    });

    it("should use protocol from config when env not set", () => {
      const config = instrumentation.resolveTelemetryConfig({
        protocol: "grpc",
      });
      expect(config.protocol).toBe("grpc");
    });

    it("should parse headers with value containing equals sign", () => {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = "auth=base64==,key=value";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.headers).toEqual({
        auth: "base64==",
        key: "value",
      });
    });

    it("should return undefined headers when env has only malformed pairs", () => {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = "=value,noequal";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.headers).toBeUndefined();
    });

    it("should fall back to config headers when env not set", () => {
      const config = instrumentation.resolveTelemetryConfig({
        headers: { "api-key": "from-config" },
      });
      expect(config.headers).toEqual({ "api-key": "from-config" });
    });

    it("should resolve logUserPrompts with env=1", () => {
      process.env.OTEL_LOG_USER_PROMPTS = "1";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.logUserPrompts).toBe(true);
    });

    it("should resolve logUserPrompts with env=true", () => {
      process.env.OTEL_LOG_USER_PROMPTS = "true";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.logUserPrompts).toBe(true);
    });

    it("should resolve logUserPrompts with env=0", () => {
      process.env.OTEL_LOG_USER_PROMPTS = "0";

      const config = instrumentation.resolveTelemetryConfig({
        logUserPrompts: true,
      });
      expect(config.logUserPrompts).toBe(false);
    });

    it("should resolve logUserPrompts with env=false", () => {
      process.env.OTEL_LOG_USER_PROMPTS = "false";

      const config = instrumentation.resolveTelemetryConfig({
        logUserPrompts: true,
      });
      expect(config.logUserPrompts).toBe(false);
    });

    it("should resolve logUserPrompts with invalid env (fall to config)", () => {
      process.env.OTEL_LOG_USER_PROMPTS = "invalid";

      const config = instrumentation.resolveTelemetryConfig({
        logUserPrompts: true,
      });
      expect(config.logUserPrompts).toBe(true);
    });

    it("should resolve logToolContent with env=1", () => {
      process.env.OTEL_LOG_TOOL_CONTENT = "1";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.logToolContent).toBe(true);
    });

    it("should resolve logToolContent with env=0", () => {
      process.env.OTEL_LOG_TOOL_CONTENT = "0";

      const config = instrumentation.resolveTelemetryConfig({
        logToolContent: true,
      });
      expect(config.logToolContent).toBe(false);
    });

    it("should resolve logToolContent with invalid env (fall to config)", () => {
      process.env.OTEL_LOG_TOOL_CONTENT = "invalid";

      const config = instrumentation.resolveTelemetryConfig({
        logToolContent: true,
      });
      expect(config.logToolContent).toBe(true);
    });

    it("should resolve shutdownTimeoutMs with valid env", () => {
      process.env.OTEL_SHUTDOWN_TIMEOUT_MS = "5000";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.shutdownTimeoutMs).toBe(5000);
    });

    it("should resolve shutdownTimeoutMs with NaN env (fall to config)", () => {
      process.env.OTEL_SHUTDOWN_TIMEOUT_MS = "abc";

      const config = instrumentation.resolveTelemetryConfig({
        shutdownTimeoutMs: 9999,
      });
      expect(config.shutdownTimeoutMs).toBe(9999);
    });

    it("should resolve shutdownTimeoutMs with negative env (fall to default)", () => {
      process.env.OTEL_SHUTDOWN_TIMEOUT_MS = "-1";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.shutdownTimeoutMs).toBe(2000);
    });
  });

  describe("dynamic OTLP headers", () => {
    it("should pass a static headers map through unchanged", async () => {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = "api-key=abc";

      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
        endpoint: "http://localhost:4318",
      });

      expect(exporterConfig(mocks.mockOTLPMetricExporter).headers).toEqual({
        "api-key": "abc",
      });
    });

    it("should not read the helper unless it is configured", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
        logsExporter: "otlp",
        endpoint: "http://localhost:4318",
      });

      expect(spawnMock).not.toHaveBeenCalled();
      expect(
        exporterConfig(mocks.mockOTLPMetricExporter).headers,
      ).toBeUndefined();
    });

    it("should merge injected dynamic headers over the static base, per send", async () => {
      process.env.OTEL_EXPORTER_OTLP_HEADERS =
        "static-key=static-value,shared=static";
      const provider = vi
        .fn<() => Promise<Record<string, string>>>()
        .mockResolvedValueOnce({ shared: "first", fresh: "v1" })
        .mockResolvedValue({ shared: "second", fresh: "v2" });

      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
        logsExporter: "otlp",
        endpoint: "http://localhost:4318",
        headersProvider: provider,
      });

      const headers = exporterConfig(mocks.mockOTLPMetricExporter)
        .headers as () => Promise<Record<string, string>>;
      expect(typeof headers).toBe("function");
      await expect(headers()).resolves.toEqual({
        "static-key": "static-value",
        shared: "first",
        fresh: "v1",
      });
      // Re-read for every batch, so a rotated credential lands without a restart.
      await expect(headers()).resolves.toEqual({
        "static-key": "static-value",
        shared: "second",
        fresh: "v2",
      });
      expect(provider).toHaveBeenCalledTimes(2);
    });

    it("should share one provider between the metrics and logs exporters", async () => {
      const provider = vi
        .fn<() => Promise<Record<string, string>>>()
        .mockResolvedValue({ shared: "once" });

      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
        logsExporter: "otlp",
        endpoint: "http://localhost:4318",
        headersProvider: provider,
      });

      const metricHeaders = exporterConfig(mocks.mockOTLPMetricExporter)
        .headers as () => Promise<Record<string, string>>;
      const logHeaders = exporterConfig(mocks.mockOTLPLogExporter)
        .headers as () => Promise<Record<string, string>>;

      await expect(metricHeaders()).resolves.toEqual({ shared: "once" });
      await expect(logHeaders()).resolves.toEqual({ shared: "once" });
      expect(provider).toHaveBeenCalledTimes(2);
    });

    it("should run a configured helper command and use its stdout", async () => {
      spawnMock.mockImplementationOnce(() =>
        fakeHelperChild('{"kubeinsight-client-token":"rotated"}'),
      );

      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
        logsExporter: "otlp",
        endpoint: "http://localhost:4318",
        headersHelper: "  mint-token --env prod  ",
      });

      const metricHeaders = exporterConfig(mocks.mockOTLPMetricExporter)
        .headers as () => Promise<Record<string, string>>;
      const logHeaders = exporterConfig(mocks.mockOTLPLogExporter)
        .headers as () => Promise<Record<string, string>>;
      expect(typeof metricHeaders).toBe("function");
      await expect(metricHeaders()).resolves.toEqual({
        "kubeinsight-client-token": "rotated",
      });
      // Shared with the second exporter rather than run twice.
      await expect(logHeaders()).resolves.toEqual({
        "kubeinsight-client-token": "rotated",
      });
      expect(spawnMock).toHaveBeenCalledTimes(1);
      // Trimmed before use
      expect((spawnMock.mock.calls[0]![1] as string[])[1]).toContain(
        "mint-token --env prod",
      );
    });

    it("should prefer an injected provider over the configured helper", async () => {
      const provider = vi
        .fn<() => Promise<Record<string, string>>>()
        .mockResolvedValue({ from: "provider" });

      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
        endpoint: "http://localhost:4318",
        headersHelper: "mint-token",
        headersProvider: provider,
      });

      const headers = exporterConfig(mocks.mockOTLPMetricExporter)
        .headers as () => Promise<Record<string, string>>;
      await expect(headers()).resolves.toEqual({ from: "provider" });
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it("should carry the helper command through resolveTelemetryConfig", () => {
      const config = instrumentation.resolveTelemetryConfig({
        headersHelper: "  mint-token  ",
      });
      expect(config.headersHelper).toBe("mint-token");

      expect(
        instrumentation.resolveTelemetryConfig({ headersHelper: "   " })
          .headersHelper,
      ).toBeUndefined();
    });

    it("should keep the dynamic headers factory out of the exporters after shutdown", async () => {
      const provider = vi
        .fn<() => Promise<Record<string, string>>>()
        .mockResolvedValue({ shared: "once" });

      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
        endpoint: "http://localhost:4318",
        headersProvider: provider,
      });
      await instrumentation.shutdownTelemetry();

      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
        endpoint: "http://localhost:4318",
      });

      const config = exporterConfig(mocks.mockOTLPMetricExporter, 1);
      expect(config.headers).toBeUndefined();
    });
  });

  describe("initializeTelemetry", () => {
    it("should be idempotent — skip on second call", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });

      expect(mocks.mockMeterProvider).toHaveBeenCalledTimes(1);
      expect(mocks.mockSetGlobalMeterProvider).toHaveBeenCalledTimes(1);

      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });

      expect(mocks.mockMeterProvider).toHaveBeenCalledTimes(1);
      expect(mocks.mockSetGlobalMeterProvider).toHaveBeenCalledTimes(1);
    });

    it("should set isInitialized to true after successful init", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });
      expect(instrumentation.isInitialized()).toBe(true);
    });

    it("should set currentConfig after successful init", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
        endpoint: "http://localhost:4318",
      });
      const config = instrumentation.getCurrentConfig();
      expect(config).toBeDefined();
      expect(config?.metricsExporter).toBe("console");
      expect(config?.endpoint).toBe("http://localhost:4318");
    });

    it("should not initialize when disabled", async () => {
      await instrumentation.initializeTelemetry({ enabled: false });
      expect(instrumentation.isInitialized()).toBe(false);
      expect(mocks.mockMeterProvider).not.toHaveBeenCalled();
    });

    it("should not initialize when no exporters configured", async () => {
      await instrumentation.initializeTelemetry({ enabled: true });
      expect(instrumentation.isInitialized()).toBe(false);
      expect(mocks.mockMeterProvider).not.toHaveBeenCalled();
    });

    it("should gracefully degrade on failure", async () => {
      mocks.mockMeterProvider.mockImplementationOnce(function () {
        throw new Error("Network error");
      });

      await expect(
        instrumentation.initializeTelemetry({
          enabled: true,
          metricsExporter: "console",
        }),
      ).resolves.toBeUndefined();

      expect(instrumentation.isInitialized()).toBe(false);
    });

    it("should initialize with OTLP metrics exporter when endpoint provided", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
        endpoint: "http://localhost:4318",
      });

      expect(instrumentation.isInitialized()).toBe(true);
      expect(mocks.mockMeterProvider).toHaveBeenCalledTimes(1);
      expect(mocks.mockPeriodicExportingMetricReader).toHaveBeenCalledTimes(1);
      // Signals travel to their own OTLP routes, appended to the base endpoint.
      expect(exporterConfig(mocks.mockOTLPMetricExporter).url).toBe(
        "http://localhost:4318/v1/metrics",
      );
    });

    it("should initialize with OTLP logs exporter when endpoint provided", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        logsExporter: "otlp",
        endpoint: "http://localhost:4318",
      });

      expect(instrumentation.isInitialized()).toBe(true);
      expect(mocks.mockLoggerProvider).toHaveBeenCalledTimes(1);
      expect(mocks.mockBatchLogRecordProcessor).toHaveBeenCalledTimes(1);
      expect(exporterConfig(mocks.mockOTLPLogExporter).url).toBe(
        "http://localhost:4318/v1/logs",
      );
    });

    it("should initialize with both OTLP exporters", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
        logsExporter: "otlp",
        endpoint: "http://localhost:4318",
      });

      expect(instrumentation.isInitialized()).toBe(true);
      expect(mocks.mockMeterProvider).toHaveBeenCalledTimes(1);
      expect(mocks.mockLoggerProvider).toHaveBeenCalledTimes(1);
    });

    it("should not initialize OTLP metrics without endpoint", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "otlp",
      });

      // OTLP requires endpoint, so no SDK init should happen
      expect(mocks.mockMeterProvider).not.toHaveBeenCalled();
      expect(instrumentation.isInitialized()).toBe(false);
    });

    it("should not initialize OTLP logs without endpoint", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        logsExporter: "otlp",
      });

      expect(mocks.mockLoggerProvider).not.toHaveBeenCalled();
      expect(instrumentation.isInitialized()).toBe(false);
    });

    it("should initialize with both console exporters", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
        logsExporter: "console",
      });

      expect(instrumentation.isInitialized()).toBe(true);
      expect(mocks.mockMeterProvider).toHaveBeenCalledTimes(1);
      expect(mocks.mockConsoleMetricExporter).toHaveBeenCalledTimes(1);
      expect(mocks.mockLoggerProvider).toHaveBeenCalledTimes(1);
      expect(mocks.mockConsoleLogRecordExporter).toHaveBeenCalledTimes(1);
    });

    it("should create the metric instruments on the meter", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });

      expect(mocks.mockGetMeter).toHaveBeenCalledWith("wave");
      expect(createdCounterNames(mocks.mockCreateCounter)).toEqual(
        COUNTER_NAMES,
      );
      expect(mocks.mockCreateHistogram).toHaveBeenCalledWith(
        "wave.api.duration",
        { description: "LLM API request duration", unit: "ms" },
      );
    });

    it("should not create instruments when only logs are exported", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        logsExporter: "console",
      });

      // Metrics are off: no meter, so every record call stays a no-op.
      expect(mocks.mockMeterProvider).not.toHaveBeenCalled();
      expect(mocks.mockCreateCounter).not.toHaveBeenCalled();
    });
  });

  describe("shutdownTelemetry", () => {
    it("should be no-op if not initialized", async () => {
      await instrumentation.shutdownTelemetry();
      expect(mocks.mockMeterShutdown).not.toHaveBeenCalled();
      expect(mocks.mockLoggerShutdown).not.toHaveBeenCalled();
      expect(mocks.mockMetricsDisable).not.toHaveBeenCalled();
    });

    it("should unregister the global providers", async () => {
      // The API refuses to replace an already-registered global provider, so a
      // later initializeTelemetry() would keep delegating to this dead one.
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
        logsExporter: "console",
      });

      await instrumentation.shutdownTelemetry();

      expect(mocks.mockMetricsDisable).toHaveBeenCalledTimes(1);
      expect(mocks.mockLogsDisable).toHaveBeenCalledTimes(1);
    });

    it("should unregister only the providers that were registered", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });

      await instrumentation.shutdownTelemetry();

      expect(mocks.mockMetricsDisable).toHaveBeenCalledTimes(1);
      expect(mocks.mockLogsDisable).not.toHaveBeenCalled();
    });

    it("should call SDK shutdown when initialized", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });
      expect(instrumentation.isInitialized()).toBe(true);

      await instrumentation.shutdownTelemetry();
      expect(mocks.mockMeterShutdown).toHaveBeenCalledTimes(1);
    });

    it("should reset initialized state after shutdown", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });
      await instrumentation.shutdownTelemetry();

      expect(instrumentation.isInitialized()).toBe(false);
    });

    it("should drop the instruments so later records are no-ops", async () => {
      const adds: ReturnType<typeof vi.fn>[] = [];
      mocks.mockCreateCounter.mockImplementation(() => {
        const add = vi.fn();
        adds.push(add);
        return { add };
      });

      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });
      const metrics = await import("@/telemetry/metrics.js");

      metrics.recordSession();
      expect(adds.some((add) => add.mock.calls.length > 0)).toBe(true);

      await instrumentation.shutdownTelemetry();
      for (const add of adds) add.mockClear();

      // The provider is gone: recording must not reach the retired instruments.
      expect(() => metrics.recordSession()).not.toThrow();
      expect(adds.every((add) => add.mock.calls.length === 0)).toBe(true);
    });

    it("should be no-op if called twice", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });
      await instrumentation.shutdownTelemetry();
      await instrumentation.shutdownTelemetry();

      expect(mocks.mockMeterShutdown).toHaveBeenCalledTimes(1);
    });

    it("should handle shutdown failure gracefully", async () => {
      mocks.mockMeterShutdown.mockRejectedValueOnce(
        new Error("Shutdown failed"),
      );

      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });

      // Should not throw despite shutdown failing
      await expect(
        instrumentation.shutdownTelemetry(),
      ).resolves.toBeUndefined();

      // State should still be reset
      expect(instrumentation.isInitialized()).toBe(false);
    });
  });

  describe("flushTelemetry", () => {
    it("should be no-op if not initialized", async () => {
      await instrumentation.flushTelemetry();
      expect(mocks.mockMeterFlush).not.toHaveBeenCalled();
      expect(mocks.mockLoggerFlush).not.toHaveBeenCalled();
    });

    it("should flush both providers without tearing them down", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
        logsExporter: "console",
      });

      await instrumentation.flushTelemetry();

      expect(mocks.mockMeterFlush).toHaveBeenCalledTimes(1);
      expect(mocks.mockLoggerFlush).toHaveBeenCalledTimes(1);
      // Process-scoped: the agent that just finished must not silence the
      // sessions still running in this process.
      expect(mocks.mockMeterShutdown).not.toHaveBeenCalled();
      expect(mocks.mockMetricsDisable).not.toHaveBeenCalled();
      expect(instrumentation.isInitialized()).toBe(true);
    });

    it("should leave telemetry initialized afterwards", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });
      await instrumentation.flushTelemetry();
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });

      // Still the first provider — nothing was rebuilt, nothing was skipped.
      expect(mocks.mockMeterProvider).toHaveBeenCalledTimes(1);
      expect(instrumentation.isInitialized()).toBe(true);
    });
  });

  describe("otel diagnostics", () => {
    it("should route API diagnostics into the wave logger at error level", async () => {
      await instrumentation.initializeTelemetry({ enabled: false });

      const [adapter, level] = mocks.mockDiagSetLogger.mock.calls[0]!;
      expect(level).toBe(0); // DiagLogLevel.ERROR

      const globalLogger = await import("@/utils/globalLogger.js");
      const warn = vi.mocked(globalLogger.logger.warn);
      warn.mockClear();

      (adapter as { error: (message: string) => void }).error(
        "registration refused",
      );

      expect(warn).toHaveBeenCalledWith("[otel] registration refused");
    });
  });

  describe("isInitialized / getCurrentConfig", () => {
    it("isInitialized returns false before init", () => {
      expect(instrumentation.isInitialized()).toBe(false);
    });

    it("getCurrentConfig returns undefined before init", () => {
      expect(instrumentation.getCurrentConfig()).toBeUndefined();
    });

    it("isInitialized returns true after init", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        metricsExporter: "console",
      });
      expect(instrumentation.isInitialized()).toBe(true);
    });

    it("getCurrentConfig returns config after init", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        logsExporter: "console",
        logUserPrompts: true,
      });
      const config = instrumentation.getCurrentConfig();
      expect(config).toBeDefined();
      expect(config?.logsExporter).toBe("console");
      expect(config?.logUserPrompts).toBe(true);
    });
  });

  describe("console exporter stdout protection", () => {
    afterEach(() => {
      instrumentation.setTelemetryStdoutProtected(false);
    });

    it("keeps console exporters by default (interactive hosts)", () => {
      const config = instrumentation.resolveTelemetryConfig({
        metricsExporter: "console",
        logsExporter: "console",
      });
      expect(config.metricsExporter).toBe("console");
      expect(config.logsExporter).toBe("console");
      expect(config.enabled).toBe(true);
    });

    it("strips console exporters on protected stdout (--stdio / --print)", () => {
      instrumentation.setTelemetryStdoutProtected(true);

      const config = instrumentation.resolveTelemetryConfig({
        metricsExporter: "console",
        logsExporter: "console",
      });
      expect(config.metricsExporter).toBeUndefined();
      expect(config.logsExporter).toBeUndefined();
      expect(config.enabled).toBe(false);
    });

    it("strips only console; otlp is unaffected", () => {
      instrumentation.setTelemetryStdoutProtected(true);

      const config = instrumentation.resolveTelemetryConfig({
        metricsExporter: "otlp",
        logsExporter: "console",
        endpoint: "http://localhost:4318",
      });
      expect(config.metricsExporter).toBe("otlp");
      expect(config.logsExporter).toBeUndefined();
    });
  });

  describe("setTelemetryStdoutProtected", () => {
    it("is exported for structured-output CLI entries", () => {
      expect(typeof instrumentation.setTelemetryStdoutProtected).toBe(
        "function",
      );
    });
  });
});
