import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryConfig } from "@/types/telemetry.js";

/**
 * Content-level events (`system_prompt` / `tool_schema`) against the REAL logs
 * SDK, with only the OTLP exporter faked: the whole point of these events is
 * that they reach the collector, and a mocked `@opentelemetry/api-logs` cannot
 * show that — `logRequestContentEvents` fires its events without awaiting them,
 * and a batch of concurrent emits does not reliably resolve to a mock module.
 *
 * What these lock: one record per distinct content variant, the hash dedupe
 * across calls, and the post-compaction reset.
 */
const { exported } = vi.hoisted(() => ({
  exported: [] as Array<Record<string, unknown>>,
}));

vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: class {
    export(
      records: Array<{ body?: unknown; attributes?: Record<string, unknown> }>,
      resultCallback: (result: { code: number }) => void,
    ): void {
      for (const record of records) {
        exported.push({ body: record.body, ...record.attributes });
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
  logsExporter: "otlp",
  endpoint: "http://localhost:4318",
  logToolContent: true,
};

const TOOLS = [
  { type: "function", function: { name: "Bash", parameters: {} } },
  { type: "function", function: { name: "Read", parameters: {} } },
  { type: "function", function: { name: "Grep", parameters: {} } },
];

/** Flush the real log provider and return the records that went out. */
async function drain(
  instrumentation: typeof import("@/telemetry/instrumentation.js"),
): Promise<Array<Record<string, unknown>>> {
  exported.length = 0;
  await instrumentation.flushTelemetry();
  return [...exported];
}

/** Keep flushing until `expected` records have arrived in total. */
async function drainUntil(
  instrumentation: typeof import("@/telemetry/instrumentation.js"),
  expected: number,
): Promise<Array<Record<string, unknown>>> {
  const collected: Array<Record<string, unknown>> = [];
  await vi.waitFor(async () => {
    collected.push(...(await drain(instrumentation)));
    expect(collected).toHaveLength(expected);
  });
  return collected;
}

describe("request content events", () => {
  let instrumentation: typeof import("@/telemetry/instrumentation.js");
  let events: typeof import("@/telemetry/events.js");
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    delete process.env.DISABLE_TELEMETRY;
    delete process.env.OTEL_METRICS_EXPORTER;
    delete process.env.OTEL_LOGS_EXPORTER;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_LOG_TOOL_CONTENT;

    exported.length = 0;
    vi.resetModules();
    instrumentation = await import("@/telemetry/instrumentation.js");
    events = await import("@/telemetry/events.js");
    await instrumentation.initializeTelemetry(OTLP_CONFIG);
  });

  afterEach(async () => {
    await instrumentation.shutdownTelemetry();
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should export one tool_schema record per tool", async () => {
    await events.logRequestContentEvents({
      toolsSchema: JSON.stringify(TOOLS),
    });

    const records = await drainUntil(instrumentation, 3);

    expect(records.map((record) => record.tool_name)).toEqual([
      "Bash",
      "Read",
      "Grep",
    ]);
    expect(records.every((record) => record.body === "tool_schema")).toBe(true);
    for (const record of records) {
      expect(record.tool_hash).toMatch(/^[0-9a-f]{12}$/);
      expect(record.tool_schema).toContain(String(record.tool_name));
    }
  });

  it("should not re-send a tool schema whose hash was already reported", async () => {
    await events.logRequestContentEvents({
      toolsSchema: JSON.stringify(TOOLS),
    });
    await drainUntil(instrumentation, 3);

    await events.logRequestContentEvents({
      toolsSchema: JSON.stringify(TOOLS),
    });
    // One event-loop turn: a (wrongly) queued emit would have landed by now.
    await new Promise((resolve) => setImmediate(resolve));

    expect(await drain(instrumentation)).toEqual([]);
  });

  it("should export the system prompt once per distinct hash", async () => {
    await events.logRequestContentEvents({ systemPrompt: "Same prompt" });
    const [first] = await drainUntil(instrumentation, 1);
    expect(first!.system_prompt).toBe("Same prompt");

    await events.logRequestContentEvents({ systemPrompt: "Same prompt" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(await drain(instrumentation)).toEqual([]);

    await events.logRequestContentEvents({ systemPrompt: "A new prompt" });
    const [second] = await drainUntil(instrumentation, 1);
    expect(second!.system_prompt).toBe("A new prompt");
  });

  it("should re-send the same content after the compaction reset", async () => {
    await events.logRequestContentEvents({ systemPrompt: "Same prompt" });
    await drainUntil(instrumentation, 1);

    events.resetContentEventState();
    await events.logRequestContentEvents({ systemPrompt: "Same prompt" });

    const [record] = await drainUntil(instrumentation, 1);
    expect(record!.system_prompt).toBe("Same prompt");
  });

  it("should re-send the same tool schemas after the compaction reset", async () => {
    await events.logRequestContentEvents({
      toolsSchema: JSON.stringify(TOOLS),
    });
    await drainUntil(instrumentation, 3);

    // The reset forgets both families — a tool schema the compaction already
    // reported has to go out again, just like the system prompt.
    events.resetContentEventState();
    await events.logRequestContentEvents({
      toolsSchema: JSON.stringify(TOOLS),
    });

    const records = await drainUntil(instrumentation, 3);
    expect(records.map((record) => record.tool_name)).toEqual([
      "Bash",
      "Read",
      "Grep",
    ]);
  });
});
