import { describe, it, expect, vi } from "vitest";
import type { ChatCompletionMessageParam } from "openai/resources.js";
import {
  buildMessagesRequest,
  parseMessagesResult,
  processMessagesStream,
  type MessagesRequestOptions,
} from "@/services/anthropicMessagesApi.js";
import type {
  AnthropicMessageResponse,
  AnthropicMessageStreamEvent,
  ThinkingBlockData,
} from "@/types/anthropicMessages.js";

/**
 * Build a response the parser accepts: it only reads `content`, `stop_reason`
 * and `usage`, while the SDK's response type models the whole wire object
 * (citations, cache breakdown, per-tool detail) that these cases do not need.
 */
function response(body: Record<string, unknown>): AnthropicMessageResponse {
  return {
    role: "assistant",
    type: "message",
    ...body,
  } as unknown as AnthropicMessageResponse;
}

function build(overrides: Partial<MessagesRequestOptions> = {}) {
  return buildMessagesRequest({
    model: "claude-opus-4-5",
    systemPrompt: "You are Wave.",
    messages: [{ role: "user", content: "hi" }],
    params: { model: "claude-opus-4-5", max_tokens: 4096, temperature: 0.2 },
    stream: false,
    supportsCaching: false,
    ...overrides,
  });
}

type AssistantWithThinking = ChatCompletionMessageParam & {
  anthropic_thinking?: ThinkingBlockData[];
};

describe("buildMessagesRequest", () => {
  it("moves the system prompt to the top level and keeps the history user/assistant", () => {
    const body = build({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
    });

    expect(body.system).toEqual([{ type: "text", text: "You are Wave." }]);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
      { role: "user", content: [{ type: "text", text: "again" }] },
    ]);
    // No `system` role may survive in the history — the endpoint rejects it.
    expect(
      (body.messages as Array<{ role: string }>).some(
        (m) => m.role === "system",
      ),
    ).toBe(false);
  });

  it("declares tools as input_schema and maps tool_choice", () => {
    const body = build({
      tools: [
        {
          type: "function",
          function: {
            name: "Read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
        },
      ],
      toolChoice: "required",
    });

    expect(body.tools).toEqual([
      {
        name: "Read",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
        },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: "any" });
  });

  it("maps a forced tool choice to {type:'tool', name}", () => {
    const body = build({
      toolChoice: { type: "function", function: { name: "Bash" } },
    });
    expect(body.tool_choice).toEqual({ type: "tool", name: "Bash" });
  });

  it("turns tool messages into tool_result blocks at the front of the next user turn", () => {
    const body = build({
      messages: [
        { role: "user", content: "read a.ts" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "toolu_1",
              type: "function",
              function: { name: "Read", arguments: '{"path":"a.ts"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "toolu_1", content: "file body" },
        { role: "user", content: "thanks" },
      ] as ChatCompletionMessageParam[],
    });

    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "read a.ts" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Read",
            input: { path: "a.ts" },
          },
        ],
      },
      // The tool_result and the following user text share one user turn: two
      // user messages in a row would be rejected.
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "file body" },
          { type: "text", text: "thanks" },
        ],
      },
    ]);
  });

  it("closes the tool_result turn before the next assistant, not after it", () => {
    // The shape of every second-round request in the agent loop: the model's
    // tool_use turn, the tool result, then the model's final reply. The result
    // has to sit between the two assistant turns — waiting for the next *user*
    // turn would hoist it past the reply and merge both assistant turns into
    // one whose tool_use is followed by text.
    const body = build({
      messages: [
        { role: "user", content: "read a.ts" },
        {
          role: "assistant",
          content: "reading it",
          tool_calls: [
            {
              id: "toolu_1",
              type: "function",
              function: { name: "Read", arguments: '{"path":"a.ts"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "toolu_1", content: "file body" },
        { role: "assistant", content: "the file says hi" },
        { role: "user", content: "thanks" },
      ] as ChatCompletionMessageParam[],
    });

    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "read a.ts" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "reading it" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Read",
            input: { path: "a.ts" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "file body" },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "the file says hi" }],
      },
      { role: "user", content: [{ type: "text", text: "thanks" }] },
    ]);
  });

  it("merges adjacent same-role turns", () => {
    const body = build({
      messages: [
        { role: "user", content: "one" },
        { role: "user", content: "two" },
        { role: "assistant", content: "reply" },
        { role: "assistant", content: "and more" },
      ] as ChatCompletionMessageParam[],
    });

    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "reply" },
          { type: "text", text: "and more" },
        ],
      },
    ]);
  });

  it("replays thinking blocks before text and tool_use, signature verbatim", () => {
    const assistant: AssistantWithThinking = {
      role: "assistant",
      content: "let me read that",
      tool_calls: [
        {
          id: "toolu_9",
          type: "function",
          function: { name: "Read", arguments: '{"path":"b.ts"}' },
        },
      ],
      anthropic_thinking: [
        { thinking: "I should read b.ts", signature: "sig-abc" },
      ],
    };

    const body = build({
      messages: [
        { role: "user", content: "read b.ts" },
        assistant,
        { role: "tool", tool_call_id: "toolu_9", content: "body" },
      ] as ChatCompletionMessageParam[],
    });

    expect((body.messages as Array<{ content: unknown[] }>)[1].content).toEqual(
      [
        {
          type: "thinking",
          thinking: "I should read b.ts",
          signature: "sig-abc",
        },
        { type: "text", text: "let me read that" },
        {
          type: "tool_use",
          id: "toolu_9",
          name: "Read",
          input: { path: "b.ts" },
        },
      ],
    );
  });

  it("demotes unsigned thinking to assistant text instead of replaying a thinking block", () => {
    const body = build({
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "answer",
          anthropic_thinking: [{ thinking: "unsigned thought" }],
        } as AssistantWithThinking,
      ] as ChatCompletionMessageParam[],
    });

    expect((body.messages as Array<{ content: unknown[] }>)[1].content).toEqual(
      [
        { type: "text", text: "unsigned thought" },
        { type: "text", text: "answer" },
      ],
    );
  });

  it("replays a redacted thinking block as-is", () => {
    const body = build({
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "answer",
          anthropic_thinking: [{ thinking: "", redacted: "opaque-data" }],
        } as AssistantWithThinking,
      ] as ChatCompletionMessageParam[],
    });

    expect((body.messages as Array<{ content: unknown[] }>)[1].content).toEqual(
      [
        { type: "redacted_thinking", data: "opaque-data" },
        { type: "text", text: "answer" },
      ],
    );
  });

  it("passes a data-URL image through as a base64 source", () => {
    const body = build({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AAAABBBB" },
            },
          ],
        },
      ] as ChatCompletionMessageParam[],
    });

    expect((body.messages as Array<{ content: unknown[] }>)[0].content).toEqual(
      [
        { type: "text", text: "what is this" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "AAAABBBB" },
        },
      ],
    );
  });

  it("keeps max_tokens and the user's own options, adding no translated key", () => {
    const body = build({
      params: {
        model: "claude-opus-4-5",
        max_tokens: 8000,
        temperature: 0.3,
        thinking: { type: "enabled", budget_tokens: 4000 },
      },
    });

    expect(body.max_tokens).toBe(8000);
    expect(body.temperature).toBe(0.3);
    // The native shape needs no translation — it is sent as configured.
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4000 });
    expect(body.reasoning).toBeUndefined();
    expect(body.max_output_tokens).toBeUndefined();
  });

  it("attaches cache_control to cacheable system blocks and the rolling breakpoint", () => {
    const body = build({
      systemPrompt: [
        { text: "stable prefix", cacheable: true },
        { text: "volatile tail", cacheable: false },
      ],
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      supportsCaching: true,
    });

    expect(body.system).toEqual([
      {
        type: "text",
        text: "stable prefix",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: "volatile tail" },
    ]);
    const messages = body.messages as Array<{
      content: Array<{ cache_control?: unknown }>;
    }>;
    expect(messages[1].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(messages[0].content[0].cache_control).toBeUndefined();
  });

  it("adds no cache markers when the model does not declare prompt caching", () => {
    const body = build({
      systemPrompt: [{ text: "stable prefix", cacheable: true }],
      supportsCaching: false,
    });
    expect(body.system).toEqual([{ type: "text", text: "stable prefix" }]);
  });
});

describe("parseMessagesResult", () => {
  it("splits text, thinking blocks and tool calls, and maps stop_reason", () => {
    const result = parseMessagesResult(
      response({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-5",
        content: [
          { type: "thinking", thinking: "consider", signature: "sig-1" },
          { type: "text", text: "calling Read" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Read",
            input: { path: "a.ts" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    expect(result.content).toBe("calling Read");
    expect(result.reasoning_content).toBe("consider");
    expect(result.thinking_blocks).toEqual([
      { thinking: "consider", signature: "sig-1" },
    ]);
    expect(result.tool_calls).toEqual([
      {
        id: "toolu_1",
        type: "function",
        function: { name: "Read", arguments: '{"path":"a.ts"}' },
      },
    ]);
    expect(result.finish_reason).toBe("tool_calls");
  });

  it("sums the input and both cache buckets into prompt_tokens", () => {
    const result = parseMessagesResult(
      response({
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-5",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 50,
        },
      }),
    );

    expect(result.usage).toEqual({
      prompt_tokens: 1050,
      completion_tokens: 20,
      total_tokens: 1070,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 50,
    });
    expect(result.finish_reason).toBe("stop");
  });

  it("maps max_tokens to length so truncation auto-continue keeps working", () => {
    const result = parseMessagesResult(
      response({
        id: "msg_3",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-5",
        content: [{ type: "text", text: "half" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    expect(result.finish_reason).toBe("length");
  });

  it("keeps redacted_thinking opaque and out of reasoning_content", () => {
    const result = parseMessagesResult(
      response({
        id: "msg_4",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-5",
        content: [
          { type: "redacted_thinking", data: "opaque" },
          { type: "text", text: "answer" },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    expect(result.thinking_blocks).toEqual([
      { thinking: "", redacted: "opaque" },
    ]);
    expect(result.reasoning_content).toBeUndefined();
  });
});

describe("processMessagesStream", () => {
  async function* events(list: AnthropicMessageStreamEvent[]) {
    for (const event of list) yield event;
  }

  it("streams text deltas and returns the accumulated content", async () => {
    const deltas: string[] = [];
    const result = await processMessagesStream(
      events([
        {
          type: "message_start",
          message: { usage: { input_tokens: 7, output_tokens: 0 } } as never,
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hel" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "lo" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 2 },
        },
        { type: "message_stop" },
      ]),
      { onContentDelta: (delta) => deltas.push(delta) },
    );

    expect(deltas).toEqual(["Hel", "lo"]);
    expect(result.content).toBe("Hello");
    expect(result.finish_reason).toBe("stop");
    expect(result.usage).toEqual({
      prompt_tokens: 7,
      completion_tokens: 2,
      total_tokens: 9,
    });
  });

  it("captures the signature delivered after the thinking text", async () => {
    const reasoning: string[] = [];
    const result = await processMessagesStream(
      events([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "", signature: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "let me think" },
        },
        // The signature always arrives last, right before the block stops.
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig-xyz" },
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
          delta: { type: "text_delta", text: "answer" },
        },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]),
      { onReasoningDelta: (delta) => reasoning.push(delta) },
    );

    expect(reasoning).toEqual(["let me think"]);
    expect(result.reasoning_content).toBe("let me think");
    expect(result.thinking_blocks).toEqual([
      { thinking: "let me think", signature: "sig-xyz" },
    ]);
    expect(result.content).toBe("answer");
  });

  it("assembles a streamed tool call from input_json_delta fragments", async () => {
    const toolUpdates: Array<{ stage?: string; parameters?: string }> = [];
    const result = await processMessagesStream(
      events([
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "Read",
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"path"' },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: ':"a.ts"}' },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ]),
      {
        onToolUpdate: (update) =>
          toolUpdates.push({
            stage: update.stage,
            parameters: update.parameters,
          }),
      },
    );

    expect(result.tool_calls).toEqual([
      {
        id: "toolu_1",
        type: "function",
        function: { name: "Read", arguments: '{"path":"a.ts"}' },
      },
    ]);
    expect(result.finish_reason).toBe("tool_calls");
    expect(toolUpdates[toolUpdates.length - 1]).toEqual({
      stage: "end",
      parameters: '{"path":"a.ts"}',
    });
  });

  it("ignores ping events", async () => {
    const result = await processMessagesStream(
      events([
        { type: "ping" },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "ok" },
        },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]),
      {},
    );
    expect(result.content).toBe("ok");
  });

  it("throws when the stream ends without a stop_reason so the caller can fall back", async () => {
    await expect(
      processMessagesStream(
        events([
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "partial" },
          },
        ]),
        {},
      ),
    ).rejects.toThrow(/truncated/);
  });

  it("does not treat an aborted stream as truncated", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await processMessagesStream(
      events([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "partial" },
        },
      ]),
      { abortSignal: controller.signal },
    );
    expect(result.content).toBe("partial");
  });

  it("surfaces an error event as a thrown error", async () => {
    await expect(
      processMessagesStream(
        events([
          {
            type: "error",
            error: { type: "overloaded_error", message: "Overloaded" },
          },
        ]),
        {},
      ),
    ).rejects.toThrow(/overloaded_error/);
  });
});

describe("requestMessagesText", () => {
  it("sends a single user message and returns its text", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-fast",
      content: [{ type: "text", text: "  summarised  " }],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 4 },
    });

    const result = await (
      await import("@/services/anthropicMessagesApi.js")
    ).requestMessagesText({
      client: { messages: { create } },
      model: "claude-fast",
      systemPrompt: "summarise",
      userContent: "<html/>",
      params: { model: "claude-fast", max_tokens: 256 },
    });

    const body = create.mock.calls[0][0];
    expect(body.system).toEqual([{ type: "text", text: "summarise" }]);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "<html/>" }] },
    ]);
    expect(body.stream).toBe(false);
    expect(result.content).toBe("  summarised  ");
    expect(result.usage).toEqual({
      prompt_tokens: 3,
      completion_tokens: 4,
      total_tokens: 7,
    });
  });
});
