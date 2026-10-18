import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Meter } from "@opentelemetry/api";

/**
 * The standard attribute surface is stubbed: this file is about which
 * attributes a data point gets, not about how the identity is resolved
 * (`tests/telemetry/telemetryAttributes.test.ts` covers that).
 */
const { standardAttributes } = vi.hoisted(() => ({
  standardAttributes: vi.fn(),
}));

vi.mock("@/telemetry/attributes.js", () => ({ standardAttributes }));

type AddSpy = ReturnType<typeof vi.fn>;

interface FakeInstrument {
  add: AddSpy;
}

/** A meter whose instruments are spies, keyed by metric name. */
function fakeMeter() {
  const instruments = new Map<string, FakeInstrument>();
  const make = (): FakeInstrument => ({ add: vi.fn() });

  const createCounter = vi.fn((name: string) => {
    const instrument = make();
    instruments.set(name, instrument);
    return instrument;
  });

  return {
    meter: { createCounter } as unknown as Meter,
    instruments,
    counter: (name: string) => instruments.get(name)!,
    createCounter,
  };
}

describe("metrics", () => {
  let metrics: typeof import("@/telemetry/metrics.js");
  let fake: ReturnType<typeof fakeMeter>;

  beforeEach(async () => {
    vi.resetModules();
    standardAttributes.mockReset();
    standardAttributes.mockReturnValue({});
    metrics = await import("@/telemetry/metrics.js");
    fake = fakeMeter();
    metrics.initMetrics(fake.meter);
  });

  describe("initMetrics", () => {
    it("should create the documented metric families with their units", () => {
      expect(fake.createCounter.mock.calls).toEqual([
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
        [
          "wave.active_time",
          {
            description:
              "Active time, by type: the user at the prompt, or the agent working",
            unit: "s",
          },
        ],
        [
          "wave.code_edit_tool.decision",
          {
            description:
              "Permission decisions on Edit and Write, accepted or rejected, by source",
          },
        ],
      ]);
    });
  });

  describe("recordTokenUsage", () => {
    it("should report every token kind that came back", () => {
      metrics.recordTokenUsage({
        model: "gemini-3-flash",
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
      metrics.recordTokenUsage({
        model: "gemini-3-flash",
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

      expect(fake.counter("wave.sessions").add).toHaveBeenCalledWith(1, {});
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

      expect(fake.counter("wave.commits").add).toHaveBeenCalledWith(1, {});
      expect(fake.counter("wave.pull_requests").add).not.toHaveBeenCalled();
    });

    it("should count a created pull request", () => {
      metrics.recordToolActivity({ commits: false, pullRequests: true });

      expect(fake.counter("wave.pull_requests").add).toHaveBeenCalledWith(
        1,
        {},
      );
      expect(fake.counter("wave.commits").add).not.toHaveBeenCalled();
    });

    it("should stay silent for a call that created neither", () => {
      metrics.recordToolActivity({ commits: false, pullRequests: false });

      expect(fake.counter("wave.commits").add).not.toHaveBeenCalled();
      expect(fake.counter("wave.pull_requests").add).not.toHaveBeenCalled();
    });
  });

  describe("recordActiveTime", () => {
    it("should add the segment length under the active-time half", () => {
      metrics.recordActiveTime(12.5, "cli");
      metrics.recordActiveTime(2, "user");

      expect(fake.counter("wave.active_time").add.mock.calls).toEqual([
        [12.5, { type: "cli" }],
        [2, { type: "user" }],
      ]);
    });

    it("should skip empty and negative segments", () => {
      metrics.recordActiveTime(0, "cli");
      metrics.recordActiveTime(-1, "cli");

      expect(fake.counter("wave.active_time").add).not.toHaveBeenCalled();
    });
  });

  describe("recordCodeEditDecision", () => {
    it("should count an accepted edit with its source, tool and language", () => {
      metrics.recordCodeEditDecision({
        decision: "accept",
        source: "user_temporary",
        toolName: "Edit",
        language: "typescript",
      });

      expect(
        fake.counter("wave.code_edit_tool.decision").add,
      ).toHaveBeenCalledWith(1, {
        decision: "accept",
        source: "user_temporary",
        tool_name: "Edit",
        language: "typescript",
      });
    });

    it("should count a rejection the same way, without a language it cannot name", () => {
      metrics.recordCodeEditDecision({
        decision: "reject",
        source: "user_reject",
        toolName: "Write",
      });

      expect(
        fake.counter("wave.code_edit_tool.decision").add,
      ).toHaveBeenCalledWith(1, {
        decision: "reject",
        source: "user_reject",
        tool_name: "Write",
      });
    });

    it("should ignore tools that do not edit code", () => {
      for (const toolName of ["Bash", "Read", "mcp__github__create_issue"]) {
        metrics.recordCodeEditDecision({
          decision: "accept",
          source: "config",
          toolName,
        });
      }

      expect(
        fake.counter("wave.code_edit_tool.decision").add,
      ).not.toHaveBeenCalled();
    });
  });

  describe("standard attributes", () => {
    /** Re-init the module with a policy, the way initializeTelemetry does. */
    function initWithPolicy(
      policy: Partial<
        Parameters<typeof metrics.initMetrics>[1] & Record<string, unknown>
      >,
    ) {
      metrics.initMetrics(fake.meter, {
        includeSessionId: false,
        includeRepository: false,
        includeEntrypoint: false,
        resourceAttributes: {},
        ...policy,
      } as Parameters<typeof metrics.initMetrics>[1]);
    }

    it("should leave session.id off when the switch is off", () => {
      initWithPolicy({ includeSessionId: false });

      metrics.recordSession({ sessionId: "session-1", workdir: "/repo" });

      expect(standardAttributes).toHaveBeenCalledWith({
        sessionId: undefined,
        workdir: "/repo",
        includeRepository: false,
        entrypoint: undefined,
      });
    });

    it("should put session.id on every data point when the switch is on", () => {
      standardAttributes.mockReturnValue({ "session.id": "session-1" });
      initWithPolicy({ includeSessionId: true });

      metrics.recordTokenUsage(
        { model: "gemini-3-flash", inputTokens: 12 },
        { sessionId: "session-1", workdir: "/repo" },
      );
      metrics.recordSession({ sessionId: "session-1", workdir: "/repo" });

      expect(standardAttributes).toHaveBeenCalledWith({
        sessionId: "session-1",
        workdir: "/repo",
        includeRepository: false,
        entrypoint: undefined,
      });
      expect(fake.counter("wave.tokens").add).toHaveBeenCalledWith(12, {
        "session.id": "session-1",
        model: "gemini-3-flash",
        type: "input",
      });
      expect(fake.counter("wave.sessions").add).toHaveBeenCalledWith(1, {
        "session.id": "session-1",
      });
    });

    it("should put the declared entrypoint on data points when the switch is on", () => {
      standardAttributes.mockReturnValue({ "app.entrypoint": "desktop" });
      initWithPolicy({ includeEntrypoint: true });

      metrics.recordSession({ sessionId: "s-1", entrypoint: "desktop" });

      // The context reaches the shared builder only when the switch is on —
      // events get the entrypoint from their own context either way.
      expect(standardAttributes).toHaveBeenCalledWith({
        sessionId: undefined,
        workdir: undefined,
        includeRepository: false,
        entrypoint: "desktop",
      });
      expect(fake.counter("wave.sessions").add).toHaveBeenCalledWith(1, {
        "app.entrypoint": "desktop",
      });
    });

    it("should drop the entrypoint when the switch is off", () => {
      initWithPolicy({ includeEntrypoint: false });

      metrics.recordSession({ sessionId: "s-1", entrypoint: "desktop" });

      expect(standardAttributes).toHaveBeenCalledWith({
        sessionId: undefined,
        workdir: undefined,
        includeRepository: false,
        entrypoint: undefined,
      });
    });

    it("should project the deployment's resource attributes onto data points", () => {
      initWithPolicy({
        resourceAttributes: { "department.name": "infra" },
      });

      metrics.recordLinesChanged({ added: 3 });

      // Projected even though the collector may not turn resource attributes
      // into series labels — that is what the projection is for.
      expect(fake.counter("wave.lines.changed").add).toHaveBeenCalledWith(3, {
        "department.name": "infra",
        direction: "added",
      });
    });

    it("should let a data point's own attributes win over the projected ones", () => {
      initWithPolicy({
        resourceAttributes: { direction: "projected", team: "infra" },
      });

      metrics.recordLinesChanged({ removed: 1 });

      expect(fake.counter("wave.lines.changed").add).toHaveBeenCalledWith(1, {
        team: "infra",
        direction: "removed",
      });
    });

    it("should resolve no attributes at all once the instruments are retired", () => {
      initWithPolicy({ includeSessionId: true });
      metrics.resetMetrics();
      standardAttributes.mockClear();

      metrics.recordSession({ sessionId: "session-1", workdir: "/repo" });

      // Nothing will read them, so telemetry that is off pays for no lookup.
      expect(standardAttributes).not.toHaveBeenCalled();
      expect(fake.counter("wave.sessions").add).not.toHaveBeenCalled();
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
        fresh.recordTokenUsage({ model: "m", outputTokens: 1 });
        fresh.recordSession();
        fresh.recordLinesChanged({ added: 1 });
        fresh.recordToolActivity({ commits: true, pullRequests: true });
        fresh.recordActiveTime(1, "cli");
        fresh.recordCodeEditDecision({
          decision: "accept",
          source: "config",
          toolName: "Edit",
        });
      }).not.toThrow();
    });
  });
});
