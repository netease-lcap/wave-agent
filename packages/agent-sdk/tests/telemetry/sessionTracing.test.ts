import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the instrumentation module
const mockIsInitialized = vi.fn();
const mockGetOTELApi = vi.fn();
const mockGetCurrentConfig = vi.fn();

vi.mock("@/telemetry/instrumentation.js", () => ({
  isInitialized: () => mockIsInitialized(),
  getOTELApi: () => mockGetOTELApi(),
  getCurrentConfig: () => mockGetCurrentConfig(),
}));

// Mock the events module (sessionTracing now imports logOTelEvent)
const mockLogOTelEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/telemetry/events.js", () => ({
  logOTelEvent: mockLogOTelEvent,
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

    it("endLLMRequestSpan does nothing without span", () => {
      expect(() =>
        tracing.endLLMRequestSpan(undefined, { model: "gpt-4", success: true }),
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
      tracing.startInteractionSpan("Hello", 1);
      const span = tracing.startLLMRequestSpan("gpt-4o");

      expect(span).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        "llm.request",
        expect.objectContaining({
          attributes: {
            "span.type": "llm_request",
            model: "gpt-4o",
          },
        }),
        expect.any(Object), // context argument for parent
      );
    });

    it("startLLMRequestSpan includes context option", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startLLMRequestSpan("gpt-4", { context: "interaction" });

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        "llm.request",
        expect.objectContaining({
          attributes: {
            "span.type": "llm_request",
            model: "gpt-4",
            "llm_request.context": "interaction",
          },
        }),
        expect.any(Object),
      );
    });

    it("LLM span does not enter ALS — interactionContext unchanged", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startLLMRequestSpan("gpt-4");

      // startToolSpan after LLM span should still parent to interaction span
      tracing.startToolSpan("Bash");

      // 3 spans: interaction, llm.request, tool.Bash
      expect(mockTracer.startSpan).toHaveBeenCalledTimes(3);
      // The tool span call should include a context (parent = interaction)
      const toolCall = mockTracer.startSpan.mock.calls[2];
      expect(toolCall[2]).toBeDefined(); // context arg present
    });

    it("endLLMRequestSpan sets metadata attributes and ends span", () => {
      tracing.startInteractionSpan("Hello", 1);
      const span = tracing.startLLMRequestSpan("gpt-4");

      tracing.endLLMRequestSpan(span, {
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
      const span = tracing.startLLMRequestSpan("gpt-4");

      tracing.endLLMRequestSpan(span, {
        model: "gpt-4",
        success: false,
        error: "Connection timeout",
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "error",
        "Connection timeout",
      );
    });

    it("endLLMRequestSpan with undefined span does nothing", () => {
      expect(() =>
        tracing.endLLMRequestSpan(undefined, {
          model: "gpt-4",
          success: true,
        }),
      ).not.toThrow();
      expect(mockSpan.end).not.toHaveBeenCalled();
    });

    it("endLLMRequestSpan with minimal metadata", () => {
      tracing.startInteractionSpan("Hello", 1);
      const span = tracing.startLLMRequestSpan("gpt-4");

      tracing.endLLMRequestSpan(span, {
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

    it("startToolSpan creates a span with tool name", () => {
      tracing.startInteractionSpan("Hello", 1);
      const span = tracing.startToolSpan("Bash");

      expect(span).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        "tool.Bash",
        expect.objectContaining({
          attributes: {
            "span.type": "tool",
            tool_name: "Bash",
          },
        }),
        expect.any(Object), // context argument for parent
      );
    });

    it("startToolSpan includes input when logToolContent is true", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });
      tracing.startInteractionSpan("Hello", 1);

      tracing.startToolSpan("Write", { path: "/test", content: "hello" });

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        "tool.Write",
        expect.objectContaining({
          attributes: {
            "span.type": "tool",
            tool_name: "Write",
            tool_input: '{"path":"/test","content":"hello"}',
          },
        }),
        expect.any(Object),
      );
    });

    it("startToolSpan excludes input when logToolContent is false", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: false });
      tracing.startInteractionSpan("Hello", 1);

      tracing.startToolSpan("Read", { path: "/test" });

      const callArgs = mockTracer.startSpan.mock.calls[1][1];
      expect(callArgs.attributes).not.toHaveProperty("tool_input");
    });

    it("startToolSpan truncates long input to 60KB", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });
      tracing.startInteractionSpan("Hello", 1);

      const longInput = "a".repeat(70000);
      tracing.startToolSpan("Write", longInput);

      const callArgs = mockTracer.startSpan.mock.calls[1][1];
      const inputAttr = callArgs.attributes["tool_input"] as string;
      expect(inputAttr.length).toBe(60000);
      expect(callArgs.attributes["tool_input_truncated"]).toBe(true);
      expect(callArgs.attributes["tool_input_original_length"]).toBe(70000);
    });

    it("startToolSpan with string input when logToolContent is true", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });
      tracing.startInteractionSpan("Hello", 1);

      tracing.startToolSpan("Write", "simple string input");

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        "tool.Write",
        expect.objectContaining({
          attributes: {
            "span.type": "tool",
            tool_name: "Write",
            tool_input: "simple string input",
          },
        }),
        expect.any(Object),
      );
    });

    it("startToolSpan truncates long string input to 60KB", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });
      tracing.startInteractionSpan("Hello", 1);

      const longInput = "x".repeat(70000);
      tracing.startToolSpan("Write", longInput);

      const callArgs = mockTracer.startSpan.mock.calls[1][1];
      const inputAttr = callArgs.attributes["tool_input"] as string;
      expect(inputAttr.length).toBe(60000);
      expect(inputAttr).toBe("x".repeat(60000));
      expect(callArgs.attributes["tool_input_truncated"]).toBe(true);
    });

    it("startToolSpan excludes input when logToolContent is false even with input provided", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: false });
      tracing.startInteractionSpan("Hello", 1);

      tracing.startToolSpan("Read", "some content");

      const callArgs = mockTracer.startSpan.mock.calls[1][1];
      expect(callArgs.attributes).not.toHaveProperty("tool_input");
    });

    it("endToolSpan sets success/error/duration attributes and ends", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");

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

    it("endToolSpan records tool_output when logToolContent is true", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");

      tracing.endToolSpan({
        success: true,
        durationMs: 100,
        output: "command output here",
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "tool_output",
        "command output here",
      );
    });

    it("endToolSpan excludes tool_output when logToolContent is false", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: false });
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");

      tracing.endToolSpan({
        success: true,
        durationMs: 100,
        output: "command output here",
      });

      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        "tool_output",
        expect.anything(),
      );
    });

    it("endToolSpan truncates tool_output to 60KB", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");

      const longOutput = "y".repeat(70000);
      tracing.endToolSpan({
        success: true,
        durationMs: 100,
        output: longOutput,
      });

      const outputCall = mockSpan.setAttribute.mock.calls.find(
        (c) => c[0] === "tool_output",
      );
      expect(outputCall).toBeDefined();
      expect((outputCall![1] as string).length).toBe(60000);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "tool_output_truncated",
        true,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "tool_output_original_length",
        70000,
      );
    });

    it("endToolSpan does not record tool_output when output is undefined", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");

      tracing.endToolSpan({
        success: true,
        durationMs: 100,
      });

      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        "tool_output",
        expect.anything(),
      );
    });

    it("tool span parent is always interaction span", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");

      // Tool span should have a context arg (parent = interaction)
      const toolCall = mockTracer.startSpan.mock.calls[1];
      expect(toolCall[2]).toBeDefined();
      expect(mockTrace.setSpan).toHaveBeenCalledWith(
        mockContext.active(),
        mockSpan, // The interaction span (mockSpan is returned by startSpan)
      );
    });

    it("tool span clears toolContext after end", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");
      tracing.endToolSpan({ success: true, durationMs: 50 });

      // Calling endToolSpan again should be a no-op (no second end)
      tracing.endToolSpan({ success: true, durationMs: 100 });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it("serial LLM→Tool→LLM: all parents are interaction span", () => {
      tracing.startInteractionSpan("Hello", 1);

      // LLM request 1
      const llm1 = tracing.startLLMRequestSpan("gpt-4");
      tracing.endLLMRequestSpan(llm1!, { model: "gpt-4", success: true });

      // Tool call
      tracing.startToolSpan("Bash");
      tracing.endToolSpan({ success: true, durationMs: 10 });

      // LLM request 2 — parent should still be interaction span
      const llm2 = tracing.startLLMRequestSpan("gpt-4");
      tracing.endLLMRequestSpan(llm2!, { model: "gpt-4", success: true });

      // All child spans (llm.request, tool.Bash, llm.request) should have
      // been created with a parent context
      expect(mockTracer.startSpan).toHaveBeenCalledTimes(4); // 1 interaction + 3 children
      // Each child call should have a context argument (3rd arg)
      for (let i = 1; i < 4; i++) {
        expect(mockTracer.startSpan.mock.calls[i][2]).toBeDefined();
      }

      tracing.endInteractionSpan();
    });

    it("endToolSpan with error attribute", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startToolSpan("Bash");

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

  describe("content capture (logToolContent enabled)", () => {
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
    };

    beforeEach(() => {
      mockIsInitialized.mockReturnValue(true);
      mockGetOTELApi.mockReturnValue({
        trace: mockTrace,
        context: mockContext,
      });
      mockGetCurrentConfig.mockReturnValue({ logToolContent: true });
    });

    it("startLLMRequestSpan captures system prompt hash and preview", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startLLMRequestSpan("gpt-4", {
        systemPrompt: "You are a helpful assistant.",
      });

      const callArgs = mockTracer.startSpan.mock.calls[1][1];
      expect(callArgs.attributes).toHaveProperty("system_prompt_hash");
      expect(callArgs.attributes.system_prompt_hash).toHaveLength(12);
      expect(callArgs.attributes).toHaveProperty("system_prompt_length");
      expect(callArgs.attributes.system_prompt_length).toBe(
        "You are a helpful assistant.".length,
      );
      expect(callArgs.attributes).toHaveProperty("system_prompt_preview");
      expect(callArgs.attributes.system_prompt_preview).toBe(
        "You are a helpful assistant.",
      );
    });

    it("startLLMRequestSpan truncates system prompt preview to 500 chars", () => {
      tracing.startInteractionSpan("Hello", 1);
      const longPrompt = "a".repeat(600);
      tracing.startLLMRequestSpan("gpt-4", {
        systemPrompt: longPrompt,
      });

      const callArgs = mockTracer.startSpan.mock.calls[1][1];
      expect((callArgs.attributes.system_prompt_preview as string).length).toBe(
        500,
      );
      expect(callArgs.attributes.system_prompt_length).toBe(600);
    });

    it("startLLMRequestSpan emits system_prompt event only once per hash", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startLLMRequestSpan("gpt-4", {
        systemPrompt: "Same prompt",
      });
      tracing.endInteractionSpan();

      tracing.startInteractionSpan("Hello again", 2);
      tracing.startLLMRequestSpan("gpt-4", {
        systemPrompt: "Same prompt",
      });

      const systemPromptEvents = mockLogOTelEvent.mock.calls.filter(
        (c: unknown[]) => c[0] === "system_prompt",
      );
      expect(systemPromptEvents).toHaveLength(1);
    });

    it("startLLMRequestSpan captures incremental new_context", () => {
      tracing.startInteractionSpan("Hello", 1);
      const messages1 = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      tracing.startLLMRequestSpan("gpt-4", {
        inputMessages: messages1,
      });

      let callArgs = mockTracer.startSpan.mock.calls[1][1];
      expect(callArgs.attributes).toHaveProperty("new_context");
      expect(callArgs.attributes.new_context_message_count).toBe(2);

      // Second call with additional messages — should only send delta
      tracing.startLLMRequestSpan("gpt-4", {
        inputMessages: [
          ...messages1,
          { role: "user", content: "How are you?" },
        ],
      });

      callArgs = mockTracer.startSpan.mock.calls[2][1];
      const newContext = JSON.parse(callArgs.attributes.new_context as string);
      expect(newContext).toHaveLength(1);
      expect(newContext[0].content).toBe("How are you?");
      expect(callArgs.attributes.new_context_message_count).toBe(1);
    });

    it("startLLMRequestSpan captures tools schema with hashes", () => {
      tracing.startInteractionSpan("Hello", 1);
      const tools = [
        {
          type: "function",
          function: {
            name: "Bash",
            description: "Run a command",
            parameters: { type: "object", properties: {} },
          },
        },
        {
          type: "function",
          function: {
            name: "Read",
            description: "Read a file",
            parameters: { type: "object", properties: {} },
          },
        },
      ];
      tracing.startLLMRequestSpan("gpt-4", {
        toolsSchema: JSON.stringify(tools),
      });

      const callArgs = mockTracer.startSpan.mock.calls[1][1];
      expect(callArgs.attributes).toHaveProperty("tools");
      expect(callArgs.attributes.tools_count).toBe(2);
      const toolsAttr = JSON.parse(callArgs.attributes.tools as string);
      expect(toolsAttr[0]).toHaveProperty("name", "Bash");
      expect(toolsAttr[0]).toHaveProperty("hash");
      expect(toolsAttr[0].hash).toHaveLength(12);
    });

    it("startLLMRequestSpan emits tool_schema event only once per hash", () => {
      tracing.startInteractionSpan("Hello", 1);
      const tools = [
        {
          type: "function",
          function: {
            name: "Bash",
            description: "Run a command",
            parameters: { type: "object", properties: {} },
          },
        },
      ];
      const toolsSchema = JSON.stringify(tools);
      tracing.startLLMRequestSpan("gpt-4", { toolsSchema });
      tracing.endInteractionSpan();

      tracing.startInteractionSpan("Hello again", 2);
      tracing.startLLMRequestSpan("gpt-4", { toolsSchema });

      const toolSchemaEvents = mockLogOTelEvent.mock.calls.filter(
        (c: unknown[]) => c[0] === "tool_schema",
      );
      expect(toolSchemaEvents).toHaveLength(1);
    });

    it("endLLMRequestSpan captures model_output", () => {
      tracing.startInteractionSpan("Hello", 1);
      const span = tracing.startLLMRequestSpan("gpt-4");

      tracing.endLLMRequestSpan(span, {
        model: "gpt-4",
        success: true,
        modelOutput: "This is the model response.",
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "response.model_output",
        "This is the model response.",
      );
    });

    it("endLLMRequestSpan truncates model_output to 60KB", () => {
      tracing.startInteractionSpan("Hello", 1);
      const span = tracing.startLLMRequestSpan("gpt-4");

      const longOutput = "z".repeat(70000);
      tracing.endLLMRequestSpan(span, {
        model: "gpt-4",
        success: true,
        modelOutput: longOutput,
      });

      const outputCall = mockSpan.setAttribute.mock.calls.find(
        (c) => c[0] === "response.model_output",
      );
      expect(outputCall).toBeDefined();
      expect((outputCall![1] as string).length).toBe(60000);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "response.model_output_truncated",
        true,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "response.model_output_original_length",
        70000,
      );
    });

    it("content capture gated by OTEL_LOG_TOOL_CONTENT (disabled)", () => {
      mockGetCurrentConfig.mockReturnValue({ logToolContent: false });
      tracing.startInteractionSpan("Hello", 1);

      tracing.startLLMRequestSpan("gpt-4", {
        systemPrompt: "You are a helpful assistant.",
        inputMessages: [{ role: "user", content: "Hello" }],
        toolsSchema: JSON.stringify([
          { type: "function", function: { name: "Bash" } },
        ]),
      });

      const callArgs = mockTracer.startSpan.mock.calls[1][1];
      expect(callArgs.attributes).not.toHaveProperty("system_prompt_hash");
      expect(callArgs.attributes).not.toHaveProperty("new_context");
      expect(callArgs.attributes).not.toHaveProperty("tools");
      expect(callArgs.attributes).not.toHaveProperty("tools_count");
    });

    it("resetTracingState clears incremental message tracking", () => {
      tracing.startInteractionSpan("Hello", 1);
      tracing.startLLMRequestSpan("gpt-4", {
        inputMessages: [
          { role: "user", content: "Message 1" },
          { role: "assistant", content: "Response 1" },
        ],
      });

      // Reset state (simulating compaction)
      tracing.resetTracingState();

      // After reset, all messages should be treated as new
      tracing.startLLMRequestSpan("gpt-4", {
        inputMessages: [
          { role: "user", content: "Message 1" },
          { role: "assistant", content: "Response 1" },
        ],
      });

      const callArgs = mockTracer.startSpan.mock.calls[2][1];
      expect(callArgs.attributes.new_context_message_count).toBe(2);
    });
  });
});
