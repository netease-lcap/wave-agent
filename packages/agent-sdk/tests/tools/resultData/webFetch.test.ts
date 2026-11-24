import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import {
  renderWebFetchResultData,
  type WebFetchResultData,
} from "@/tools/resultData/webFetch.js";
import { webFetchTool } from "@/tools/webFetchTool.js";
import { isArtifactEnabled } from "@/services/artifactAvailability.js";
import { persistToolResultBuffer } from "@/utils/toolResultStorage.js";
import { authService } from "@/services/authService.js";
import type { ToolContext } from "@/tools/types.js";
import { createMockTaskManager } from "../../helpers/mockFactories.js";

/**
 * Golden 断言（issue #3055 阶段 1）：`WebFetch` 的 `data` 经它自己的渲染器还原出来
 * 的文本，必须与工具当场产出的 `content` 逐字相等。期望值全是手写的字面量——从
 * `content` 抄一遍只能证明两边用了同一个渲染器。
 *
 * 顺带钉住 `data` 的字段与含义，对齐 CC 的 outputSchema（`WebFetchTool.ts:32-45`）：
 * `bytes` 是抓回来那份内容的字节数（重定向分支 CC 取的是提示文本的字节数，
 * `:238`）、`code`/`codeText` 是 HTTP 状态、`result` 是模型侧看到的全部文本、
 * `durationMs` 是整个调用耗时、`url` 是这次请求的地址（`:243`）。
 */

// 抓取正文永不进 data —— 这几个用例只走拦截之外的普通抓取路径，artifact 那组自己
// 打开开关。
const BINARY_FILE = "/tmp/wave-tool-results/webfetch_1.png";

vi.mock("@/services/artifactAvailability.js", () => ({
  isArtifactEnabled: vi.fn(() => false),
}));

vi.mock("@/services/authService.js", () => ({
  authService: { getServerUrl: vi.fn() },
  createAuthAwareFetch: vi.fn((innerFetch: typeof fetch) => innerFetch),
}));

vi.mock("@/utils/toolResultStorage.js", () => ({
  getToolResultsDir: vi.fn(() => "/tmp/wave-tool-results"),
  persistToolResult: vi.fn(() => "/tmp/wave-tool-results/tool_1.txt"),
  persistToolResultBuffer: vi.fn(() => "/tmp/wave-tool-results/webfetch_1.png"),
  buildPersistedOutputMessage: vi.fn(
    (len: number, filePath: string) =>
      `<persisted-output>${len} -> ${filePath}`,
  ),
  generatePreview: vi.fn((content: string) => content.slice(0, 100)),
}));

function makeContext(): ToolContext {
  return {
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
}

/** 纯文本页：区间算术（`bytes`、offset 边界）才是精确的。 */
function stubPage(body: string): void {
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

function stubBinary(payload: string, contentType: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from(payload)),
      headers: new Headers({ "content-type": contentType }),
    }),
  );
}

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
function expectRendersBack(result: { content: string; data?: unknown }): void {
  expect(renderWebFetchResultData(result.data as WebFetchResultData)).toBe(
    result.content,
  );
}

describe("WebFetch data → 文本渲染器 golden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    (isArtifactEnabled as Mock).mockReturnValue(false);
  });

  it("整页一次读完：content 就是小模型的答案，data 是 CC 的六个字段", async () => {
    stubPage("short page");
    const context = makeContext();
    const url = "https://golden-web-fetch.example.com/short";

    const result = await webFetchTool.execute(
      { url, prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("Summary.");
    expect(result.data).toEqual({
      // "short page" 的字节数，不是答案的字节数。
      bytes: 10,
      code: 200,
      codeText: "OK",
      result: "Summary.",
      durationMs: expect.any(Number),
      url,
    });
    // 收起态那行照旧由 summarizer 给，不进 data。
    expect(result.shortResult).toBe(`Received 10B (200 OK) from ${url}`);
    expectRendersBack(result);
  });

  it("超出一次区间：data.result 是「区间说明 + 答案 + 溢出摘要 + 续读提示」整段", async () => {
    const url = "https://golden-web-fetch.example.com/chunked";
    stubPage("A".repeat(100_000) + "B".repeat(20_000));
    const context = makeContext();
    vi.mocked(context.aiService!.processWebContent)
      .mockResolvedValueOnce({ content: "Answer about the interval." })
      .mockResolvedValueOnce({ content: "The overflow says X." });

    const result = await webFetchTool.execute(
      { url, prompt: "Summarize" },
      context,
    );

    const expected =
      "Read characters 0–100000 of 120000 from " +
      `${url}. The answer below is based on that verbatim range only.` +
      "\n\nAnswer about the interval." +
      "\n\n--- Summary of characters 100000–120000 (not read verbatim) ---" +
      "\n\nThe overflow says X." +
      "\n\nThis page is not fully covered. To read further, call WebFetch again with the same url and offset: 100000.";
    expect(result.content).toBe(expected);
    expect(result.data).toEqual({
      bytes: 120_000,
      code: 200,
      codeText: "OK",
      result: expected,
      durationMs: expect.any(Number),
      url,
    });
    expectRendersBack(result);
  });

  it("offset 越过页尾：不是错误，data.result 就是那句说明", async () => {
    const url = "https://golden-web-fetch.example.com/past-end";
    stubPage("short page");
    const context = makeContext();

    const result = await webFetchTool.execute(
      { url, prompt: "Summarize", offset: 500 },
      context,
    );

    const expected =
      "No content after offset 500: the page's readable text is 10 characters long, so offsets 0–9 are the ones that read anything. Use offset 0 to read from the start.";
    expect(result.success).toBe(true);
    expect(result.content).toBe(expected);
    expect(result.data).toEqual({
      bytes: 10,
      code: 200,
      codeText: "OK",
      result: expected,
      durationMs: expect.any(Number),
      url,
    });
    expect(context.aiService!.processWebContent).not.toHaveBeenCalled();
    expectRendersBack(result);
  });

  it("跨主机重定向：bytes 是提示文本自己的字节数（CC 同样如此）", async () => {
    const url = "https://golden-web-fetch.example.com/moved";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 301,
        statusText: "Moved Permanently",
        headers: new Headers({
          location: "https://elsewhere.example.com/page",
        }),
      }),
    );

    const result = await webFetchTool.execute(
      { url, prompt: "Summarize" },
      makeContext(),
    );

    const expected =
      "REDIRECT_TO: https://elsewhere.example.com/page\n" +
      "The URL redirected to a different host. Please make a new WebFetch request with this redirect URL if you wish to continue.";
    expect(result.content).toBe(expected);
    expect(result.data).toEqual({
      bytes: 170,
      code: 301,
      codeText: "Moved Permanently",
      result: expected,
      durationMs: expect.any(Number),
      url,
    });
    expectRendersBack(result);
  });

  it("二进制：落盘提示整段进 result，bytes 是抓到的原始字节数", async () => {
    const url = "https://golden-web-fetch.example.com/logo";
    stubBinary("PNGDATA", "image/png");
    const context = makeContext();

    const result = await webFetchTool.execute(
      { url, prompt: "Summarize" },
      context,
    );

    const expected =
      "Fetched 200 OK — image/png, 7B of binary content.\n" +
      `Saved to: ${BINARY_FILE}\n` +
      "Read that file with the Read tool if you need its contents.";
    expect(result.content).toBe(expected);
    expect(result.data).toEqual({
      bytes: 7,
      code: 200,
      codeText: "OK",
      result: expected,
      durationMs: expect.any(Number),
      url,
    });
    expect(context.aiService!.processWebContent).not.toHaveBeenCalled();
    expectRendersBack(result);
  });

  it("二进制没落盘成功：只报大小，不给路径", async () => {
    const url = "https://golden-web-fetch.example.com/logo-unsaved";
    stubBinary("PNGDATA", "image/png");
    vi.mocked(persistToolResultBuffer).mockReturnValueOnce(undefined);

    const result = await webFetchTool.execute(
      { url, prompt: "Summarize" },
      makeContext(),
    );

    const expected =
      "Fetched image/png, 7B of binary content, but it could not be saved to a file.";
    expect(result.content).toBe(expected);
    expect(result.data).toEqual({
      bytes: 7,
      code: 200,
      codeText: "OK",
      result: expected,
      durationMs: expect.any(Number),
      url,
    });
    expectRendersBack(result);
  });

  it("整页没有可读文本：past-the-end 说「没什么可读的」", async () => {
    const url = "https://golden-web-fetch.example.com/empty";
    stubPage("");

    const result = await webFetchTool.execute(
      { url, prompt: "Summarize" },
      makeContext(),
    );

    const expected =
      "The page has no readable text, so there is nothing to read.";
    expect(result.success).toBe(true);
    expect(result.content).toBe(expected);
    expect(result.data).toEqual({
      bytes: 0,
      code: 200,
      codeText: "OK",
      result: expected,
      durationMs: expect.any(Number),
      url,
    });
    expectRendersBack(result);
  });

  it("命中缓存的二进制：重新播报同一个文件，不重新下载", async () => {
    const url = "https://golden-web-fetch.example.com/logo-cached";
    stubBinary("PNGDATA", "image/png");
    const context = makeContext();
    const params = { url, prompt: "Summarize" };

    await webFetchTool.execute(params, context);
    vi.mocked(global.fetch).mockClear();
    const second = await webFetchTool.execute(params, context);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(second.content).toBe(
      "Fetched 200 OK — image/png, 7B of binary content.\n" +
        `Saved to: ${BINARY_FILE}\n` +
        "Read that file with the Read tool if you need its contents.",
    );
    expect(second.data).toEqual({
      bytes: 7,
      code: 200,
      codeText: "OK",
      result: second.content,
      durationMs: expect.any(Number),
      url,
    });
    expectRendersBack(second);
  });

  it("artifact 拦截：走同一个 data 形状，bytes 是 artifact 自己的大小", async () => {
    (isArtifactEnabled as Mock).mockReturnValue(true);
    (authService.getServerUrl as Mock).mockReturnValue("https://server.test");
    const html = "<html><body><h1>T</h1></body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((rawUrl: string) => {
        if (rawUrl.includes("?via=model_read")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            json: vi.fn().mockResolvedValue({
              slug: "abc",
              version: "v3",
              contentUrl: "/api/frame/abc/content",
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: vi.fn().mockResolvedValue(html),
        });
      }),
    );
    const url = "https://server.test/code/artifact/abc";

    const result = await webFetchTool.execute(
      { url, prompt: "Summarize" },
      makeContext(),
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("Summary.");
    expect(result.data).toEqual({
      bytes: 36,
      code: 200,
      codeText: "OK",
      result: "Summary.",
      durationMs: expect.any(Number),
      url,
      // 这次走的是 artifact 读通道：slug + 页面版本（原来是
      // `ToolResult.metadata.artifactRead`）。
      artifactRead: { slug: "abc", ver: "v3" },
    });
    expectRendersBack(result);
  });
});
