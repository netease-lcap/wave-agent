import { describe, it, expect, vi, beforeEach } from "vitest";
import { webFetchTool } from "../../src/tools/webFetchTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import { createMockTaskManager } from "../helpers/mockFactories.js";

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

  it("should reject GitHub URLs and suggest gh CLI", async () => {
    const result = await webFetchTool.execute(
      {
        url: "https://github.com/netease-lcap/wave-agent",
        prompt: "Summarize",
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("use the 'gh' CLI");
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

  it("should truncate markdown content exceeding MAX_MARKDOWN_LENGTH", async () => {
    const longHtml = "<html><body>" + "a".repeat(110000) + "</body></html>";
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue(longHtml),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await webFetchTool.execute(
      { url: "https://truncation-test.example.com", prompt: "Summarize" },
      context,
    );

    expect(context.aiService!.processWebContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          "[Content truncated at 100000 characters",
        ),
      }),
    );
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
