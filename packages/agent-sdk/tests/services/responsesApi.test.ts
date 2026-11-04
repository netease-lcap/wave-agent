import { describe, it, expect } from "vitest";
import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
  Responses,
} from "openai/resources.js";
import {
  buildResponsesRequest,
  mapResponsesUsage,
  parseResponsesResult,
  processResponsesStream,
  translateGenerationParams,
  translateMessages,
  translateTools,
} from "@/services/responsesApi.js";

const EMPTY_PARAMS = {};

function build(
  overrides: Partial<Parameters<typeof buildResponsesRequest>[0]> = {},
) {
  return buildResponsesRequest({
    model: "gpt-6.1-sol",
    messages: [{ role: "user", content: "hi" }],
    params: EMPTY_PARAMS,
    stream: false,
    ...overrides,
  });
}

/** Minimal `Response` — only the fields the parser reads. */
function response(
  overrides: Partial<Record<string, unknown>> = {},
): Responses.Response {
  return {
    status: "completed",
    output: [],
    incomplete_details: null,
    usage: null,
    error: null,
    ...overrides,
  } as unknown as Responses.Response;
}

describe("Responses API transport", () => {
  describe("request translation", () => {
    it("carries the system prompt as instructions and the turn as input", () => {
      const body = build({
        messages: [
          { role: "system", content: "You are Wave." },
          { role: "user", content: "hi" },
        ],
      });

      expect(body.instructions).toBe("You are Wave.");
      expect(body.input).toEqual([{ role: "user", content: "hi" }]);
      // The chat-shaped vocabulary must not survive into the body.
      expect(body.messages).toBeUndefined();
    });

    it("joins system blocks and drops their cache_control markers", () => {
      const { instructions, input } = translateMessages([
        {
          role: "system",
          content: [
            {
              type: "text",
              text: "static",
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: "dynamic",
              cache_control: { type: "ephemeral" },
            },
          ],
        } as unknown as ChatCompletionMessageParam,
        { role: "user", content: "hi" },
      ]);

      expect(instructions).toBe("static\n\ndynamic");
      expect(input).toHaveLength(1);
    });

    it("maps user image parts onto input_image with the URL untouched", () => {
      const dataUrl = "data:image/png;base64,AAAA";
      const body = build({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "look" },
              { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
            ],
          },
        ],
      });

      expect(body.input).toEqual([
        {
          role: "user",
          content: [
            { type: "input_text", text: "look" },
            { type: "input_image", image_url: dataUrl, detail: "low" },
          ],
        },
      ]);
    });

    it("replays an assistant tool call as a function_call item and its result as a function_call_output with the same call_id", () => {
      const body = build({
        messages: [
          { role: "user", content: "read the file" },
          {
            role: "assistant",
            content: "Reading it now.",
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: { name: "Read", arguments: '{"path":"a.ts"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_abc", content: "file body" },
        ],
      });

      expect(body.input).toEqual([
        { role: "user", content: "read the file" },
        { role: "assistant", content: "Reading it now." },
        {
          type: "function_call",
          call_id: "call_abc",
          name: "Read",
          arguments: '{"path":"a.ts"}',
        },
        {
          type: "function_call_output",
          call_id: "call_abc",
          output: "file body",
        },
      ]);
    });

    it("flattens tool declarations", () => {
      const tools: ChatCompletionFunctionTool[] = [
        {
          type: "function",
          function: {
            name: "Read",
            description: "Read a file",
            parameters: { type: "object", properties: {} },
            strict: true,
          },
        },
      ];

      expect(translateTools(tools)).toEqual([
        {
          type: "function",
          name: "Read",
          description: "Read a file",
          parameters: { type: "object", properties: {} },
          strict: true,
        },
      ]);
      expect(build({ tools }).tools).toEqual(translateTools(tools));
    });

    it("translates a forced tool choice into the flat named form", () => {
      expect(
        build({ toolChoice: { type: "function", function: { name: "Read" } } })
          .tool_choice,
      ).toEqual({ type: "function", name: "Read" });
      expect(build({ toolChoice: "required" }).tool_choice).toBe("required");
    });

    it("maps max_tokens and max_completion_tokens onto max_output_tokens", () => {
      expect(
        translateGenerationParams({ max_tokens: 8192 }).max_output_tokens,
      ).toBe(8192);
      expect(
        translateGenerationParams({ max_completion_tokens: 1000 })
          .max_output_tokens,
      ).toBe(1000);
      expect(
        translateGenerationParams({ max_tokens: 1 }).max_output_tokens,
      ).toBe(1);
    });

    it("maps reasoning_effort, verbosity and response_format into their nested homes", () => {
      const params = translateGenerationParams({
        reasoning_effort: "high",
        verbosity: "low",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "Answer",
            schema: { type: "object" },
            strict: true,
          },
        },
      });

      expect(params.reasoning).toEqual({ effort: "high" });
      expect(params.text).toEqual({
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "Answer",
          schema: { type: "object" },
          strict: true,
        },
      });
      expect(params.reasoning_effort).toBeUndefined();
      expect(params.verbosity).toBeUndefined();
      expect(params.response_format).toBeUndefined();
    });

    it("passes unrecognised options through verbatim instead of filtering them", () => {
      const params = translateGenerationParams({
        temperature: 0.2,
        seed: 42,
        stop: ["\n\n"],
        custom_gateway_flag: true,
      });

      expect(params).toEqual({
        temperature: 0.2,
        seed: 42,
        stop: ["\n\n"],
        custom_gateway_flag: true,
      });
    });

    it("never lets a mapped key overwrite the caller's Responses-shaped value", () => {
      const params = translateGenerationParams({
        reasoning_effort: "low",
        reasoning: { effort: "xhigh" },
        verbosity: "low",
        text: { verbosity: "high" },
      });

      expect(params.reasoning).toEqual({ effort: "xhigh" });
      expect(params.text).toEqual({ verbosity: "high" });
    });
  });

  describe("response parsing", () => {
    it("reads output_text into content and reasoning items into reasoning_content", () => {
      const parsed = parseResponsesResult(
        response({
          output: [
            {
              type: "reasoning",
              id: "rs_1",
              summary: [{ type: "summary_text", text: "thinking" }],
            },
            {
              type: "message",
              id: "msg_1",
              role: "assistant",
              content: [{ type: "output_text", text: "hello" }],
            },
          ],
        }),
      );

      expect(parsed.content).toBe("hello");
      expect(parsed.reasoning_content).toBe("thinking");
      expect(parsed.finish_reason).toBe("stop");
    });

    it("reads function_call items into tool calls keyed by call_id", () => {
      const parsed = parseResponsesResult(
        response({
          output: [
            {
              type: "function_call",
              call_id: "call_1",
              name: "Read",
              arguments: '{"path":"a.ts"}',
            },
            {
              type: "function_call",
              call_id: "call_2",
              name: "Bash",
              arguments: '{"command":"ls"}',
            },
          ],
        }),
      );

      expect(parsed.tool_calls).toEqual([
        {
          id: "call_1",
          type: "function",
          function: { name: "Read", arguments: '{"path":"a.ts"}' },
        },
        {
          id: "call_2",
          type: "function",
          function: { name: "Bash", arguments: '{"command":"ls"}' },
        },
      ]);
      expect(parsed.finish_reason).toBe("tool_calls");
    });

    it("maps an output-token truncation onto finish_reason length", () => {
      const parsed = parseResponsesResult(
        response({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [
            {
              type: "message",
              id: "msg_1",
              role: "assistant",
              content: [{ type: "output_text", text: "half an ans" }],
            },
          ],
        }),
      );

      expect(parsed.finish_reason).toBe("length");
      expect(parsed.content).toBe("half an ans");
    });

    it("maps a content filter stop onto finish_reason content_filter", () => {
      const parsed = parseResponsesResult(
        response({
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
        }),
      );

      expect(parsed.finish_reason).toBe("content_filter");
    });

    it("maps token usage and keeps cache reads out of total_tokens", () => {
      const parsed = parseResponsesResult(
        response({
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            input_tokens_details: { cached_tokens: 60, cache_write_tokens: 5 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        }),
      );

      expect(parsed.usage).toEqual({
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        cache_read_input_tokens: 60,
        cache_creation_input_tokens: 5,
      });
    });

    it("returns no usage when the response carries none", () => {
      expect(mapResponsesUsage(null)).toBeUndefined();
      expect(parseResponsesResult(response()).usage).toBeUndefined();
    });
  });

  describe("streaming", () => {
    async function* events(...list: unknown[]) {
      for (const event of list) yield event as Responses.ResponseStreamEvent;
    }

    it("forwards text, reasoning and tool-argument deltas to their channels", async () => {
      const content: string[] = [];
      const reasoning: string[] = [];
      const toolUpdates: { id: string; stage?: string; chunk?: string }[] = [];

      const parsed = await processResponsesStream(
        events(
          { type: "response.created", response: response() },
          { type: "response.reasoning_summary_text.delta", delta: "think" },
          { type: "response.output_text.delta", delta: "Hello " },
          { type: "response.output_text.delta", delta: "world" },
          {
            type: "response.output_item.added",
            output_index: 1,
            item: { type: "function_call", call_id: "call_1", name: "Read" },
          },
          {
            type: "response.function_call_arguments.delta",
            output_index: 1,
            delta: '{"path":',
          },
          {
            type: "response.function_call_arguments.delta",
            output_index: 1,
            delta: '"a.ts"}',
          },
          {
            type: "response.completed",
            response: response({
              output: [
                {
                  type: "message",
                  id: "msg_1",
                  role: "assistant",
                  content: [{ type: "output_text", text: "Hello world" }],
                },
                {
                  type: "function_call",
                  call_id: "call_1",
                  name: "Read",
                  arguments: '{"path":"a.ts"}',
                },
              ],
            }),
          },
        ),
        {
          onContentDelta: (delta) => content.push(delta),
          onReasoningDelta: (delta) => reasoning.push(delta),
          onToolUpdate: (update) =>
            toolUpdates.push({
              id: update.id,
              stage: update.stage,
              chunk: update.parametersChunk,
            }),
        },
      );

      expect(content).toEqual(["Hello ", "world"]);
      expect(reasoning).toEqual(["think"]);
      expect(toolUpdates).toEqual([
        { id: "call_1", stage: "start", chunk: "" },
        { id: "call_1", stage: "streaming", chunk: '{"path":' },
        { id: "call_1", stage: "streaming", chunk: '"a.ts"}' },
      ]);
      // The terminal response is the authority, not the accumulated deltas.
      expect(parsed.content).toBe("Hello world");
      expect(parsed.tool_calls?.[0].id).toBe("call_1");
    });

    it("treats a stream with no terminal event as truncated", async () => {
      await expect(
        processResponsesStream(
          events({ type: "response.output_text.delta", delta: "half" }),
          {},
        ),
      ).rejects.toThrow(/without a terminal event/);
    });

    it("surfaces a failed response as an error", async () => {
      await expect(
        processResponsesStream(
          events({
            type: "response.failed",
            response: response({
              status: "failed",
              error: { code: "server_error", message: "boom" },
            }),
          }),
          {},
        ),
      ).rejects.toThrow(/boom/);
    });

    it("surfaces a stream error event", async () => {
      await expect(
        processResponsesStream(
          events({ type: "error", message: "rate limited" }),
          {},
        ),
      ).rejects.toThrow(/rate limited/);
    });

    it("aborts mid-stream when the signal fires", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        processResponsesStream(
          events({ type: "response.output_text.delta", delta: "x" }),
          { abortSignal: controller.signal },
        ),
      ).rejects.toThrow("Request was aborted");
    });
  });
});
