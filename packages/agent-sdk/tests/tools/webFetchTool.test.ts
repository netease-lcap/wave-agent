import { describe, it, expect, vi, beforeEach } from "vitest";
import { webFetchTool } from "../../src/tools/webFetchTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import { createMockTaskManager } from "../helpers/mockFactories.js";

// Binary fetches land on disk; nothing here needs the real /tmp files.
vi.mock("../../src/utils/toolResultStorage.js", () => ({
  getToolResultsDir: vi.fn(() => "/tmp/wave-tool-results"),
  persistToolResult: vi.fn(() => "/tmp/wave-tool-results/tool_1.txt"),
  persistToolResultBuffer: vi.fn(() => "/tmp/wave-tool-results/webfetch_1.png"),
  buildPersistedOutputMessage: vi.fn(() => "<persisted-output/>"),
  generatePreview: vi.fn((content: string) => content.slice(0, 100)),
}));

describe("webFetchTool", () => {
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    context = {
      workdir: "/test/workdir",
      taskManager: createMockTaskManager(),
      aiManager: {
        getModelConfig: vi.fn().mockReturnValue({
          model: "gpt-4",
          fastModel: "gpt-3.5-turbo",
        }),
        getGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://api.openai.com/v1",
        }),
      } as unknown as ToolContext["aiManager"],
      aiService: {
        processWebContent: vi.fn().mockResolvedValue({
          content: "This is a summary of the web page.",
        }),
      } as unknown as ToolContext["aiService"],
    };
  });

  it("should fetch content and process with AI", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi
        .fn()
        .mockResolvedValue("<html><body><h1>Hello World</h1></body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await webFetchTool.execute(
      {
        url: "https://basic-test.example.com",
        prompt: "Summarize this page",
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("This is a summary of the web page.");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://basic-test.example.com",
      expect.any(Object),
    );
    expect(context.aiService!.processWebContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-3.5-turbo",
        content: expect.stringContaining("Hello World"),
        prompt: "Summarize this page",
      }),
    );
  });

  it("should upgrade HTTP to HTTPS", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue("<html><body>Hello</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await webFetchTool.execute(
      {
        url: "http://http-test.example.com",
        prompt: "Summarize",
      },
      context,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "https://http-test.example.com",
      expect.any(Object),
    );
  });

  it("should handle redirects to different hosts", async () => {
    const mockResponse = {
      status: 301,
      statusText: "Moved Permanently",
      headers: new Headers({ location: "https://other.com/page" }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await webFetchTool.execute(
      {
        url: "https://redirect-test.example.com",
        prompt: "Summarize",
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("REDIRECT_TO: https://other.com/page");
  });

  it("should allow GitHub URLs (no hard block, only prompt-level suggestion)", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi
        .fn()
        .mockResolvedValue("<html><body>GitHub Page Content</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await webFetchTool.execute(
      {
        url: "https://github.com/netease-lcap/wave-agent",
        prompt: "Summarize",
      },
      context,
    );

    // GitHub URLs are no longer hard-blocked; only a prompt-level suggestion exists
    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://github.com/netease-lcap/wave-agent",
      expect.any(Object),
    );
  });

  it("should use cache for repeated requests", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi
        .fn()
        .mockResolvedValue("<html><body>Cached Content</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    // First request
    await webFetchTool.execute(
      {
        url: "https://cache-test.example.com",
        prompt: "Summarize",
      },
      context,
    );

    // Second request
    await webFetchTool.execute(
      {
        url: "https://cache-test.example.com",
        prompt: "Summarize again",
      },
      context,
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("webFetchTool - URL validation", () => {
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    context = {
      workdir: "/test/workdir",
      taskManager: createMockTaskManager(),
      aiManager: {
        getModelConfig: vi.fn().mockReturnValue({
          model: "gpt-4",
          fastModel: "gpt-3.5-turbo",
        }),
        getGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://api.openai.com/v1",
        }),
      } as unknown as ToolContext["aiManager"],
      aiService: {
        processWebContent: vi.fn().mockResolvedValue({
          content: "This is a summary of the web page.",
        }),
      } as unknown as ToolContext["aiService"],
    };
  });

  it("should reject URLs exceeding 2000 characters", async () => {
    const longUrl = "https://validation-test.example.com/" + "a".repeat(2000);
    const result = await webFetchTool.execute(
      { url: longUrl, prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("maximum length");
  });

  it("should reject URLs with username/password", async () => {
    const result = await webFetchTool.execute(
      { url: "https://user:pass@credentials.example.com", prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("username or password");
  });

  it("should reject localhost URLs", async () => {
    const result = await webFetchTool.execute(
      { url: "https://localhost:3000", prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("at least two parts");
  });

  it("should reject single-part hostnames", async () => {
    const result = await webFetchTool.execute(
      { url: "https://foo", prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("at least two parts");
  });
});

describe("webFetchTool - security limits", () => {
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    context = {
      workdir: "/test/workdir",
      taskManager: createMockTaskManager(),
      aiManager: {
        getModelConfig: vi.fn().mockReturnValue({
          model: "gpt-4",
          fastModel: "gpt-3.5-turbo",
        }),
        getGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://api.openai.com/v1",
        }),
      } as unknown as ToolContext["aiManager"],
      aiService: {
        processWebContent: vi.fn().mockResolvedValue({
          content: "This is a summary of the web page.",
        }),
      } as unknown as ToolContext["aiService"],
    };
  });

  it("should pass signal to fetch for timeout", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue("<html><body>Hello</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await webFetchTool.execute(
      { url: "https://signal-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "https://signal-test.example.com",
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    );
  });

  it("should reject responses exceeding MAX_HTTP_CONTENT_LENGTH", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue("<html><body>Hello</body></html>"),
      headers: new Headers({
        "content-length": String(11 * 1024 * 1024), // 11MB
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await webFetchTool.execute(
      { url: "https://content-length-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Content too large");
  });
});

describe("webFetchTool - redirect handling", () => {
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    context = {
      workdir: "/test/workdir",
      taskManager: createMockTaskManager(),
      aiManager: {
        getModelConfig: vi.fn().mockReturnValue({
          model: "gpt-4",
          fastModel: "gpt-3.5-turbo",
        }),
        getGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://api.openai.com/v1",
        }),
      } as unknown as ToolContext["aiManager"],
      aiService: {
        processWebContent: vi.fn().mockResolvedValue({
          content: "This is a summary of the web page.",
        }),
      } as unknown as ToolContext["aiService"],
    };
  });

  it("should follow same-host redirects automatically", async () => {
    const mockRedirect = {
      status: 301,
      statusText: "Moved Permanently",
      headers: new Headers({
        location: "https://same-host-redirect.example.com/new-path",
      }),
    };
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue("<html><body>Final</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(mockRedirect)
        .mockResolvedValueOnce(mockResponse),
    );

    const result = await webFetchTool.execute(
      { url: "https://same-host-redirect.example.com", prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).not.toContain("REDIRECT_TO");
  });

  it("should follow www-variation redirects automatically", async () => {
    const mockRedirect = {
      status: 301,
      statusText: "Moved Permanently",
      headers: new Headers({
        location: "https://www.www-variation-test.example.com/page",
      }),
    };
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue("<html><body>Final</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(mockRedirect)
        .mockResolvedValueOnce(mockResponse),
    );

    const result = await webFetchTool.execute(
      { url: "https://www-variation-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).not.toContain("REDIRECT_TO");
  });

  it("should return REDIRECT_TO for cross-host redirects", async () => {
    const mockRedirect = {
      status: 301,
      statusText: "Moved Permanently",
      headers: new Headers({ location: "https://other.com/page" }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockRedirect));

    const result = await webFetchTool.execute(
      { url: "https://cross-host-redirect.example.com", prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("REDIRECT_TO: https://other.com/page");
  });

  it("should reject too many redirects", async () => {
    const mockRedirect = {
      status: 301,
      statusText: "Moved Permanently",
      headers: new Headers({
        location: "https://too-many-redirects.example.com/loop",
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockRedirect));

    const result = await webFetchTool.execute(
      { url: "https://too-many-redirects.example.com", prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Too many redirects");
  });
});

describe("webFetchTool - headers", () => {
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    context = {
      workdir: "/test/workdir",
      taskManager: createMockTaskManager(),
      aiManager: {
        getModelConfig: vi.fn().mockReturnValue({
          model: "gpt-4",
          fastModel: "gpt-3.5-turbo",
        }),
        getGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://api.openai.com/v1",
        }),
      } as unknown as ToolContext["aiManager"],
      aiService: {
        processWebContent: vi.fn().mockResolvedValue({
          content: "This is a summary of the web page.",
        }),
      } as unknown as ToolContext["aiService"],
    };
  });

  it("should use honest User-Agent header", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue("<html><body>Hello</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await webFetchTool.execute(
      { url: "https://ua-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "https://ua-test.example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent":
            "Wave-User (+https://github.com/netease-lcap/wave-agent)",
        }),
      }),
    );
  });

  it("should include Accept header", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue("<html><body>Hello</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await webFetchTool.execute(
      { url: "https://accept-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "https://accept-test.example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "text/markdown, text/html, */*",
        }),
      }),
    );
  });
});

describe("webFetchTool - content truncation", () => {
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    context = {
      workdir: "/test/workdir",
      taskManager: createMockTaskManager(),
      aiManager: {
        getModelConfig: vi.fn().mockReturnValue({
          model: "gpt-4",
          fastModel: "gpt-3.5-turbo",
        }),
        getGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://api.openai.com/v1",
        }),
      } as unknown as ToolContext["aiManager"],
      aiService: {
        processWebContent: vi
          .fn()
          .mockResolvedValue(({ content }: { content: string }) => ({
            content: content.substring(0, 50),
          })),
      } as unknown as ToolContext["aiService"],
    };
  });

  it("should keep script and style text out of the content sent to the model", async () => {
    const html =
      "<html><head><style>.x{color:red}</style></head><body>" +
      "<script>const appearance = 'dark';</script>" +
      "<p>Body text</p></body></html>";
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue(html),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await webFetchTool.execute(
      { url: "https://strip-test.example.com", prompt: "Summarize" },
      context,
    );

    const [{ content }] = vi.mocked(context.aiService!.processWebContent).mock
      .calls[0];

    expect(content).toContain("Body text");
    expect(content).not.toContain("appearance");
    expect(content).not.toContain("color:red");
  });
});

describe("webFetchTool - output enrichment", () => {
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    context = {
      workdir: "/test/workdir",
      taskManager: createMockTaskManager(),
      aiManager: {
        getModelConfig: vi.fn().mockReturnValue({
          model: "gpt-4",
          fastModel: "gpt-3.5-turbo",
        }),
        getGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://api.openai.com/v1",
        }),
      } as unknown as ToolContext["aiManager"],
      aiService: {
        processWebContent: vi.fn().mockResolvedValue({
          content: "Summary.",
        }),
      } as unknown as ToolContext["aiService"],
    };
  });

  it("should include status code and size in shortResult", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue("<html><body>Hello</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await webFetchTool.execute(
      { url: "https://output-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(result.shortResult).toBeDefined();
    expect(result.shortResult).toContain("200 OK");
    expect(result.shortResult).toMatch(/Received \d+[\w]+ \(200 OK\) from/);
  });
});

describe("webFetchTool - non-HTML responses", () => {
  const markdown = "# Title\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n";
  const json = '{\n  "users": [\n    { "id": 1 }\n  ]\n}\n';

  let context: ToolContext;

  function stubResponse(body: string, contentType?: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: vi.fn().mockResolvedValue(body),
        arrayBuffer: vi.fn().mockResolvedValue(Buffer.from(body)),
        headers: new Headers(
          contentType ? { "content-type": contentType } : {},
        ),
      }),
    );
  }

  function sentContent(): string {
    const [{ content }] = vi.mocked(context.aiService!.processWebContent).mock
      .calls[0];
    return content;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    context = {
      workdir: "/test/workdir",
      taskManager: createMockTaskManager(),
      aiManager: {
        getModelConfig: vi.fn().mockReturnValue({
          model: "gpt-4",
          fastModel: "gpt-3.5-turbo",
        }),
        getGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://api.openai.com/v1",
        }),
      } as unknown as ToolContext["aiManager"],
      aiService: {
        processWebContent: vi.fn().mockResolvedValue({ content: "Summary." }),
      } as unknown as ToolContext["aiService"],
    };
  });

  it("should pass markdown through untouched instead of parsing it as HTML", async () => {
    stubResponse(markdown, "text/markdown; charset=utf-8");

    await webFetchTool.execute(
      { url: "https://markdown-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(sentContent()).toBe(markdown);
  });

  it("should pass JSON through untouched", async () => {
    stubResponse(json, "application/json");

    await webFetchTool.execute(
      { url: "https://json-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(sentContent()).toBe(json);
  });

  it("should save binary content to a file instead of sending it to the model", async () => {
    stubResponse("\x89PNG\r\n\x1a\n binary", "image/png");

    const result = await webFetchTool.execute(
      { url: "https://binary-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      "Saved to: /tmp/wave-tool-results/webfetch_1.png",
    );
    expect(context.aiService!.processWebContent).not.toHaveBeenCalled();
  });

  it("should re-announce a cached binary file instead of downloading it again", async () => {
    stubResponse("\x89PNG\r\n\x1a\n binary", "image/png");
    const params = {
      url: "https://binary-cache-test.example.com",
      prompt: "Summarize",
    };

    const first = await webFetchTool.execute(params, context);
    vi.mocked(global.fetch).mockClear();
    const second = await webFetchTool.execute(params, context);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(second.content).toBe(first.content);
    expect(context.aiService!.processWebContent).not.toHaveBeenCalled();
  });

  it("should convert a body that looks like markup when no content type is sent", async () => {
    stubResponse("<html><body><h1>Hello World</h1></body></html>");

    await webFetchTool.execute(
      { url: "https://no-type-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(sentContent()).toContain("Hello World");
    expect(sentContent()).not.toContain("<h1>");
  });
});

describe("webFetchTool - long content read in intervals", () => {
  let context: ToolContext;

  /** A page is served as plain text so the interval boundaries are exact. */
  function stubPage(body: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: vi.fn().mockResolvedValue(body),
        headers: new Headers({ "content-type": "text/plain; charset=utf-8" }),
      }),
    );
  }

  function call(index: number): string {
    return vi.mocked(context.aiService!.processWebContent).mock.calls[index][0]
      .content;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    context = {
      workdir: "/test/workdir",
      taskManager: createMockTaskManager(),
      aiManager: {
        getModelConfig: vi.fn().mockReturnValue({
          model: "gpt-4",
          fastModel: "gpt-3.5-turbo",
        }),
        getGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://api.openai.com/v1",
        }),
      } as unknown as ToolContext["aiManager"],
      aiService: {
        processWebContent: vi
          .fn()
          .mockResolvedValueOnce({ content: "Answer about the interval." })
          .mockResolvedValueOnce({ content: "The overflow says X." }),
      } as unknown as ToolContext["aiService"],
    };
  });

  it("should answer from one interval and summarize the overflow", async () => {
    stubPage("A".repeat(100_000) + "B".repeat(50_000));

    const result = await webFetchTool.execute(
      { url: "https://long-page.example.com", prompt: "Summarize" },
      context,
    );

    const calls = vi.mocked(context.aiService!.processWebContent).mock.calls;
    expect(calls).toHaveLength(2);
    expect(call(0)).toHaveLength(100_000);
    expect(call(0)).not.toContain("B");
    expect(call(1)).toBe("B".repeat(50_000));

    expect(result.success).toBe(true);
    // Which characters the answer covers… and which it does not.
    expect(result.content).toContain("characters 0–100000 of 150000");
    expect(result.content).toContain("Answer about the interval.");
    expect(result.content).toContain(
      "Summary of characters 100000–150000 (not read verbatim)",
    );
    expect(result.content).toContain("The overflow says X.");
    expect(result.content).toContain("offset: 100000");
  });

  it("should not scale the number of model calls with page length", async () => {
    stubPage("x".repeat(240_000));

    await webFetchTool.execute(
      { url: "https://very-long-page.example.com", prompt: "Summarize" },
      context,
    );

    expect(context.aiService!.processWebContent).toHaveBeenCalledTimes(2);
    // Only one interval was previewed; the rest is reported as unread.
    expect(call(1)).toHaveLength(100_000);
  });

  it("should start reading from the requested offset", async () => {
    stubPage("A".repeat(100_000) + "B".repeat(100_000) + "C".repeat(40_000));

    const result = await webFetchTool.execute(
      {
        url: "https://offset-page.example.com",
        prompt: "Summarize",
        offset: 100_000,
      },
      context,
    );

    expect(call(0)).toBe("B".repeat(100_000));
    expect(result.content).toContain("characters 100000–200000 of 240000");
    expect(result.content).toContain("offset: 200000");
  });

  it("should report a past-the-end offset without calling the model", async () => {
    stubPage("short page");

    const result = await webFetchTool.execute(
      {
        url: "https://past-end-page.example.com",
        prompt: "Summarize",
        offset: 500,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("No content after offset 500");
    expect(result.content).toContain("10 characters long");
    expect(context.aiService!.processWebContent).not.toHaveBeenCalled();
  });

  it("should leave a page that fits in one interval untouched", async () => {
    stubPage("short page");

    const result = await webFetchTool.execute(
      { url: "https://short-page.example.com", prompt: "Summarize" },
      context,
    );

    expect(context.aiService!.processWebContent).toHaveBeenCalledTimes(1);
    expect(call(0)).toBe("short page");
    // No coverage banner, no summary block, no continuation hint.
    expect(result.content).toBe("Answer about the interval.");
  });

  it("should say the overflow went unread when its summary fails", async () => {
    vi.mocked(context.aiService!.processWebContent).mockReset();
    vi.mocked(context.aiService!.processWebContent)
      .mockResolvedValueOnce({ content: "Answer about the interval." })
      .mockRejectedValueOnce(new Error("model unavailable"));
    stubPage("A".repeat(120_000));

    const result = await webFetchTool.execute(
      { url: "https://failed-summary.example.com", prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Answer about the interval.");
    expect(result.content).toContain("Characters 100000–120000 were not read");
    expect(result.content).toContain("20000 characters went unread");
    expect(result.content).toContain("offset: 100000");
  });

  it("should serve an offset read from the cache without fetching again", async () => {
    stubPage("A".repeat(100_000) + "B".repeat(50_000));
    const url = "https://cached-offset-page.example.com";

    await webFetchTool.execute({ url, prompt: "Summarize" }, context);
    vi.mocked(global.fetch).mockClear();
    vi.mocked(context.aiService!.processWebContent).mockClear();
    vi.mocked(context.aiService!.processWebContent).mockResolvedValueOnce({
      content: "Answer about the tail.",
    });

    const result = await webFetchTool.execute(
      { url, prompt: "Summarize", offset: 100_000 },
      context,
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(call(0)).toBe("B".repeat(50_000));
    expect(result.content).toContain("Answer about the tail.");
  });
});
