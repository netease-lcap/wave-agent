import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";

const GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

const mockChatCreate = vi.fn();
const mockMessagesCreate = vi.fn();

vi.mock("@/utils/openaiClient.js", () => ({
  OpenAIClient: vi.fn().mockImplementation(function () {
    return {
      chat: { completions: { create: mockChatCreate } },
    };
  }),
}));

// A separate module on purpose: the Messages endpoint is its own client, so
// routing is observable here without touching the OpenAI mock at all.
vi.mock("@/utils/anthropicMessagesClient.js", () => ({
  AnthropicMessagesClient: vi.fn().mockImplementation(function () {
    return {
      messages: { create: mockMessagesCreate },
    };
  }),
}));

const MESSAGES_MODEL: ModelConfig = {
  model: "claude-opus-4-5",
  fastModel: "gpt-fast",
  capabilities: { apiType: "messages", promptCaching: true },
};

const CHAT_MODEL: ModelConfig = {
  model: "claude-sonnet-4-5",
  fastModel: "gpt-fast",
};

function headers(): Headers {
  return new Headers();
}

function messagesBody(text: string) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 5, output_tokens: 2 },
  };
}

/**
 * The client returns an awaitable that also carries `withResponse()`: `callAgent`
 * uses the latter for headers, the one-shot text paths just await it.
 */
function nonStreamingMessages(text: string) {
  const data = messagesBody(text);
  const withResponse = vi.fn().mockResolvedValue({
    data,
    response: { headers: headers() },
  });
  return Object.assign(Promise.resolve(data), { withResponse });
}

function streamingMessages(events: unknown[], failWith?: Error) {
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

describe("aiService - native Messages API routing", () => {
  let callAgent: typeof import("@/services/aiService.js").callAgent;
  let getCompletion: typeof import("@/services/aiService.js").getCompletion;
  let getNextEdit: typeof import("@/services/aiService.js").getNextEdit;
  let processWebContent: typeof import("@/services/aiService.js").processWebContent;

  beforeEach(async () => {
    mockChatCreate.mockReset();
    mockMessagesCreate.mockReset();
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
    it('posts to the Messages endpoint when the model declares apiType: "messages"', async () => {
      mockMessagesCreate.mockReturnValue(nonStreamingMessages("done"));

      const result = await callAgent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: MESSAGES_MODEL,
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
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);

      const body = mockMessagesCreate.mock.calls[0][0];
      // Top-level system, no `system` role in the history.
      expect(body.system).toEqual([{ type: "text", text: "You are Wave." }]);
      expect(body.messages).toEqual([
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "read a.ts",
              // promptCaching is on for this model, so the rolling breakpoint
              // lands on the last text block.
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ]);
      expect(body.tools).toEqual([
        {
          name: "Read",
          description: "Read a file",
          input_schema: { type: "object", properties: {} },
        },
      ]);
      expect(body.max_tokens).toBeGreaterThan(0);
      expect(body.stream).toBe(false);
      expect(result.content).toBe("done");
      expect(result.thinking_blocks).toBeUndefined();
      expect(result.usage).toEqual({
        prompt_tokens: 5,
        completion_tokens: 2,
        total_tokens: 7,
      });
    });

    it("keeps Chat Completions when the model declares no apiType", async () => {
      mockChatCreate.mockReturnValue(nonStreamingChat("from chat"));

      const result = await callAgent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: CHAT_MODEL,
        messages: [{ role: "user", content: "hi" }],
        workdir: "/work",
        systemPrompt: "You are Wave.",
      });

      expect(mockMessagesCreate).not.toHaveBeenCalled();
      expect(result.content).toBe("from chat");
    });

    it("returns the ordered thinking blocks with their signatures", async () => {
      mockMessagesCreate.mockReturnValue(
        Object.assign(
          Promise.resolve({
            ...messagesBody("answer"),
            content: [
              { type: "thinking", thinking: "first", signature: "sig-1" },
              { type: "thinking", thinking: "second", signature: "sig-2" },
              { type: "text", text: "answer" },
            ],
          }),
          {
            withResponse: vi.fn().mockResolvedValue({
              data: {
                ...messagesBody("answer"),
                content: [
                  { type: "thinking", thinking: "first", signature: "sig-1" },
                  { type: "thinking", thinking: "second", signature: "sig-2" },
                  { type: "text", text: "answer" },
                ],
              },
              response: { headers: headers() },
            }),
          },
        ),
      );

      const result = await callAgent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: MESSAGES_MODEL,
        messages: [{ role: "user", content: "hi" }],
        workdir: "/work",
        systemPrompt: "You are Wave.",
      });

      expect(result.thinking_blocks).toEqual([
        { thinking: "first", signature: "sig-1" },
        { thinking: "second", signature: "sig-2" },
      ]);
      expect(result.reasoning_content).toBe("first\nsecond");
    });

    it("streams over the Messages endpoint and reports deltas plus thinking blocks", async () => {
      mockMessagesCreate.mockReturnValue(
        streamingMessages([
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "thinking", thinking: "", signature: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", thinking: "thinking..." },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "signature_delta", signature: "sig-stream" },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "content_block_start",
            index: 1,
            content_block: { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 1,
            delta: { type: "text_delta", text: "hi" },
          },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 9 },
          },
          { type: "message_stop" },
        ]),
      );

      const contentDeltas: string[] = [];
      const reasoningDeltas: string[] = [];
      const result = await callAgent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: MESSAGES_MODEL,
        messages: [{ role: "user", content: "hi" }],
        workdir: "/work",
        systemPrompt: "You are Wave.",
        onContentDelta: (delta) => contentDeltas.push(delta),
        onReasoningDelta: (delta) => reasoningDeltas.push(delta),
      });

      expect(mockChatCreate).not.toHaveBeenCalled();
      expect(mockMessagesCreate.mock.calls[0][0].stream).toBe(true);
      expect(contentDeltas).toEqual(["hi"]);
      expect(reasoningDeltas).toEqual(["thinking..."]);
      expect(result.content).toBe("hi");
      expect(result.thinking_blocks).toEqual([
        { thinking: "thinking...", signature: "sig-stream" },
      ]);
      expect(result.finish_reason).toBe("stop");
    });

    it("re-issues the request without streaming when the stream dies mid-body", async () => {
      mockMessagesCreate
        .mockReturnValueOnce(
          streamingMessages(
            [
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: "" },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: "part" },
              },
            ],
            new Error("socket hang up"),
          ),
        )
        .mockReturnValueOnce(nonStreamingMessages("complete answer"));

      const result = await callAgent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: MESSAGES_MODEL,
        messages: [{ role: "user", content: "hi" }],
        workdir: "/work",
        systemPrompt: "You are Wave.",
        onContentDelta: () => {},
      });

      expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
      expect(mockMessagesCreate.mock.calls[1][0].stream).toBe(false);
      expect(result.stream_fallback).toBe(true);
      expect(result.content).toBe("complete answer");
    });

    it("never re-issues an aborted request", async () => {
      const controller = new AbortController();
      controller.abort();
      mockMessagesCreate.mockReturnValue(
        streamingMessages([], new Error("aborted")),
      );

      await expect(
        callAgent({
          gatewayConfig: GATEWAY_CONFIG,
          modelConfig: MESSAGES_MODEL,
          messages: [{ role: "user", content: "hi" }],
          workdir: "/work",
          systemPrompt: "You are Wave.",
          onContentDelta: () => {},
          abortSignal: controller.signal,
        }),
      ).rejects.toThrow(/aborted/i);

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("one-shot text paths", () => {
    it("sends inline completion over Messages when the completion model declares it", async () => {
      mockMessagesCreate.mockReturnValue(
        nonStreamingMessages("  const x = 1;"),
      );

      const result = await getCompletion({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: {
          model: "claude-opus-4-5",
          fastModel: "gpt-fast",
          completionModel: "claude-fast",
          completionModelCapabilities: { apiType: "messages" },
        },
        prefix: "function f() {\n",
        suffix: "\n}",
        filePath: "/work/a.ts",
        language: "typescript",
      });

      expect(mockChatCreate).not.toHaveBeenCalled();
      const body = mockMessagesCreate.mock.calls[0][0];
      expect(body.model).toBe("claude-fast");
      expect(body.max_tokens).toBe(256);
      expect(body.messages[0].content[0].text).toContain(
        "<code_before_cursor>",
      );
      expect(result).toEqual({ text: "const x = 1;", model: "claude-fast" });
    });

    it("keeps inline completion on Chat Completions without the declaration", async () => {
      mockChatCreate.mockReturnValue(nonStreamingChat("const y = 2;"));

      const result = await getCompletion({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: {
          model: "claude-opus-4-5",
          fastModel: "gpt-fast",
          completionModel: "gpt-fast",
        },
        prefix: "",
        suffix: "",
      });

      expect(mockMessagesCreate).not.toHaveBeenCalled();
      expect(result.text).toBe("const y = 2;");
    });

    it("sends next-edit over Messages when its model declares it", async () => {
      mockMessagesCreate.mockReturnValue(
        nonStreamingMessages(
          '{"startLine": 2, "endLine": 2, "text": "const b = 2;"}',
        ),
      );

      const result = await getNextEdit({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: {
          model: "claude-opus-4-5",
          fastModel: "gpt-fast",
          completionModel: "claude-fast",
          completionModelCapabilities: { apiType: "messages" },
        },
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

    it("sends web content processing over Messages when the fast model declares it", async () => {
      mockMessagesCreate.mockReturnValue(nonStreamingMessages("summary"));

      const result = await processWebContent({
        gatewayConfig: GATEWAY_CONFIG,
        modelConfig: {
          model: "claude-opus-4-5",
          fastModel: "claude-fast",
          fastModelCapabilities: { apiType: "messages" },
        },
        content: "<html>page</html>",
        prompt: "summarize",
        model: "claude-fast",
      });

      expect(mockChatCreate).not.toHaveBeenCalled();
      expect(mockMessagesCreate.mock.calls[0][0].model).toBe("claude-fast");
      expect(result.content).toBe("summary");
    });

    it("fails web content processing when the Messages answer is empty", async () => {
      mockMessagesCreate.mockReturnValue(nonStreamingMessages(""));

      await expect(
        processWebContent({
          gatewayConfig: GATEWAY_CONFIG,
          modelConfig: {
            model: "claude-opus-4-5",
            fastModel: "claude-fast",
            fastModelCapabilities: { apiType: "messages" },
          },
          content: "<html>page</html>",
          prompt: "summarize",
          model: "claude-fast",
        }),
      ).rejects.toThrow(/Empty response from AI/);
    });
  });
});
