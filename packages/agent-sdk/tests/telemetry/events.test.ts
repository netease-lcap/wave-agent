import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the instrumentation module
const mockIsInitialized = vi.fn();
const mockGetCurrentConfig = vi.fn();
const mockGetTelemetryAttributes = vi.fn().mockReturnValue({});
const mockLogEmit = vi.fn();
// Identity of the registered logger provider — `events.ts` re-resolves the
// logger when it changes, because the retired provider's logger keeps dropping.
const mockLoggerProvider: { current: unknown } = { current: {} };

vi.mock("@/telemetry/instrumentation.js", () => ({
  isInitialized: () => mockIsInitialized(),
  getCurrentConfig: () => mockGetCurrentConfig(),
  getTelemetryAttributes: () => mockGetTelemetryAttributes(),
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
    mockGetTelemetryAttributes.mockReturnValue({});
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
      getTelemetryAttributes: () => ({}),
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
