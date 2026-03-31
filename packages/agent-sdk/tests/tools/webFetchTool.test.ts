import { describe, it, expect, vi, beforeEach } from "vitest";
import { webFetchTool } from "../../src/tools/webFetchTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import { createMockTaskManager } from "../helpers/mockFactories.js";

describe("webFetchTool", () => {
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
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
      text: vi.fn().mockResolvedValue("<html><body><h1>Hello World</h1></body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await webFetchTool.execute(
      {
        url: "https://example.com",
        prompt: "Summarize this page",
      },
      context
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("This is a summary of the web page.");
    expect(global.fetch).toHaveBeenCalledWith("https://example.com", expect.any(Object));
    expect(context.aiService!.processWebContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-3.5-turbo",
      content: expect.stringContaining("Hello World"),
      prompt: "Summarize this page",
    }));
  });

  it("should upgrade HTTP to HTTPS", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue("<html><body>Hello</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await webFetchTool.execute(
      {
        url: "http://http-test.com",
        prompt: "Summarize",
      },
      context
    );

    expect(global.fetch).toHaveBeenCalledWith("https://http-test.com", expect.any(Object));
  });

  it("should handle redirects to different hosts", async () => {
    const mockResponse = {
      status: 301,
      headers: new Headers({ location: "https://other.com/page" }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await webFetchTool.execute(
      {
        url: "https://redirect-test.com",
        prompt: "Summarize",
      },
      context
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
      context
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("use the 'gh' CLI");
  });

  it("should use cache for repeated requests", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue("<html><body>Cached Content</body></html>"),
      headers: new Headers(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    // First request
    await webFetchTool.execute(
      {
        url: "https://cache-test.com",
        prompt: "Summarize",
      },
      context
    );

    // Second request
    await webFetchTool.execute(
      {
        url: "https://cache-test.com",
        prompt: "Summarize again",
      },
      context
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
