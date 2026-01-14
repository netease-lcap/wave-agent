import { describe, it, expect, vi } from "vitest";
import { OpenAIClient } from "../../src/utils/openaiClient.js";

describe("OpenAIClient", () => {
  it("should correctly handle SSE data lines with and without a space after the colon", async () => {
    const mockLines = [
      'data: {"choices": [{"delta": {"content": "hello"}}]}\n\n',
      'data:{"choices": [{"delta": {"content": "world"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const line of mockLines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
      headers: new Headers(),
    });

    const client = new OpenAIClient({
      baseURL: "https://api.openai.com/v1",
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const chunks = [];
    const response = await client.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });

    for await (const chunk of response) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices[0].delta.content).toBe("hello");
    expect(chunks[1].choices[0].delta.content).toBe("world");
  });

  it("should correctly handle SSE data lines with [DONE] without space", async () => {
    const mockLines = [
      'data: {"choices": [{"delta": {"content": "hello"}}]}\n\n',
      "data:[DONE]\n\n",
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const line of mockLines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
      headers: new Headers(),
    });

    const client = new OpenAIClient({
      baseURL: "https://api.openai.com/v1",
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const chunks = [];
    const response = await client.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });

    for await (const chunk of response) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.content).toBe("hello");
  });

  it("should correctly handle SSE data lines split across multiple chunks", async () => {
    const mockChunks = [
      'data: {"choices": [{"delta": {"content": "',
      'hello"}}]}\n\ndata:[DONE]\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of mockChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
      headers: new Headers(),
    });

    const client = new OpenAIClient({
      baseURL: "https://api.openai.com/v1",
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const chunks = [];
    const response = await client.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });

    for await (const chunk of response) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.content).toBe("hello");
  });
});
