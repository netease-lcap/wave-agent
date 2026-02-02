import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIClient } from "../../src/utils/openaiClient.js";

describe("OpenAIClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  describe("Retry logic", () => {
    it("should retry on 429 status code and eventually succeed", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          headers: new Headers(),
          text: async () =>
            JSON.stringify({ error: { message: "Rate limit reached" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "success" } }],
          }),
          headers: new Headers(),
        });

      const client = new OpenAIClient({
        baseURL: "https://api.openai.com/v1",
        apiKey: "test-key",
        fetch: mockFetch,
      });

      const promise = client.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
      });

      // First attempt fails with 429
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.choices[0].message.content).toBe("success");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should use exponential backoff", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers(),
        text: async () =>
          JSON.stringify({ error: { message: "Rate limit reached" } }),
      });

      const client = new OpenAIClient({
        baseURL: "https://api.openai.com/v1",
        apiKey: "test-key",
        fetch: mockFetch,
      });

      const promise = client.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
      });

      // Initial attempt
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // First retry after 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second retry after 2000ms
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Third retry after 4000ms
      await vi.advanceTimersByTimeAsync(4000);
      expect(mockFetch).toHaveBeenCalledTimes(4);

      await expect(promise).rejects.toThrow("Rate limit reached");
    });

    it("should eventually fail after max retries (3 retries)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers(),
        text: async () =>
          JSON.stringify({ error: { message: "Rate limit reached" } }),
      });

      const client = new OpenAIClient({
        baseURL: "https://api.openai.com/v1",
        apiKey: "test-key",
        fetch: mockFetch,
      });

      const promise = client.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
      });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow("Rate limit reached");
      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it("should not retry on other error status codes (e.g., 400)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: new Headers(),
        text: async () =>
          JSON.stringify({ error: { message: "Invalid request" } }),
      });

      const client = new OpenAIClient({
        baseURL: "https://api.openai.com/v1",
        apiKey: "test-key",
        fetch: mockFetch,
      });

      const promise = client.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
      });

      await expect(promise).rejects.toThrow("Invalid request");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry on 500 status code", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers(),
        text: async () => "Internal Server Error",
      });

      const client = new OpenAIClient({
        baseURL: "https://api.openai.com/v1",
        apiKey: "test-key",
        fetch: mockFetch,
      });

      const promise = client.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
      });

      await expect(promise).rejects.toThrow("Internal Server Error");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
