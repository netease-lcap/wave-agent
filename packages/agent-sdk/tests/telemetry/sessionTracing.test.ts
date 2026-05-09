import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Span } from "@opentelemetry/api";

// Mock the instrumentation module
const mockIsInitialized = vi.fn();
const mockGetOTELApi = vi.fn();
const mockGetCurrentConfig = vi.fn();

vi.mock("@/telemetry/instrumentation.js", () => ({
  isInitialized: () => mockIsInitialized(),
  getOTELApi: () => mockGetOTELApi(),
  getCurrentConfig: () => mockGetCurrentConfig(),
}));

describe("sessionTracing", () => {
  let tracing: typeof import("@/telemetry/sessionTracing.js");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    mockIsInitialized.mockReturnValue(false);
    mockGetOTELApi.mockReturnValue(undefined);
    mockGetCurrentConfig.mockReturnValue(undefined);

    tracing = await import("@/telemetry/sessionTracing.js");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when telemetry not initialized", () => {
    it("startInteractionSpan returns undefined", () => {
      const result = tracing.startInteractionSpan("hello", 1);
      expect(result).toBeUndefined();
    });

    it("endInteractionSpan does nothing", () => {
      expect(() => tracing.endInteractionSpan()).not.toThrow();
    });

    it("startLLMRequestSpan returns undefined", () => {
      const result = tracing.startLLMRequestSpan("gpt-4");
      expect(result).toBeUndefined();
    });

    it("endLLMRequestSpan does nothing", () => {
      expect(() =>
        tracing.endLLMRequestSpan({ model: "gpt-4", success: true }),
      ).not.toThrow();
    });

    it("startToolSpan returns undefined", () => {
      const result = tracing.startToolSpan("Bash");
      expect(result).toBeUndefined();
    });

    it("endToolSpan does nothing", () => {
      expect(() =>
        tracing.endToolSpan({ success: true, durationMs: 100 }),
      ).not.toThrow();
    });

    it("getActiveInteractionSpan returns undefined", () => {
      const result = tracing.getActiveInteractionSpan();
      expect(result).toBeUndefined();
    });

    it("withSpanContext executes the function", () => {
      let executed = false;
      // withSpanContext needs a span object — we can't easily mock a Span,
      // but we can verify it calls the function when given a mock span
      const mockSpan = {
        spanContext: () => ({ spanId: "abc" }),
      } as unknown as Span;
      tracing.withSpanContext(mockSpan, () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });
  });

  describe("when telemetry is initialized", () => {
    const mockSpan = {
      spanContext: () => ({ traceId: "trace123", spanId: "span456" }),
      attributes: {},
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };

    const mockTrace = {
      getTracer: vi.fn().mockReturnValue(mockTracer),
      setSpan: vi.fn().mockReturnValue({}),
    };

    const mockContext = {
      active: vi.fn().mockReturnValue({}),
      with: vi.fn((_ctx, fn: () => void) => fn()),
    };

    beforeEach(() => {
      mockIsInitialized.mockReturnValue(true);
      mockGetOTELApi.mockReturnValue({
        trace: mockTrace,
        context: mockContext,
      });
    });

    it("startInteractionSpan creates a span with correct attributes", () => {
      const span = tracing.startInteractionSpan("Build the app", 3);

      expect(span).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith("interaction", {
        attributes: {
          "span.type": "interaction",
          user_prompt_length: 13,
          "interaction.sequence": 3,
        },
      });
    });

    it("startInteractionSpan includes prompt when logUserPrompts is true", () => {
      mockGetCurrentConfig.mockReturnValue({ logUserPrompts: true });

      tracing.startInteractionSpan("Secret prompt", 1);

      expect(mockTracer.startSpan).toHaveBeenCalledWith("interaction", {
        attributes: {
          "span.type": "interaction",
          user_prompt_length: 13,
          "interaction.sequence": 1,
          user_prompt: "Secret prompt",
        },
      });
    });

    it("startInteractionSpan excludes prompt when logUserPrompts is false", () => {
      mockGetCurrentConfig.mockReturnValue({ logUserPrompts: false });

      tracing.startInteractionSpan("Hidden prompt", 1);

      const callArgs = mockTracer.startSpan.mock.calls[0][1];
      expect(callArgs.attributes).not.toHaveProperty("user_prompt");
    });

    it("endInteractionSpan ends the current span", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.endInteractionSpan();

      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("endInteractionSpan is safe when no active span", () => {
      // Don't start a span first — no active span
      expect(() => tracing.endInteractionSpan()).not.toThrow();
    });

    it("startLLMRequestSpan creates a span with model attribute", () => {
      const span = tracing.startLLMRequestSpan("gpt-4o");

      expect(span).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith("llm.request", {
        attributes: {
          "span.type": "llm_request",
          model: "gpt-4o",
        },
      });
    });

    it("startLLMRequestSpan includes context option", () => {
      tracing.startLLMRequestSpan("gpt-4", { context: "interaction" });

      expect(mockTracer.startSpan).toHaveBeenCalledWith("llm.request", {
        attributes: {
          "span.type": "llm_request",
          model: "gpt-4",
          "llm_request.context": "interaction",
        },
      });
    });

    it("endLLMRequestSpan sets metadata attributes and ends span", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startLLMRequestSpan("gpt-4");

      tracing.endLLMRequestSpan({
        model: "gpt-4",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 25,
        cacheCreationTokens: 10,
        ttftMs: 200,
        ttltMs: 500,
        success: true,
        hasToolCall: false,
      });

      const setAttr = mockSpan.setAttribute;
      expect(setAttr).toHaveBeenCalledWith("input_tokens", 100);
      expect(setAttr).toHaveBeenCalledWith("output_tokens", 50);
      expect(setAttr).toHaveBeenCalledWith("cache_read_tokens", 25);
      expect(setAttr).toHaveBeenCalledWith("cache_creation_tokens", 10);
      expect(setAttr).toHaveBeenCalledWith("ttft_ms", 200);
      expect(setAttr).toHaveBeenCalledWith("ttlt_ms", 500);
      expect(setAttr).toHaveBeenCalledWith("success", true);
      expect(setAttr).toHaveBeenCalledWith("has_tool_call", false);
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("endLLMRequestSpan handles error attribute", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startLLMRequestSpan("gpt-4");

      tracing.endLLMRequestSpan({
        model: "gpt-4",
        success: false,
        error: "Connection timeout",
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "error",
        "Connection timeout",
      );
    });

    it("startToolSpan creates a span with tool name", () => {
      const span = tracing.startToolSpan("Bash");

      expect(span).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith("tool.Bash", {
        attributes: {
          "span.type": "tool",
          tool_name: "Bash",
        },
      });
    });

    it("startToolSpan includes input when logToolContent is true", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });

      tracing.startToolSpan("Write", { path: "/test", content: "hello" });

      expect(mockTracer.startSpan).toHaveBeenCalledWith("tool.Write", {
        attributes: {
          "span.type": "tool",
          tool_name: "Write",
          tool_input: '{"path":"/test","content":"hello"}',
        },
      });
    });

    it("startToolSpan excludes input when logToolContent is false", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: false });

      tracing.startToolSpan("Read", { path: "/test" });

      const callArgs = mockTracer.startSpan.mock.calls[0][1];
      expect(callArgs.attributes).not.toHaveProperty("tool_input");
    });

    it("startToolSpan truncates long input to 1000 chars", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });

      const longInput = "a".repeat(2000);
      tracing.startToolSpan("Write", longInput);

      const callArgs = mockTracer.startSpan.mock.calls[0][1];
      const inputAttr = callArgs.attributes["tool_input"] as string;
      expect(inputAttr.length).toBe(1000);
    });

    it("endToolSpan sets success/error/duration attributes and ends", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");

      // Need to set span.type on the mock for endToolSpan to process it
      mockSpan.attributes = { "span.type": "tool" };

      tracing.endToolSpan({
        success: true,
        durationMs: 150,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith("success", true);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith("duration_ms", 150);
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("endToolSpan sets error attribute when present", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");
      mockSpan.attributes = { "span.type": "tool" };

      tracing.endToolSpan({
        success: false,
        error: "Command failed",
        durationMs: 200,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "error",
        "Command failed",
      );
    });

    it("endToolSpan returns early if span type is not tool", () => {
      tracing.startInteractionSpan("Hello", 1);
      mockSpan.attributes = { "span.type": "interaction" };

      const setAttrSpy = vi.spyOn(mockSpan, "setAttribute");
      tracing.endToolSpan({
        success: true,
        durationMs: 100,
      });

      expect(setAttrSpy).not.toHaveBeenCalled();
    });

    it("endLLMRequestSpan restores context when multiple LLM spans exist", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startLLMRequestSpan("gpt-4");
      tracing.startLLMRequestSpan("gpt-4o");

      // End the most recent LLM span
      tracing.endLLMRequestSpan({
        model: "gpt-4o",
        success: true,
      });

      // The first LLM span should still be on the stack
      // and the active span should have been restored
      expect(mockSpan.end).toHaveBeenCalledTimes(1);

      // Now end the first LLM span
      tracing.endLLMRequestSpan({
        model: "gpt-4",
        success: true,
      });

      expect(mockSpan.end).toHaveBeenCalledTimes(2);
    });

    it("endToolSpan restores context when multiple tool spans exist", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");
      tracing.startToolSpan("Write");

      // End the most recent tool span
      mockSpan.attributes = { "span.type": "tool" };
      tracing.endToolSpan({
        success: true,
        durationMs: 50,
      });

      expect(mockSpan.end).toHaveBeenCalledTimes(1);

      // End the first tool span
      tracing.endToolSpan({
        success: true,
        durationMs: 100,
      });

      expect(mockSpan.end).toHaveBeenCalledTimes(2);
    });

    it("startToolSpan with string input when logToolContent is true", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });

      tracing.startToolSpan("Write", "simple string input");

      expect(mockTracer.startSpan).toHaveBeenCalledWith("tool.Write", {
        attributes: {
          "span.type": "tool",
          tool_name: "Write",
          tool_input: "simple string input",
        },
      });
    });

    it("startToolSpan truncates long string input to 1000 chars", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });

      const longInput = "x".repeat(2000);
      tracing.startToolSpan("Write", longInput);

      const callArgs = mockTracer.startSpan.mock.calls[0][1];
      const inputAttr = callArgs.attributes["tool_input"] as string;
      expect(inputAttr.length).toBe(1000);
      expect(inputAttr).toBe("x".repeat(1000));
    });

    it("startToolSpan excludes input when logToolContent is false even with input provided", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: false });

      tracing.startToolSpan("Read", "some content");

      const callArgs = mockTracer.startSpan.mock.calls[0][1];
      expect(callArgs.attributes).not.toHaveProperty("tool_input");
    });

    it("endLLMRequestSpan with minimal metadata", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startLLMRequestSpan("gpt-4");

      tracing.endLLMRequestSpan({
        model: "gpt-4",
        success: true,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith("success", true);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        "input_tokens",
        expect.anything(),
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        "error",
        expect.anything(),
      );
    });

    it("endToolSpan with error attribute", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");
      mockSpan.attributes = { "span.type": "tool" };

      tracing.endToolSpan({
        success: false,
        error: "Exit code 1",
        durationMs: 300,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith("success", false);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "error",
        "Exit code 1",
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith("duration_ms", 300);
    });
  });

  describe("withSpanContext", () => {
    beforeEach(() => {
      mockIsInitialized.mockReturnValue(true);
    });

    it("executes fn within the span context and returns result", () => {
      const mockSpan = {
        spanContext: () => ({ spanId: "abc" }),
      } as unknown as Span;
      const result = tracing.withSpanContext(mockSpan, () => "test-value");
      expect(result).toBe("test-value");
    });

    it("executes fn even when it throws", () => {
      const mockSpan = {
        spanContext: () => ({ spanId: "abc" }),
      } as unknown as Span;
      expect(() => {
        tracing.withSpanContext(mockSpan, () => {
          throw new Error("test error");
        });
      }).toThrow("test error");
    });
  });
});
