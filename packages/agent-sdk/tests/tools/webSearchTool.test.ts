import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  authService: {
    getServerUrl: vi.fn(),
    getSSOToken: vi.fn(),
  },
  createAuthAwareFetch: vi.fn((innerFetch: typeof fetch) => innerFetch),
}));

/**
 * The explicit switch. Pinned here (and only here) so every case below still
 * exercises the real 404 memo and the real request path; `settingsSwitch.enabled
 * = false` is how the disabled case reaches `execute`.
 */
const settingsSwitch = vi.hoisted(() => ({ enabled: true }));

vi.mock(
  "../../src/services/webSearchAvailability.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/services/webSearchAvailability.js")
      >();
    return {
      ...actual,
      isWebSearchEnabledBySettings: () => settingsSwitch.enabled,
    };
  },
);

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  authService,
  createAuthAwareFetch,
} from "../../src/services/authService.js";
import {
  __resetWebSearchAvailabilityForTesting,
  isWebSearchAvailable,
} from "../../src/services/webSearchAvailability.js";
import { logger } from "../../src/utils/globalLogger.js";
import { webSearchTool } from "../../src/tools/webSearchTool.js";
import { renderToolResultData } from "../../src/tools/resultData/index.js";
import type { ToolContext } from "../../src/tools/types.js";

const SERVER_URL = "https://server.test";
const ENDPOINT = `${SERVER_URL}/api/v1/web-search`;

/** CC 的固定结尾（`1022-211817B-D3o.js:2805-2806`）。 */
const REMINDER =
  "REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workdir: "/test/workdir",
    sessionId: "test-session",
    permissionMode: "default",
    toolManager: { unregister: vi.fn() },
    ...overrides,
  } as unknown as ToolContext;
}

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: vi.fn().mockResolvedValue(body),
  };
}

/** Stub global fetch; returns the mock so a test can read the request it got. */
function stubFetch(...responses: Array<Partial<Response> | Error>): Mock {
  const impl = vi.fn(() => {
    const next = responses.length > 1 ? responses.shift()! : responses[0];
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function bodyOf(mock: Mock, call = 0): Record<string, unknown> {
  const init = mock.mock.calls[call][1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

/** One 200 body in the contract's shape (`results` is always length 1). */
function searchBody({
  query = "typescript 5.4 release",
  content = [
    {
      title: "TypeScript 5.4",
      url: "https://devblogs.example/ts-54",
      snippet: "TypeScript 5.4 ships NoInfer and preserved narrowing.",
    },
  ] as Array<Record<string, unknown>>,
  leftOut = 0,
} = {}) {
  return {
    query,
    results: [{ tool_use_id: "ws_ab12cd34ef56", content }],
    durationSeconds: 1.23,
    searchCount: 1,
    leftOut,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  __resetWebSearchAvailabilityForTesting();
  settingsSwitch.enabled = true;
  (authService.getServerUrl as Mock).mockReturnValue(SERVER_URL);
  (authService.getSSOToken as Mock).mockReturnValue("token123");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebSearch 的声明", () => {
  it("入参逐字照 CC：query 最短 2 字，两个域名名单可选", () => {
    const parameters = webSearchTool.config.function.parameters as Record<
      string,
      any
    >;
    expect(parameters.required).toEqual(["query"]);
    expect(parameters.properties.query).toMatchObject({
      type: "string",
      minLength: 2,
      description: "The search query to use",
    });
    expect(parameters.properties.allowed_domains).toMatchObject({
      type: "array",
      items: { type: "string" },
      description: "Only include search results from these domains",
    });
    expect(parameters.properties.blocked_domains).toMatchObject({
      type: "array",
      items: { type: "string" },
      description: "Never include search results from these domains",
    });
  });

  it("描述说清只给标题 + 链接、正文走 WebFetch", () => {
    const description = webSearchTool.config.function.description ?? "";
    expect(description).toContain("no page text");
    expect(description).toContain("WebFetch");
    expect(description).toContain("knowledge cutoff");
    expect(description).toContain("Sources:");
  });

  it("与 WebFetch 同档：进 REPL 按需池而不是摊平", () => {
    expect(webSearchTool.defer).toBe(true);
    expect(webSearchTool.searchHint).toContain("search the web");
    // REPL 的签名渲染读它（spec core/repl-tool.md「公告分档呈现」）。
    expect(webSearchTool.outputSchema).toBeTypeOf("object");
  });

  it("折叠行显示 query 与域名名单", () => {
    const context = makeContext();
    const compact = (params: Record<string, unknown>) =>
      webSearchTool.formatCompactParams!(params, context);
    expect(compact({ query: " typescript 5.4 " })).toBe("「typescript 5.4」");
    expect(compact({ query: "nextjs", allowed_domains: ["nextjs.org"] })).toBe(
      "「nextjs」 仅 nextjs.org",
    );
    expect(
      compact({ query: "nextjs", blocked_domains: ["a.com", "b.com"] }),
    ).toBe("「nextjs」 排除 a.com、b.com");
  });
});

describe("WebSearch 的请求", () => {
  it("配置关掉时直接说「已关闭」，一个请求都不发", async () => {
    settingsSwitch.enabled = false;
    const fetchMock = stubFetch(jsonResponse(200, searchBody()));

    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.data).toEqual({ status: "disabled" });
    expect(result.content).toContain("turned off in settings");
    // 与 404 那句分开：把人支去查服务端的 WEB_SEARCH_ENABLED 是另一个方向。
    expect(result.content).not.toContain("not available on this server");
  });

  it("POST 到 {serverUrl}/api/v1/web-search，请求体只有 query", async () => {
    const fetchMock = stubFetch(jsonResponse(200, searchBody()));
    const context = makeContext();

    await webSearchTool.execute({ query: "typescript 5.4 release" }, context);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(ENDPOINT);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(bodyOf(fetchMock)).toEqual({ query: "typescript 5.4 release" });
    // 鉴权只走仓内既有的 login-aware 通道，不新造凭证类型。
    expect(createAuthAwareFetch).toHaveBeenCalledWith(globalThis.fetch);
  });

  it("域名名单原样透传（服务端负责拼 site: 语法与硬过滤）", async () => {
    const fetchMock = stubFetch(jsonResponse(200, searchBody()));
    await webSearchTool.execute(
      { query: "release notes", allowed_domains: ["nodejs.org"] },
      makeContext(),
    );
    expect(bodyOf(fetchMock)).toEqual({
      query: "release notes",
      allowed_domains: ["nodejs.org"],
    });
  });

  it("两个名单同时给：本地就拒，一个请求都不发（CC 的 validateInput 同款）", async () => {
    const fetchMock = stubFetch(jsonResponse(200, searchBody()));
    const result = await webSearchTool.execute(
      {
        query: "release notes",
        allowed_domains: ["nodejs.org"],
        blocked_domains: ["spam.example"],
      },
      makeContext(),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.content).toContain(
      "Cannot specify both allowed_domains and blocked_domains in the same request",
    );
  });

  it("缺 query 直接报错，不发请求", async () => {
    const fetchMock = stubFetch(jsonResponse(200, searchBody()));
    const result = await webSearchTool.execute({}, makeContext());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain("query");
  });
});

describe("WebSearch 拼给模型的文本", () => {
  it("正常命中：与 CC 逐字一致（含 JSON 数组的 Links 与固定结尾）", async () => {
    stubFetch(jsonResponse(200, searchBody()));
    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );

    expect(result.success).toBe(true);
    // CC 在 Links 块与 reminder 之间实际是两个空行（`Links: …\n\n` 再 `+ "\nREMINDER…"`）。
    expect(result.content).toBe(
      [
        'Web search results for query: "typescript 5.4 release"',
        "",
        'Links: [{"title":"TypeScript 5.4","url":"https://devblogs.example/ts-54"}]',
        "",
        "",
        REMINDER,
      ].join("\n"),
    );
    expect(result.shortResult).toBe("1 个结果");
  });

  it("snippet 只进 data，不进模型读到的文本", async () => {
    stubFetch(jsonResponse(200, searchBody()));
    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );

    const snippet = "TypeScript 5.4 ships NoInfer and preserved narrowing.";
    expect(result.content).not.toContain(snippet);
    // 但结构化载荷里留着：宿主 UI 与 PostToolUse hook 要它。
    const data = result.data as { results: Array<{ snippet?: string }> };
    expect(data.results[0].snippet).toBe(snippet);
  });

  it("空组（搜了但没命中）输出 No links found.，不是失败", async () => {
    stubFetch(jsonResponse(200, searchBody({ content: [] })));
    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe(
      [
        'Web search results for query: "typescript 5.4 release"',
        "",
        "No links found.",
        "",
        "",
        REMINDER,
      ].join("\n"),
    );
    expect(result.shortResult).toBe("没有结果");
  });

  it("leftOut 在 Links 之后、REMINDER 之前补一句（单数/复数跟着数）", async () => {
    stubFetch(
      jsonResponse(200, searchBody({ leftOut: 2 })),
      jsonResponse(
        200,
        searchBody({
          content: [{ title: "Only hit", url: "https://a.example/1" }],
          leftOut: 1,
        }),
      ),
    );

    const two = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );
    expect(two.content).toContain(
      "2 results left out by allowed_domains or blocked_domains.",
    );
    expect(two.content.indexOf("left out")).toBeGreaterThan(
      two.content.indexOf("Links:"),
    );
    expect(two.content.indexOf("left out")).toBeLessThan(
      two.content.indexOf("REMINDER:"),
    );
    expect(two.shortResult).toBe("1 个结果 · 过滤掉 2 条");

    const one = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );
    expect(one.content).toContain(
      "1 result left out by allowed_domains or blocked_domains.",
    );
  });

  it("渲染器与工具自己交付的 content 是同一份（data 是唯一真相）", async () => {
    stubFetch(jsonResponse(200, searchBody()));
    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );
    expect(renderToolResultData("WebSearch", result.data)).toBe(result.content);
  });
});

describe("WebSearch 的失败分档", () => {
  it("429：文本是 CC 同形的 `Web search error: <code>`，不当成没搜到", async () => {
    stubFetch(
      jsonResponse(429, {
        error: {
          code: "WEB_SEARCH_RATE_LIMITED",
          message: "quota exhausted, resets at 2026-11-25T11:00:00Z",
        },
      }),
    );
    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );

    expect(result.success).toBe(false);
    // 逐字照 CC（`:2275`）：冒号后只有错误码，没有散文、没有服务端 message。
    expect(result.content).toBe("Web search error: WEB_SEARCH_RATE_LIMITED");
    expect(result.content).not.toContain("No links found.");
  });

  it("504：文本是 CC 同形的错误码，且不重试", async () => {
    const fetchMock = stubFetch(
      jsonResponse(504, { error: { code: "WEB_SEARCH_TIMEOUT" } }),
    );
    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("Web search error: WEB_SEARCH_TIMEOUT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("400：只回错误码让模型改参数，且不重试", async () => {
    const fetchMock = stubFetch(
      jsonResponse(400, {
        error: { code: "WEB_SEARCH_INVALID_QUERY", message: "query too long" },
      }),
    );
    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("Web search error: WEB_SEARCH_INVALID_QUERY");
    // 服务端 message 只进日志：模型可见文本只有 code。
    expect(result.content).not.toContain("query too long");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const data = result.data as { status: string; errorCode?: string };
    expect(data.status).toBe("error");
    expect(data.errorCode).toBe("WEB_SEARCH_INVALID_QUERY");
  });

  it("服务端 message 是中文时不进模型可见文本，只进日志", async () => {
    stubFetch(
      jsonResponse(400, {
        error: {
          code: "WEB_SEARCH_INVALID_QUERY",
          message: "query 长度必须是 2~128 个字符（当前 1 个）",
        },
      }),
    );
    const result = await webSearchTool.execute({ query: "a" }, makeContext());

    expect(result.success).toBe(false);
    // 冒号后只有 code：服务端中文 message 一个字都不出现（否则就是中英混排）。
    expect(result.content).toBe("Web search error: WEB_SEARCH_INVALID_QUERY");
    expect(result.content).not.toMatch(/[\u4e00-\u9fff]/);
    // 运维照样能从日志里读到那句中文。
    expect(logger.warn).toHaveBeenCalledWith(
      "Web search rejected",
      expect.objectContaining({
        status: 400,
        code: "WEB_SEARCH_INVALID_QUERY",
        serverMessage: "query 长度必须是 2~128 个字符（当前 1 个）",
      }),
    );
  });

  it("503：按仓内既有口径重试 1 次，仍失败则报暂时不可用", async () => {
    const fetchMock = stubFetch(
      jsonResponse(503, { error: { code: "WEB_SEARCH_UNAVAILABLE" } }),
      jsonResponse(503, { error: { code: "WEB_SEARCH_UNAVAILABLE" } }),
    );
    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.content).toBe("Web search error: WEB_SEARCH_UNAVAILABLE");
  });

  it("401 / 403：指向登录与企业授权，而不是重试", async () => {
    stubFetch(jsonResponse(401, { error: { code: "UNAUTHORIZED" } }));
    const unauthorized = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );
    expect(unauthorized.success).toBe(false);
    expect(unauthorized.content).toContain("/login");

    vi.unstubAllGlobals();
    stubFetch(jsonResponse(403, { error: { code: "LICENSE_EXPIRED" } }));
    const forbidden = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );
    expect(forbidden.success).toBe(false);
    expect(forbidden.content).toContain("license");
  });

  it("200 但 results 不是数组：报响应畸形，不当空结果", async () => {
    stubFetch(jsonResponse(200, { results: "nope" }));
    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("malformed");
    expect(result.content).not.toContain("No links found.");
  });

  it("客户端 15 秒超时：放弃并说清，不重试", async () => {
    const timeout = Object.assign(new Error("The operation timed out."), {
      name: "TimeoutError",
    });
    const fetchMock = stubFetch(timeout);
    const result = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      makeContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.content).toContain("15 seconds");
  });
});

describe("WebSearch 撞到 404（本部署没有这个能力）", () => {
  it("记下判定、把自己摘掉，之后一个请求都不再发", async () => {
    const fetchMock = stubFetch(jsonResponse(404, {}));
    const unregister = vi.fn();
    const context = makeContext({
      toolManager: { unregister } as unknown as ToolContext["toolManager"],
    });

    const first = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      context,
    );
    expect(first.success).toBe(false);
    expect(first.content).toContain("not available on this server");
    expect(unregister).toHaveBeenCalledWith("WebSearch");
    expect(isWebSearchAvailable()).toBe(false);

    // 停止探测：脚本里可能还捏着 unregister 之前的插件引用。
    const second = await webSearchTool.execute(
      { query: "typescript 5.4 release" },
      context,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.success).toBe(false);
    expect(second.content).toBe(first.content);
  });
});
