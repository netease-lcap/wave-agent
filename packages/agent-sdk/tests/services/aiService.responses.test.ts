import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";

const GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

const mockChatCreate = vi.fn();
const mockResponsesCreate = vi.fn();

vi.mock("@/utils/openaiClient.js", () => ({
  OpenAIClient: vi.fn().mockImplementation(function () {
    return {
      chat: { completions: { create: mockChatCreate } },
      responses: { create: mockResponsesCreate },
    };
  }),
}));

const RESPONSES_API_MODEL: ModelConfig = {
  model: "gpt-6.1-sol",
  fastModel: "gpt-fast",
  capabilities: { apiType: "responses" },
};

const CHAT_MODEL: ModelConfig = {
  model: "claude-sonnet-4-5",
  fastModel: "gpt-fast",
};

function headers(): Headers {
  return new Headers();
}

/** Responses payload with one assistant message of `text`. */
function responsesBody(text: string) {
  return {
    status: "completed",
    incomplete_details: null,
    error: null,
    usage: null,
    output: [
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
  };
}

/**
 * The client returns an awaitable that also carries `withResponse()`: `callAgent`
 * uses the latter for headers, the one-shot text paths just await it.
 */
function nonStreamingResponses(text: string) {
  const data = responsesBody(text);
  const withResponse = vi.fn().mockResolvedValue({
    data,
    response: { headers: headers() },
  });
  return Object.assign(Promise.resolve(data), { withResponse });
}

function streamingResponses(events: unknown[], failWith?: Error) {
  const data = (async function* () {
    for (const event of events) yield event;
    if (failWith) throw failWith;
  })();
  const withResponse = vi.fn().mockResolvedValue({
    data,
    response: { headers: headers() },
  });
  return Object.assign(Promise.resolve(data), { withResponse });
}

function nonStreamingChat(text: string) {
  const data = {
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  };
  const withResponse = vi.fn().mockResolvedValue({
    data,
    response: { headers: headers() },
  });
  return Object.assign(Promise.resolve(data), { withResponse });
}

describe("aiService - Responses API routing", () => {
  let callAgent: typeof import("@/services/aiService.js").callAgent;
  let getCompletion: typeof import("@/services/aiService.js").getCompletion;
  let getNextEdit: typeof import("@/services/aiService.js").getNextEdit;
  let processWebContent: typeof import("@/services/aiService.js").processWebContent;

  beforeEach(async () => {
    mockChatCreate.mockReset();
    mockResponsesCreate.mockReset();
    const aiService = await import("@/services/aiService.js");
    callAgent = aiService.callAgent;
    getCompletion = aiService.getCompletion;
    getNextEdit = aiService.getNextEdit;
    processWebContent = aiService.processWebContent;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("callAgent", () => {
    it('uses the Responses endpoint when the model declares apiType: "responses"', async () => {
      mockResponsesCreate.mockReturnValue(nonStreamingResponses("done"));

      const result = await callAgent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: RESPONSES_API_MODEL,
        messages: [{ role: "user", content: "read a.ts" }],
        workdir: "/work",
        systemPrompt: "You are Wave.",
        tools: [
          {
            type: "function",
            function: {
              name: "Read",
              description: "Read a file",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      });

      expect(mockChatCreate).not.toHaveBeenCalled();
      const body = mockResponsesCreate.mock.calls[0][0];
      expect(body.stream).toBe(false);
      expect(body.instructions).toBe("You are Wave.");
      expect(body.input).toEqual([{ role: "user", content: "read a.ts" }]);
      // Flat tool declarations, no `function` wrapper.
      expect(body.tools).toEqual([
        {
          type: "function",
          name: "Read",
          description: "Read a file",
          parameters: { type: "object", properties: {} },
          strict: null,
        },
      ]);
      expect(result.content).toBe("done");
      expect(result.finish_reason).toBe("stop");
    });

    it("does not emit cache_control markers when prompt caching is also declared", async () => {
      mockResponsesCreate.mockReturnValue(nonStreamingResponses("ok"));

      await callAgent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: {
          model: "gpt-6.1-sol",
          fastModel: "gpt-fast",
          capabilities: { apiType: "responses", promptCaching: true },
        },
        messages: [{ role: "user", content: "hi" }],
        workdir: "/work",
        systemPrompt: [
          { text: "static part", cacheable: true },
          { text: "dynamic part", cacheable: false },
        ],
      });

      const body = mockResponsesCreate.mock.calls[0][0];
      expect(body.instructions).toBe("static part\n\ndynamic part");
      expect(JSON.stringify(body.input)).not.toContain("cache_control");
    });

    it("keeps Chat Completions when the model does not declare apiType", async () => {
      mockChatCreate.mockReturnValue(nonStreamingChat("hello"));

      const result = await callAgent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: CHAT_MODEL,
        messages: [{ role: "user", content: "hi" }],
        workdir: "/work",
        systemPrompt: "You are Wave.",
      });

      expect(mockResponsesCreate).not.toHaveBeenCalled();
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
      expect(result.content).toBe("hello");
    });

    it("streams Responses deltas to the callbacks and parses the terminal response", async () => {
      const deltas: string[] = [];
      mockResponsesCreate.mockReturnValue(
        streamingResponses([
          { type: "response.output_text.delta", delta: "He" },
          { type: "response.output_text.delta", delta: "llo" },
          { type: "response.completed", response: responsesBody("Hello") },
        ]),
      );

      const result = await callAgent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: RESPONSES_API_MODEL,
        messages: [{ role: "user", content: "hi" }],
        workdir: "/work",
        systemPrompt: "You are Wave.",
        onContentDelta: (delta) => deltas.push(delta),
      });

      expect(mockResponsesCreate.mock.calls[0][0].stream).toBe(true);
      expect(deltas).toEqual(["He", "llo"]);
      expect(result.content).toBe("Hello");
    });

    it("re-issues the request without streaming when the Responses stream dies mid-body", async () => {
      mockResponsesCreate
        .mockReturnValueOnce(
          streamingResponses(
            [{ type: "response.output_text.delta", delta: "half" }],
            new TypeError("terminated"),
          ),
        )
        .mockReturnValueOnce(nonStreamingResponses("complete answer"));

      const result = await callAgent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: RESPONSES_API_MODEL,
        messages: [{ role: "user", content: "hi" }],
        workdir: "/work",
        systemPrompt: "You are Wave.",
        onContentDelta: () => {},
      });

      expect(mockResponsesCreate).toHaveBeenCalledTimes(2);
      expect(mockResponsesCreate.mock.calls[1][0].stream).toBe(false);
      expect(result.stream_fallback).toBe(true);
      expect(result.content).toBe("complete answer");
    });

    it("does not re-issue after a user abort", async () => {
      const controller = new AbortController();
      controller.abort();
      mockResponsesCreate.mockReturnValue(
        streamingResponses([
          { type: "response.output_text.delta", delta: "x" },
        ]),
      );

      await expect(
        callAgent({
          gatewayConfig: GATEWAY_CONFIG,
          modelConfig: RESPONSES_API_MODEL,
          messages: [{ role: "user", content: "hi" }],
          workdir: "/work",
          systemPrompt: "You are Wave.",
          onContentDelta: () => {},
          abortSignal: controller.signal,
        }),
      ).rejects.toThrow(/aborted/i);

      expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("one-shot text paths", () => {
    const COMPLETION_MODEL: ModelConfig = {
      model: "claude-sonnet-4-5",
      fastModel: "gpt-fast",
      completionModel: "gpt-6.1-sol",
      completionModelCapabilities: { apiType: "responses" },
    };

    it("sends inline completion over Responses when the completion model declares it", async () => {
      mockResponsesCreate.mockReturnValue(
        nonStreamingResponses("  const x = 1;"),
      );

      const result = await getCompletion({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: COMPLETION_MODEL,
        prefix: "function f() {\n",
        suffix: "\n}",
        filePath: "/work/a.ts",
        language: "typescript",
      });

      expect(mockChatCreate).not.toHaveBeenCalled();
      const body = mockResponsesCreate.mock.calls[0][0];
      expect(body.model).toBe("gpt-6.1-sol");
      expect(body.max_output_tokens).toBe(256);
      expect(body.input[0]).toEqual({
        role: "user",
        content: expect.stringContaining("<code_before_cursor>"),
      });
      expect(result).toEqual({ text: "const x = 1;", model: "gpt-6.1-sol" });
    });

    it("keeps inline completion on Chat Completions without the declaration", async () => {
      mockChatCreate.mockReturnValue(nonStreamingChat("const y = 2;"));

      const result = await getCompletion({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: {
          model: "claude-sonnet-4-5",
          fastModel: "gpt-fast",
          completionModel: "gpt-fast",
        },
        prefix: "",
        suffix: "",
      });

      expect(mockResponsesCreate).not.toHaveBeenCalled();
      expect(result.text).toBe("const y = 2;");
    });

    it("sends next-edit over Responses when its model declares it", async () => {
      mockResponsesCreate.mockReturnValue(
        nonStreamingResponses(
          '{"startLine": 2, "endLine": 2, "text": "const b = 2;"}',
        ),
      );

      const result = await getNextEdit({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: COMPLETION_MODEL,
        edits: [],
        region: { startLine: 1, endLine: 3, text: "a\nb\nc" },
        excerpt: { startLine: 1, text: "a\nb\nc" },
      });

      expect(mockChatCreate).not.toHaveBeenCalled();
      expect(result.suggestion).toEqual({
        startLine: 2,
        endLine: 2,
        text: "const b = 2;",
      });
    });

    it("sends web content processing over Responses when the fast model declares it", async () => {
      mockResponsesCreate.mockReturnValue(nonStreamingResponses("summary"));

      const result = await processWebContent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: {
          model: "claude-sonnet-4-5",
          fastModel: "gpt-6.1-sol",
          fastModelCapabilities: { apiType: "responses" },
        },
        content: "<html>page</html>",
        prompt: "summarize",
        model: "gpt-6.1-sol",
      });

      expect(mockChatCreate).not.toHaveBeenCalled();
      expect(mockResponsesCreate.mock.calls[0][0].model).toBe("gpt-6.1-sol");
      expect(result.content).toBe("summary");
    });

    it("fails web content processing when the Responses answer is empty", async () => {
      mockResponsesCreate.mockReturnValue(nonStreamingResponses(""));

      await expect(
        processWebContent({
          gatewayConfig: GATEWAY_CONFIG,
          modelConfig: {
            model: "claude-sonnet-4-5",
            fastModel: "gpt-6.1-sol",
            fastModelCapabilities: { apiType: "responses" },
          },
          content: "<html>page</html>",
          prompt: "summarize",
          model: "gpt-6.1-sol",
        }),
      ).rejects.toThrow(/Empty response from AI/);
    });
  });
});
