import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";

// Mock globalLogger to suppress output
vi.mock("@/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function setupMocks() {
  const mockStart = vi.fn().mockResolvedValue(undefined);
  const mockShutdown = vi.fn().mockResolvedValue(undefined);
  const mockNodeSDK = vi.fn().mockImplementation(function () {
    return { start: mockStart, shutdown: mockShutdown };
  });

  const mockOTLPTraceExporter = vi.fn();
  const mockOTLPLogExporter = vi.fn();

  const mockTracer = { startSpan: vi.fn() };
  const mockTrace = {
    getTracer: vi.fn().mockReturnValue(mockTracer),
    setSpan: vi.fn(),
  };
  const mockContext = { active: vi.fn().mockReturnValue({}) };

  const mockResource = {
    defaultResource: vi.fn().mockReturnValue({
      merge: vi.fn().mockReturnValue({}),
    }),
    resourceFromAttributes: vi.fn().mockReturnValue({}),
  };

  const mockBatchLogRecordProcessor = vi.fn();

  vi.doMock("@opentelemetry/sdk-node", () => ({
    NodeSDK: mockNodeSDK,
    resources: mockResource,
  }));

  vi.doMock("@opentelemetry/api", () => ({
    trace: mockTrace,
    context: mockContext,
  }));

  vi.doMock("@opentelemetry/sdk-trace-node", () => ({}));

  vi.doMock("@opentelemetry/sdk-logs", () => ({
    BatchLogRecordProcessor: mockBatchLogRecordProcessor,
  }));

  vi.doMock("@opentelemetry/exporter-trace-otlp-http", () => ({
    OTLPTraceExporter: mockOTLPTraceExporter,
  }));

  vi.doMock("@opentelemetry/exporter-logs-otlp-http", () => ({
    OTLPLogExporter: mockOTLPLogExporter,
  }));

  return {
    mockNodeSDK,
    mockStart,
    mockShutdown,
    mockResource,
    mockBatchLogRecordProcessor,
  };
}

describe("instrumentation", () => {
  let instrumentation: typeof import("@/telemetry/instrumentation.js");
  let mocks: ReturnType<typeof setupMocks>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    // Strip OTEL env vars to prevent local shell config from poisoning tests
    delete process.env.OTEL_METRICS_EXPORTER;
    delete process.env.OTEL_TRACES_EXPORTER;
    delete process.env.OTEL_LOGS_EXPORTER;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_LOG_USER_PROMPTS;
    delete process.env.OTEL_LOG_TOOL_CONTENT;
    delete process.env.OTEL_SPAN_TTL_MS;
    delete process.env.OTEL_SHUTDOWN_TIMEOUT_MS;
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
      expect(config.logUserPrompts).toBe(false);
      expect(config.logToolContent).toBe(false);
      expect(config.shutdownTimeoutMs).toBe(2000);
      expect(config.spanTtlMs).toBe(1800000);
    });

    it("should read from settings config", () => {
      const config = instrumentation.resolveTelemetryConfig({
        enabled: true,
        tracesExporter: "jsonl",
        logsExporter: "otlp",
        endpoint: "http://localhost:4318",
        logUserPrompts: true,
        spanTtlMs: 60000,
      });
      expect(config.enabled).toBe(true);
      expect(config.tracesExporter).toBe("jsonl");
      expect(config.logsExporter).toBe("otlp");
      expect(config.endpoint).toBe("http://localhost:4318");
      expect(config.logUserPrompts).toBe(true);
      expect(config.spanTtlMs).toBe(60000);
    });

    it("should let env vars take precedence over settings config", () => {
      const originalEnv = { ...process.env };

      process.env.OTEL_TRACES_EXPORTER = "otlp";
      process.env.OTEL_ENABLED = "false";
      process.env.OTEL_LOG_USER_PROMPTS = "true";
      process.env.OTEL_SPAN_TTL_MS = "90000";

      const config = instrumentation.resolveTelemetryConfig({
        enabled: true,
        tracesExporter: "jsonl",
        logUserPrompts: false,
        spanTtlMs: 30000,
      });

      expect(config.enabled).toBe(false);
      expect(config.tracesExporter).toBe("otlp");
      expect(config.logUserPrompts).toBe(true);
      expect(config.spanTtlMs).toBe(90000);

      process.env = originalEnv;
    });

    it("should parse OTEL_EXPORTER_OTLP_HEADERS env var", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_EXPORTER_OTLP_HEADERS = "api-key=abc123,org-id=xyz";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.headers).toEqual({ "api-key": "abc123", "org-id": "xyz" });

      process.env = originalEnv;
    });

    it("should parse OTEL_EXPORTER_OTLP_PROTOCOL env var", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/json";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.protocol).toBe("http/json");

      process.env = originalEnv;
    });

    it("should handle OTEL_ENABLED=false from env", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_ENABLED = "false";

      const config = instrumentation.resolveTelemetryConfig({
        enabled: true,
        tracesExporter: "jsonl",
      });
      expect(config.enabled).toBe(false);

      process.env = originalEnv;
    });

    it("should enable telemetry when exporters are configured", () => {
      const config = instrumentation.resolveTelemetryConfig({
        tracesExporter: "jsonl",
      });
      expect(config.enabled).toBe(true);
    });

    it("should warn on unknown exporter env value", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_TRACES_EXPORTER = "unknown_exporter";

      const config = instrumentation.resolveTelemetryConfig({
        tracesExporter: "jsonl",
      });

      // Falls through to config value since unknown is not jsonl/otlp
      expect(config.tracesExporter).toBe("jsonl");

      process.env = originalEnv;
    });

    it("should treat OTEL_TRACES_EXPORTER=none as unset (fall to config)", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_TRACES_EXPORTER = "none";

      const config = instrumentation.resolveTelemetryConfig({
        tracesExporter: "jsonl",
      });

      expect(config.tracesExporter).toBe("jsonl");

      process.env = originalEnv;
    });

    it("should use logs exporter from env var", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_LOGS_EXPORTER = "jsonl";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.logsExporter).toBe("jsonl");

      process.env = originalEnv;
    });

    it("should enable telemetry when only logs exporter configured", () => {
      const config = instrumentation.resolveTelemetryConfig({
        logsExporter: "jsonl",
      });
      expect(config.enabled).toBe(true);
    });

    it("should use endpoint from env var over config", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://env-endpoint:4318";

      const config = instrumentation.resolveTelemetryConfig({
        endpoint: "http://config-endpoint:4318",
      });
      expect(config.endpoint).toBe("http://env-endpoint:4318");

      process.env = originalEnv;
    });

    it("should use protocol from config when env not set", () => {
      const config = instrumentation.resolveTelemetryConfig({
        protocol: "grpc",
      });
      expect(config.protocol).toBe("grpc");
    });

    it("should parse headers with value containing equals sign", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_EXPORTER_OTLP_HEADERS = "auth=base64==,key=value";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.headers).toEqual({
        auth: "base64==",
        key: "value",
      });

      process.env = originalEnv;
    });

    it("should return undefined headers when env has only malformed pairs", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_EXPORTER_OTLP_HEADERS = "=value,noequal";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.headers).toBeUndefined();

      process.env = originalEnv;
    });

    it("should fall back to config headers when env not set", () => {
      const config = instrumentation.resolveTelemetryConfig({
        headers: { "api-key": "from-config" },
      });
      expect(config.headers).toEqual({ "api-key": "from-config" });
    });

    it("should resolve logUserPrompts with env=1", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_LOG_USER_PROMPTS = "1";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.logUserPrompts).toBe(true);

      process.env = originalEnv;
    });

    it("should resolve logUserPrompts with env=true", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_LOG_USER_PROMPTS = "true";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.logUserPrompts).toBe(true);

      process.env = originalEnv;
    });

    it("should resolve logUserPrompts with env=0", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_LOG_USER_PROMPTS = "0";

      const config = instrumentation.resolveTelemetryConfig({
        logUserPrompts: true,
      });
      expect(config.logUserPrompts).toBe(false);

      process.env = originalEnv;
    });

    it("should resolve logUserPrompts with env=false", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_LOG_USER_PROMPTS = "false";

      const config = instrumentation.resolveTelemetryConfig({
        logUserPrompts: true,
      });
      expect(config.logUserPrompts).toBe(false);

      process.env = originalEnv;
    });

    it("should resolve logUserPrompts with invalid env (fall to config)", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_LOG_USER_PROMPTS = "invalid";

      const config = instrumentation.resolveTelemetryConfig({
        logUserPrompts: true,
      });
      expect(config.logUserPrompts).toBe(true);

      process.env = originalEnv;
    });

    it("should resolve logToolContent with env=1", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_LOG_TOOL_CONTENT = "1";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.logToolContent).toBe(true);

      process.env = originalEnv;
    });

    it("should resolve logToolContent with env=0", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_LOG_TOOL_CONTENT = "0";

      const config = instrumentation.resolveTelemetryConfig({
        logToolContent: true,
      });
      expect(config.logToolContent).toBe(false);

      process.env = originalEnv;
    });

    it("should resolve logToolContent with invalid env (fall to config)", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_LOG_TOOL_CONTENT = "invalid";

      const config = instrumentation.resolveTelemetryConfig({
        logToolContent: true,
      });
      expect(config.logToolContent).toBe(true);

      process.env = originalEnv;
    });

    it("should resolve spanTtlMs with valid env", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_SPAN_TTL_MS = "60000";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.spanTtlMs).toBe(60000);

      process.env = originalEnv;
    });

    it("should resolve spanTtlMs with NaN env (fall to config)", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_SPAN_TTL_MS = "not-a-number";

      const config = instrumentation.resolveTelemetryConfig({
        spanTtlMs: 99999,
      });
      expect(config.spanTtlMs).toBe(99999);

      process.env = originalEnv;
    });

    it("should resolve spanTtlMs with negative env (fall to default)", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_SPAN_TTL_MS = "-100";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.spanTtlMs).toBe(1800000);

      process.env = originalEnv;
    });

    it("should resolve spanTtlMs with zero env (fall to default)", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_SPAN_TTL_MS = "0";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.spanTtlMs).toBe(1800000);

      process.env = originalEnv;
    });

    it("should resolve shutdownTimeoutMs with valid env", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_SHUTDOWN_TIMEOUT_MS = "5000";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.shutdownTimeoutMs).toBe(5000);

      process.env = originalEnv;
    });

    it("should resolve shutdownTimeoutMs with NaN env (fall to config)", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_SHUTDOWN_TIMEOUT_MS = "abc";

      const config = instrumentation.resolveTelemetryConfig({
        shutdownTimeoutMs: 9999,
      });
      expect(config.shutdownTimeoutMs).toBe(9999);

      process.env = originalEnv;
    });

    it("should resolve shutdownTimeoutMs with negative env (fall to default)", () => {
      const originalEnv = { ...process.env };
      process.env.OTEL_SHUTDOWN_TIMEOUT_MS = "-1";

      const config = instrumentation.resolveTelemetryConfig();
      expect(config.shutdownTimeoutMs).toBe(2000);

      process.env = originalEnv;
    });
  });

  describe("initializeTelemetry", () => {
    it("should be idempotent — skip on second call", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "jsonl",
      });

      expect(mocks.mockNodeSDK).toHaveBeenCalledTimes(1);
      expect(mocks.mockStart).toHaveBeenCalledTimes(1);

      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "jsonl",
      });

      expect(mocks.mockNodeSDK).toHaveBeenCalledTimes(1);
      expect(mocks.mockStart).toHaveBeenCalledTimes(1);
    });

    it("should set isInitialized to true after successful init", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "jsonl",
      });
      expect(instrumentation.isInitialized()).toBe(true);
    });

    it("should set currentConfig after successful init", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "jsonl",
        endpoint: "http://localhost:4318",
      });
      const config = instrumentation.getCurrentConfig();
      expect(config).toBeDefined();
      expect(config?.tracesExporter).toBe("jsonl");
      expect(config?.endpoint).toBe("http://localhost:4318");
    });

    it("should not initialize when disabled", async () => {
      await instrumentation.initializeTelemetry({ enabled: false });
      expect(instrumentation.isInitialized()).toBe(false);
      expect(mocks.mockNodeSDK).not.toHaveBeenCalled();
    });

    it("should not initialize when no exporters configured", async () => {
      await instrumentation.initializeTelemetry({ enabled: true });
      expect(instrumentation.isInitialized()).toBe(false);
      expect(mocks.mockNodeSDK).not.toHaveBeenCalled();
    });

    it("should gracefully degrade on failure", async () => {
      mocks.mockStart.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        instrumentation.initializeTelemetry({
          enabled: true,
          tracesExporter: "jsonl",
        }),
      ).resolves.toBeUndefined();

      expect(instrumentation.isInitialized()).toBe(false);
    });

    it("should initialize with OTLP traces exporter when endpoint provided", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "otlp",
        endpoint: "http://localhost:4318",
      });

      expect(instrumentation.isInitialized()).toBe(true);
      expect(mocks.mockNodeSDK).toHaveBeenCalledTimes(1);
    });

    it("should initialize with OTLP logs exporter when endpoint provided", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        logsExporter: "otlp",
        endpoint: "http://localhost:4318",
      });

      expect(instrumentation.isInitialized()).toBe(true);
      expect(mocks.mockNodeSDK).toHaveBeenCalledTimes(1);
      expect(mocks.mockBatchLogRecordProcessor).toHaveBeenCalledTimes(1);
    });

    it("should initialize with both OTLP exporters", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "otlp",
        logsExporter: "otlp",
        endpoint: "http://localhost:4318",
      });

      expect(instrumentation.isInitialized()).toBe(true);
      expect(mocks.mockNodeSDK).toHaveBeenCalledTimes(1);
    });

    it("should not initialize OTLP traces without endpoint", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "otlp",
      });

      // OTLP requires endpoint, so no SDK init should happen
      expect(mocks.mockNodeSDK).not.toHaveBeenCalled();
      expect(instrumentation.isInitialized()).toBe(false);
    });

    it("should not initialize OTLP logs without endpoint", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        logsExporter: "otlp",
      });

      expect(mocks.mockNodeSDK).not.toHaveBeenCalled();
      expect(instrumentation.isInitialized()).toBe(false);
    });

    it("should initialize with both JSONL exporters", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "jsonl",
        logsExporter: "jsonl",
      });

      expect(instrumentation.isInitialized()).toBe(true);
      expect(mocks.mockNodeSDK).toHaveBeenCalledTimes(1);
      expect(mocks.mockBatchLogRecordProcessor).toHaveBeenCalledTimes(1);
    });
  });

  describe("shutdownTelemetry", () => {
    it("should be no-op if not initialized", async () => {
      await instrumentation.shutdownTelemetry();
      expect(mocks.mockShutdown).not.toHaveBeenCalled();
    });

    it("should call SDK shutdown when initialized", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "jsonl",
      });
      expect(instrumentation.isInitialized()).toBe(true);

      await instrumentation.shutdownTelemetry();
      expect(mocks.mockShutdown).toHaveBeenCalledTimes(1);
    });

    it("should reset initialized state after shutdown", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "jsonl",
      });
      await instrumentation.shutdownTelemetry();

      expect(instrumentation.isInitialized()).toBe(false);
    });

    it("should be no-op if called twice", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "jsonl",
      });
      await instrumentation.shutdownTelemetry();
      await instrumentation.shutdownTelemetry();

      expect(mocks.mockShutdown).toHaveBeenCalledTimes(1);
    });

    it("should handle shutdown failure gracefully", async () => {
      mocks.mockShutdown.mockRejectedValueOnce(new Error("Shutdown failed"));

      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "jsonl",
      });

      // Should not throw despite shutdown failing
      await expect(
        instrumentation.shutdownTelemetry(),
      ).resolves.toBeUndefined();

      // State should still be reset
      expect(instrumentation.isInitialized()).toBe(false);
    });
  });

  describe("isInitialized / getCurrentConfig / getOTELApi", () => {
    it("isInitialized returns false before init", () => {
      expect(instrumentation.isInitialized()).toBe(false);
    });

    it("getCurrentConfig returns undefined before init", () => {
      expect(instrumentation.getCurrentConfig()).toBeUndefined();
    });

    it("getOTELApi returns undefined before init", () => {
      expect(instrumentation.getOTELApi()).toBeUndefined();
    });

    it("isInitialized returns true after init", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        tracesExporter: "jsonl",
      });
      expect(instrumentation.isInitialized()).toBe(true);
    });

    it("getCurrentConfig returns config after init", async () => {
      await instrumentation.initializeTelemetry({
        enabled: true,
        logsExporter: "jsonl",
        logUserPrompts: true,
      });
      const config = instrumentation.getCurrentConfig();
      expect(config).toBeDefined();
      expect(config?.logsExporter).toBe("jsonl");
      expect(config?.logUserPrompts).toBe(true);
    });
  });

  describe("JSONL exporters", () => {
    it("JsonlSpanExporter should export span data", async () => {
      const { JsonlSpanExporter } = instrumentation;
      const exporter = new JsonlSpanExporter("/tmp/test-spans.jsonl");

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "abc123", spanId: "def456" }),
        parentSpanId: undefined,
        startTime: [1, 0],
        endTime: [2, 0],
        status: { code: 0 },
        attributes: { key: "value" },
      };

      const callback = vi.fn();
      exporter.export([mockSpan as unknown as ReadableSpan], callback);

      expect(callback).toHaveBeenCalledWith({ code: 0 });
    });

    it("JsonlLogExporter should export log data", async () => {
      const { JsonlLogExporter } = instrumentation;
      const exporter = new JsonlLogExporter("/tmp/test-logs.jsonl");

      const mockLog = {
        severityNumber: 9,
        body: "compaction",
        hrTime: [1, 0],
        attributes: { "event.name": "compaction" },
      };

      const callback = vi.fn();
      exporter.export([mockLog as unknown as ReadableLogRecord], callback);

      expect(callback).toHaveBeenCalledWith({ code: 0 });
    });

    it("JsonlSpanExporter shutdown resolves", async () => {
      const { JsonlSpanExporter } = instrumentation;
      const exporter = new JsonlSpanExporter();
      await expect(exporter.shutdown()).resolves.toBeUndefined();
    });

    it("JsonlLogExporter forceFlush resolves", async () => {
      const { JsonlLogExporter } = instrumentation;
      const exporter = new JsonlLogExporter();
      await expect(exporter.forceFlush()).resolves.toBeUndefined();
    });
  });
});
