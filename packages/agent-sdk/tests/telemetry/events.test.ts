import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the instrumentation module
const mockIsInitialized = vi.fn();
const mockGetCurrentConfig = vi.fn();
const mockStandardAttributes = vi.fn().mockReturnValue({});
const mockLogEmit = vi.fn();
// Identity of the registered logger provider — `events.ts` re-resolves the
// logger when it changes, because the retired provider's logger keeps dropping.
const mockLoggerProvider: { current: unknown } = { current: {} };

vi.mock("@/telemetry/instrumentation.js", () => ({
  isInitialized: () => mockIsInitialized(),
  getCurrentConfig: () => mockGetCurrentConfig(),
}));

// The standard attribute surface is stubbed: this file asserts which attributes
// an event carries, not how identity or the repository are resolved.
vi.mock("@/telemetry/attributes.js", () => ({
  standardAttributes: (...args: unknown[]) => mockStandardAttributes(...args),
}));

vi.mock("@opentelemetry/api-logs", () => ({
  logs: {
    getLoggerProvider: () => mockLoggerProvider.current,
    getLogger: vi.fn().mockReturnValue({ emit: mockLogEmit }),
  },
}));

describe("events", () => {
  let events: typeof import("@/telemetry/events.js");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    mockIsInitialized.mockReturnValue(false);
    mockGetCurrentConfig.mockReturnValue(undefined);
    mockStandardAttributes.mockReturnValue({});
    mockLogEmit.mockReset();

    events = await import("@/telemetry/events.js");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("logOTelEvent", () => {
    it("should be no-op when not initialized", async () => {
      await events.logOTelEvent("session_start", {
        sessionId: "abc123",
        model: "gpt-4",
        workdir: "/test",
      });

      expect(mockLogEmit).not.toHaveBeenCalled();
    });

    it("should re-resolve the logger when the global provider is replaced", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logOTelEvent("session_start", {});
      await events.logOTelEvent("session_start", {});
      const { logs } = await import("@opentelemetry/api-logs");
      expect(vi.mocked(logs.getLogger)).toHaveBeenCalledTimes(1);

      mockLoggerProvider.current = {};

      await events.logOTelEvent("session_start", {});

      expect(vi.mocked(logs.getLogger)).toHaveBeenCalledTimes(2);
      expect(mockLogEmit).toHaveBeenCalledTimes(3);
    });

    it("should emit event with correct attributes when initialized", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logOTelEvent("session_start", {
        sessionId: "abc123",
        model: "gpt-4",
        workdir: "/test",
      });

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "session_start",
        attributes: {
          "event.name": "session_start",
          sessionId: "abc123",
          model: "gpt-4",
          workdir: "/test",
        },
      });
    });

    it("should forward the whole record context to the standard attribute surface", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
        includeRepository: false,
      });

      await events.logOTelEvent(
        "session_start",
        { model: "gpt-4" },
        {
          sessionId: "abc123",
          workdir: "/test",
          entrypoint: "cli",
        },
      );

      // `app.entrypoint` is an event-side attribute like `session.id`: dropping
      // it here is invisible to metrics, which is how it went missing once.
      expect(mockStandardAttributes).toHaveBeenCalledWith(
        expect.objectContaining({ entrypoint: "cli" }),
      );
    });

    it("should strip prompt attribute when logUserPrompts is false", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logOTelEvent("user_prompt", {
        prompt_length: "42",
        prompt: "Build me a website",
      });

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "user_prompt",
        attributes: {
          "event.name": "user_prompt",
          prompt_length: "42",
        },
      });
    });

    it("should include prompt attribute when logUserPrompts is true", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: true,
        logToolContent: false,
      });

      await events.logOTelEvent("user_prompt", {
        prompt_length: "42",
        prompt: "Build me a website",
      });

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "user_prompt",
        attributes: {
          "event.name": "user_prompt",
          prompt_length: "42",
          prompt: "Build me a website",
        },
      });
    });

    it("should skip undefined metadata values", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logOTelEvent("compaction", {
        beforeTokens: "100",
        afterTokens: "1",
        model: "gpt-4",
        extra: undefined,
      });

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "compaction",
        attributes: {
          "event.name": "compaction",
          beforeTokens: "100",
          afterTokens: "1",
          model: "gpt-4",
        },
      });
    });

    it("should include all metadata as attributes", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: true,
        logToolContent: true,
      });

      await events.logOTelEvent("tool_decision", {
        tool_name: "Bash",
        decision: "approved",
        source: "user",
        extra_field: "some_value",
      });

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "tool_decision",
        attributes: {
          "event.name": "tool_decision",
          tool_name: "Bash",
          decision: "approved",
          source: "user",
          extra_field: "some_value",
        },
      });
    });

    it("should handle session_end event", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logOTelEvent("session_end", {
        duration: "120s",
        totalTokens: "5000",
        exitReason: "user_quit",
      });

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "session_end",
        attributes: {
          "event.name": "session_end",
          duration: "120s",
          totalTokens: "5000",
          exitReason: "user_quit",
        },
      });
    });

    it("should handle error event", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logOTelEvent("error", {
        error_type: "TypeError",
        message: "Cannot read property of undefined",
        stack: "Error at line 42",
      });

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "error",
        attributes: {
          "event.name": "error",
          error_type: "TypeError",
          message: "Cannot read property of undefined",
          stack: "Error at line 42",
        },
      });
    });

    it("should handle compaction event", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logOTelEvent("compaction", {
        beforeTokens: "50",
        afterTokens: "1",
        model: "gemini-3-flash",
      });

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "compaction",
        attributes: {
          "event.name": "compaction",
          beforeTokens: "50",
          afterTokens: "1",
          model: "gemini-3-flash",
        },
      });
    });

    it("should handle metadata with only undefined values", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logOTelEvent("tool_decision", {
        tool_name: "Bash",
        decision: undefined,
        source: undefined,
      });

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "tool_decision",
        attributes: {
          "event.name": "tool_decision",
          tool_name: "Bash",
        },
      });
    });

    it("should handle empty metadata object", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logOTelEvent("session_start", {});

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "session_start",
        attributes: {
          "event.name": "session_start",
        },
      });
    });

    it("should attribute every event to the session it belongs to", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
        includeRepository: true,
      });

      await events.logOTelEvent(
        "compaction",
        { model: "gpt-4" },
        { sessionId: "session-1", workdir: "/repo" },
      );

      expect(mockStandardAttributes).toHaveBeenCalledWith({
        sessionId: "session-1",
        workdir: "/repo",
        includeRepository: true,
      });
    });

    it("should merge the standard attributes into the emitted event", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });
      mockStandardAttributes.mockReturnValue({
        "user.id": "u-1",
        "session.id": "session-1",
      });

      await events.logOTelEvent(
        "user_prompt",
        { prompt_length: "12" },
        { sessionId: "session-1" },
      );

      expect(mockLogEmit).toHaveBeenCalledWith({
        body: "user_prompt",
        attributes: {
          "event.name": "user_prompt",
          "user.id": "u-1",
          "session.id": "session-1",
          prompt_length: "12",
        },
      });
    });

    it("should not resolve repository attributes unless the switch is on", async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logOTelEvent("session_end", {}, { sessionId: "session-1" });

      expect(mockStandardAttributes).toHaveBeenCalledWith({
        sessionId: "session-1",
        workdir: undefined,
        includeRepository: undefined,
      });
    });
  });

  describe("logRequestContentEvents", () => {
    beforeEach(() => {
      mockIsInitialized.mockReturnValue(true);
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: true,
      });
    });

    /**
     * `logRequestContentEvents` fires its events without awaiting them, so an
     * assertion right after the call would hold even with the gate or the
     * dedupe removed. Every call below is therefore followed by `settleEmits()`
     * — and by an assertion that *this* call landed — before the next one is
     * made: two emissions started back to back do not both reach the mock (the
     * second one's dynamic import can resolve to the real `api-logs` module and
     * is dropped), which would make any "only one event went out" assertion pass
     * for free. The gate-off case proves the harness sees emissions at all.
     */
    async function settleEmits(): Promise<void> {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    }

    it("should be a no-op when not initialized", async () => {
      mockIsInitialized.mockReturnValue(false);

      await events.logRequestContentEvents({ systemPrompt: "prompt" });

      expect(mockLogEmit).not.toHaveBeenCalled();
    });

    it("should be a no-op when the logToolContent gate is off", async () => {
      // Proof the harness sees emissions at all: with the gate on, the very
      // same call does reach `emit`.
      await events.logRequestContentEvents({ systemPrompt: "prompt" });
      await settleEmits();
      expect(mockLogEmit).toHaveBeenCalledTimes(1);

      mockLogEmit.mockClear();
      mockGetCurrentConfig.mockReturnValue({
        logUserPrompts: false,
        logToolContent: false,
      });

      await events.logRequestContentEvents({ systemPrompt: "another prompt" });
      await settleEmits();

      expect(mockLogEmit).not.toHaveBeenCalled();
    });

    it("should emit the system prompt once per distinct hash", async () => {
      await events.logRequestContentEvents({ systemPrompt: "Same prompt" });
      await settleEmits();

      expect(mockLogEmit).toHaveBeenCalledTimes(1);
      const record = mockLogEmit.mock.calls[0]![0] as {
        body: string;
        attributes: Record<string, string>;
      };
      expect(record.body).toBe("system_prompt");
      expect(record.attributes.system_prompt).toBe("Same prompt");
      expect(record.attributes.system_prompt_hash).toMatch(/^[0-9a-f]{12}$/);

      // The same prompt again — already sent, nothing new goes out.
      await events.logRequestContentEvents({ systemPrompt: "Same prompt" });
      await settleEmits();

      expect(mockLogEmit).toHaveBeenCalledTimes(1);

      // A different prompt is a different variant — it must go out too.
      await events.logRequestContentEvents({ systemPrompt: "Another prompt" });
      await settleEmits();

      expect(mockLogEmit).toHaveBeenCalledTimes(2);
    });

    it("should emit a tool_schema event per tool, deduped by hash", async () => {
      // One tool per call on purpose: `logRequestContentEvents` fires its
      // events without awaiting them, and a whole batch under a mocked
      // `@opentelemetry/api-logs` does not reliably resolve to the mock. The
      // multi-tool batch is covered end to end in `events.content.test.ts`.
      await events.logRequestContentEvents({
        toolsSchema: JSON.stringify([
          { type: "function", function: { name: "Bash", parameters: {} } },
        ]),
      });

      await settleEmits();
      expect(mockLogEmit).toHaveBeenCalledTimes(1);
      const record = mockLogEmit.mock.calls[0]![0] as {
        body: string;
        attributes: Record<string, string>;
      };
      expect(record.body).toBe("tool_schema");
      expect(record.attributes.tool_name).toBe("Bash");
      expect(record.attributes.tool_hash).toMatch(/^[0-9a-f]{12}$/);
      expect(record.attributes.tool_schema).toContain('"Bash"');

      // Same schema again — the hash was already sent, so nothing new goes out.
      await events.logRequestContentEvents({
        toolsSchema: JSON.stringify([
          { type: "function", function: { name: "Bash", parameters: {} } },
        ]),
      });
      await settleEmits();
      expect(mockLogEmit).toHaveBeenCalledTimes(1);
    });

    it("should name a tool without a function name 'unknown'", async () => {
      await events.logRequestContentEvents({
        toolsSchema: JSON.stringify([{ type: "function" }]),
      });

      await settleEmits();
      expect(mockLogEmit).toHaveBeenCalledTimes(1);
      const record = mockLogEmit.mock.calls[0]![0] as {
        attributes: Record<string, string>;
      };
      expect(record.attributes.tool_name).toBe("unknown");
    });

    it("should re-emit after resetContentEventState (compaction)", async () => {
      await events.logRequestContentEvents({ systemPrompt: "Same prompt" });
      await settleEmits();
      expect(mockLogEmit).toHaveBeenCalledTimes(1);

      // After a compaction the same prompt must be reported again — the count
      // it would otherwise be compared against has changed.
      events.resetContentEventState();
      await events.logRequestContentEvents({ systemPrompt: "Same prompt" });
      await settleEmits();

      expect(mockLogEmit).toHaveBeenCalledTimes(2);
    });

    it("should skip a tools schema that is not valid JSON", async () => {
      await events.logRequestContentEvents({ toolsSchema: "not-json" });
      await settleEmits();

      expect(mockLogEmit).not.toHaveBeenCalled();
    });
  });
});

describe("events with logger import failure", () => {
  it("should be no-op when getLogger import fails", async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Mock the api-logs module to throw on import
    vi.doMock("@/telemetry/instrumentation.js", () => ({
      isInitialized: () => true,
      getCurrentConfig: () => ({
        logUserPrompts: false,
        logToolContent: false,
      }),
    }));
    vi.doMock("@/telemetry/attributes.js", () => ({
      standardAttributes: () => ({}),
    }));

    vi.doMock("@opentelemetry/api-logs", () => {
      throw new Error("Module not found");
    });

    const events = await import("@/telemetry/events.js");

    // Should not throw, just silently return
    await expect(
      events.logOTelEvent("session_start", { sessionId: "test" }),
    ).resolves.toBeUndefined();

    vi.restoreAllMocks();
  });
});
