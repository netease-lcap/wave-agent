import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Meter } from "@opentelemetry/api";

type AddSpy = ReturnType<typeof vi.fn>;
type RecordSpy = ReturnType<typeof vi.fn>;

interface FakeInstrument {
  add: AddSpy;
  record: RecordSpy;
}

/** A meter whose instruments are spies, keyed by metric name. */
function fakeMeter() {
  const instruments = new Map<string, FakeInstrument>();
  const make = (): FakeInstrument => ({ add: vi.fn(), record: vi.fn() });

  const createCounter = vi.fn((name: string) => {
    const instrument = make();
    instruments.set(name, instrument);
    return instrument;
  });
  const createHistogram = vi.fn((name: string) => {
    const instrument = make();
    instruments.set(name, instrument);
    return instrument;
  });

  return {
    meter: { createCounter, createHistogram } as unknown as Meter,
    instruments,
    counter: (name: string) => instruments.get(name)!,
    createCounter,
    createHistogram,
  };
}

describe("metrics", () => {
  let metrics: typeof import("@/telemetry/metrics.js");
  let fake: ReturnType<typeof fakeMeter>;

  beforeEach(async () => {
    vi.resetModules();
    metrics = await import("@/telemetry/metrics.js");
    fake = fakeMeter();
    metrics.initMetrics(fake.meter);
  });

  describe("initMetrics", () => {
    it("should create the documented metric families with their units", () => {
      expect(fake.createCounter.mock.calls).toEqual([
        [
          "wave.api.requests",
          { description: "LLM API requests", unit: "{request}" },
        ],
        [
          "wave.api.errors",
          { description: "Failed LLM API requests", unit: "{request}" },
        ],
        [
          "wave.tokens",
          {
            description: "Tokens consumed, by model and kind",
            unit: "{token}",
          },
        ],
        [
          "wave.sessions",
          { description: "Agent sessions started", unit: "{session}" },
        ],
        [
          "wave.lines.changed",
          {
            description: "Lines added or removed by edit tools",
            unit: "{line}",
          },
        ],
        [
          "wave.commits",
          { description: "Commits created through a tool", unit: "{commit}" },
        ],
        [
          "wave.pull_requests",
          {
            description:
              "Pull requests or merge requests created through a tool",
            unit: "{pull_request}",
          },
        ],
      ]);
      expect(fake.createHistogram.mock.calls).toEqual([
        [
          "wave.api.duration",
          { description: "LLM API request duration", unit: "ms" },
        ],
      ]);
    });
  });

  describe("recordApiRequest", () => {
    it("should count the request and its duration on success", () => {
      metrics.recordApiRequest({
        model: "gemini-3-flash",
        durationMs: 1234,
        success: true,
      });

      expect(fake.counter("wave.api.requests").add).toHaveBeenCalledWith(1, {
        model: "gemini-3-flash",
      });
      expect(fake.counter("wave.api.duration").record).toHaveBeenCalledWith(
        1234,
        { model: "gemini-3-flash" },
      );
      expect(fake.counter("wave.api.errors").add).not.toHaveBeenCalled();
    });

    it("should count a failure as an error as well", () => {
      metrics.recordApiRequest({
        model: "gemini-3-flash",
        durationMs: 500,
        success: false,
      });

      expect(fake.counter("wave.api.requests").add).toHaveBeenCalledTimes(1);
      expect(fake.counter("wave.api.errors").add).toHaveBeenCalledWith(1, {
        model: "gemini-3-flash",
      });
      // A failed request still consumed wall clock.
      expect(fake.counter("wave.api.duration").record).toHaveBeenCalledTimes(1);
    });

    it("should report every token kind that came back", () => {
      metrics.recordApiRequest({
        model: "gemini-3-flash",
        durationMs: 10,
        success: true,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 900,
        cacheCreationTokens: 0,
      });

      expect(fake.counter("wave.tokens").add.mock.calls).toEqual([
        [100, { model: "gemini-3-flash", type: "input" }],
        [20, { model: "gemini-3-flash", type: "output" }],
        [900, { model: "gemini-3-flash", type: "cache_read" }],
        // An explicit zero is a real measurement — it is reported.
        [0, { model: "gemini-3-flash", type: "cache_creation" }],
      ]);
    });

    it("should skip the token kinds the provider did not report", () => {
      metrics.recordApiRequest({
        model: "gemini-3-flash",
        durationMs: 10,
        success: true,
        outputTokens: 20,
      });

      expect(fake.counter("wave.tokens").add.mock.calls).toEqual([
        [20, { model: "gemini-3-flash", type: "output" }],
      ]);
    });
  });

  describe("recordSession", () => {
    it("should count one started session", () => {
      metrics.recordSession();

      expect(fake.counter("wave.sessions").add).toHaveBeenCalledWith(1);
    });
  });

  describe("recordLinesChanged", () => {
    it("should count an insertion under the added direction", () => {
      metrics.recordLinesChanged({ added: 12 });

      expect(fake.counter("wave.lines.changed").add.mock.calls).toEqual([
        [12, { direction: "added" }],
      ]);
    });

    it("should count a deletion under the removed direction", () => {
      metrics.recordLinesChanged({ removed: 3 });

      expect(fake.counter("wave.lines.changed").add.mock.calls).toEqual([
        [3, { direction: "removed" }],
      ]);
    });

    it("should count both sides of a replacement", () => {
      metrics.recordLinesChanged({ added: 4, removed: 2 });

      expect(fake.counter("wave.lines.changed").add.mock.calls).toEqual([
        [4, { direction: "added" }],
        [2, { direction: "removed" }],
      ]);
    });

    it("should skip the zero and undefined sides", () => {
      metrics.recordLinesChanged({ added: 0, removed: undefined });

      expect(fake.counter("wave.lines.changed").add).not.toHaveBeenCalled();
    });
  });

  describe("recordToolActivity", () => {
    it("should count the commit a tool call created", () => {
      metrics.recordToolActivity({ commits: true, pullRequests: false });

      expect(fake.counter("wave.commits").add).toHaveBeenCalledWith(1);
      expect(fake.counter("wave.pull_requests").add).not.toHaveBeenCalled();
    });

    it("should count a created pull request", () => {
      metrics.recordToolActivity({ commits: false, pullRequests: true });

      expect(fake.counter("wave.pull_requests").add).toHaveBeenCalledWith(1);
      expect(fake.counter("wave.commits").add).not.toHaveBeenCalled();
    });

    it("should stay silent for a call that created neither", () => {
      metrics.recordToolActivity({ commits: false, pullRequests: false });

      expect(fake.counter("wave.commits").add).not.toHaveBeenCalled();
      expect(fake.counter("wave.pull_requests").add).not.toHaveBeenCalled();
    });
  });

  describe("resetMetrics", () => {
    it("should stop recording into the retired instruments", () => {
      metrics.recordSession();
      expect(fake.counter("wave.sessions").add).toHaveBeenCalledTimes(1);

      metrics.resetMetrics();
      metrics.recordSession();

      expect(fake.counter("wave.sessions").add).toHaveBeenCalledTimes(1);
    });

    it("should retire the creation counters too", () => {
      metrics.recordToolActivity({ commits: true, pullRequests: true });
      expect(fake.counter("wave.commits").add).toHaveBeenCalledTimes(1);

      metrics.resetMetrics();
      metrics.recordToolActivity({ commits: true, pullRequests: true });

      expect(fake.counter("wave.commits").add).toHaveBeenCalledTimes(1);
      expect(fake.counter("wave.pull_requests").add).toHaveBeenCalledTimes(1);
    });

    it("should record on the fresh instruments after a re-initialization", () => {
      metrics.resetMetrics();
      const restarted = fakeMeter();
      metrics.initMetrics(restarted.meter);

      metrics.recordSession();

      expect(restarted.counter("wave.sessions").add).toHaveBeenCalledTimes(1);
      expect(fake.counter("wave.sessions").add).not.toHaveBeenCalled();
    });
  });

  describe("before init", () => {
    it("should be a silent no-op", async () => {
      vi.resetModules();
      const fresh = await import("@/telemetry/metrics.js");

      expect(() => {
        fresh.recordApiRequest({ model: "m", durationMs: 1, success: false });
        fresh.recordSession();
        fresh.recordLinesChanged({ added: 1 });
        fresh.recordToolActivity({ commits: true, pullRequests: true });
      }).not.toThrow();
    });
  });
});
