import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  authService: {
    getServerUrl: vi.fn(),
    getSSOToken: vi.fn(),
  },
  createAuthAwareFetch: vi.fn((innerFetch: typeof fetch) => innerFetch),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { authService } from "../../src/services/authService.js";
import { kbSearchTool } from "../../src/tools/knowledgeBase/kbSearchTool.js";
import { kbGetDocTool } from "../../src/tools/knowledgeBase/kbGetDocTool.js";
import { kbSuggestTool } from "../../src/tools/knowledgeBase/kbSuggestTool.js";
import type { ToolContext } from "../../src/tools/types.js";

const SERVER_URL = "https://server.test";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workdir: "/test/workdir",
    sessionId: "test-session",
    permissionMode: "default",
    ...overrides,
  } as ToolContext;
}

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Internal Server Error",
    json: vi.fn().mockResolvedValue(body),
  };
}

/** Stub global fetch with a URL-routing mock; returns the mock for assertions. */
function stubFetchRoutes(
  routes: Array<{
    match: (url: string, init?: RequestInit) => boolean;
    respond: () => Partial<Response>;
  }>,
): Mock {
  const impl = vi.fn((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match(url, init));
    if (!route) throw new Error(`No mock route for ${url}`);
    return Promise.resolve(route.respond());
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function stubReply(path: string, status: number, body: unknown): Mock {
  return stubFetchRoutes([
    {
      match: (url) => url === `${SERVER_URL}${path}`,
      respond: () => jsonResponse(status, body),
    },
  ]);
}

function hit(overrides: Record<string, unknown> = {}) {
  return {
    title: "员工手册",
    docId: "doc-1",
    chunkId: "chunk-1",
    sectionPath: "假期制度 > 婚假",
    page: 3,
    snippet: "婚假申请流程：提前三个工作日提交。",
    score: 12.5,
    degraded: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  (authService.getServerUrl as Mock).mockReturnValue(SERVER_URL);
  (authService.getSSOToken as Mock).mockReturnValue("token123");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kb_search", () => {
  describe("config", () => {
    it("tells the model how to search, read on, and re-word", () => {
      const description = kbSearchTool.config.function.description ?? "";
      expect(description).toContain("enterprise knowledge base");
      expect(description).toContain("3-5 hits");
      expect(description).toContain("kb_get_doc");
      expect(description).toContain("kb_suggest");
      expect(description).toContain("empty result is an answer");
      expect(kbSearchTool.config.function.parameters?.required).toEqual([
        "query",
      ]);
    });

    it("formats the collapsed row with the query and top_k", () => {
      const context = makeContext();
      const compact = (params: Record<string, unknown>) =>
        kbSearchTool.formatCompactParams!(params, context);

      expect(compact({ query: "婚假", top_k: 5 })).toBe("「婚假」(top_k=5)");
      expect(compact({ query: "婚假" })).toBe("「婚假」");
    });
  });

  it("sends the query and the default limit, then renders each hit", async () => {
    const hits = [
      hit(),
      hit({
        title: "员工手册",
        docId: "doc-1",
        chunkId: "chunk-2",
        sectionPath: "假期制度 > 陪产假",
        page: 4,
        snippet: "陪产假\n\n共 10 天。",
      }),
      hit({
        title: "差旅制度",
        docId: "doc-2",
        chunkId: "chunk-3",
        sectionPath: "",
        page: undefined,
        snippet: "市内交通费实报实销。",
        degraded: ["emf_or_chart"],
      }),
    ];
    const fetchMock = stubReply("/api/kb/search", 200, {
      query: "婚假",
      count: 3,
      hits,
    });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SERVER_URL}/api/kb/search`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ query: "婚假", limit: 5 });

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      "[1] 员工手册 · 假期制度 > 婚假（第 3 页）  chunk_id=chunk-1",
    );
    expect(result.content).toContain("婚假申请流程：提前三个工作日提交。");
    // Newlines inside a snippet collapse onto its one line.
    expect(result.content).toContain(
      "[2] 员工手册 · 假期制度 > 陪产假（第 4 页）  chunk_id=chunk-2",
    );
    expect(result.content).toContain("陪产假 共 10 天。");
    // No section path and no page: the location line just ends after the title.
    expect(result.content).toContain("[3] 差旅制度  chunk_id=chunk-3");
    expect(result.content).toContain("解析降级：emf_or_chart");
    expect(result.content).not.toContain("undefined");
    expect(result.shortResult).toBe("命中 3 条 · 2 个文档");
    // Citations are the server's hits, untouched (the webview reads them).
    expect(result.metadata?.citations).toEqual(hits);
  });

  it("clamps top_k to the server's ceiling instead of round-tripping", async () => {
    const fetchMock = stubReply("/api/kb/search", 200, { hits: [] });

    await kbSearchTool.execute({ query: "婚假", top_k: 50 }, makeContext());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ query: "婚假", limit: 10 });
  });

  it("rejects a non-positive or non-integer top_k without a request", async () => {
    const fetchMock = stubFetchRoutes([]);
    for (const topK of [0, -1, 1.5, "5"]) {
      const result = await kbSearchTool.execute(
        { query: "婚假", top_k: topK },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("top_k must be a positive integer");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an empty result as a success the model can phrase", async () => {
    stubReply("/api/kb/search", 200, { query: "婚假", count: 0, hits: [] });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.content).toBe("没有检索到相关内容");
    expect(result.shortResult).toBe("未命中");
    expect(result.error).toBeUndefined();
  });

  it("reports an unauthenticated account", async () => {
    stubReply("/api/kb/search", 401, { error: "unauthorized" });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe("需要企业登录且是企业成员才能检索知识库");
  });

  it("reports a forbidden account the same way", async () => {
    stubReply("/api/kb/search", 403, { error: "forbidden" });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe("需要企业登录且是企业成员才能检索知识库");
  });

  it("retries a 5xx once before reporting it", async () => {
    const fetchMock = stubReply("/api/kb/search", 503, { error: "boom" });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.content).toContain("HTTP 503");
  });

  it("reports a malformed reply instead of a silent empty list", async () => {
    stubReply("/api/kb/search", 200, { count: 1 });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toContain("no hits array");
  });

  it("rejects a missing query without touching the network", async () => {
    const fetchMock = stubFetchRoutes([]);

    const result = await kbSearchTool.execute({}, makeContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain('missing required parameter "query"');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("kb_get_doc", () => {
  const doc = {
    chunkId: "chunk-1",
    docId: "doc-1",
    title: "员工手册",
    sectionPath: "假期制度 > 婚假",
    content: "婚假申请流程：提前三个工作日提交，直属主管审批后生效。",
    imageCaptions: ["流程图：婚假审批路径"],
    page: 3,
    blockType: "text",
    degraded: [],
  };

  it("reads one chunk by id and summarises it as title · section · characters", async () => {
    const fetchMock = stubReply("/api/kb/doc/chunk-1", 200, doc);

    const result = await kbGetDocTool.execute(
      { chunk_id: "chunk-1" },
      makeContext(),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SERVER_URL}/api/kb/doc/chunk-1`);
    expect(init.method).toBe("GET");

    expect(result.success).toBe(true);
    expect(result.content).toContain("员工手册 · 假期制度 > 婚假（第 3 页）");
    expect(result.content).toContain("chunk_id=chunk-1  doc_id=doc-1");
    expect(result.content).toContain("图片说明：流程图：婚假审批路径");
    expect(result.content).toContain(doc.content);
    expect(result.shortResult).toBe(
      `员工手册 · 假期制度 > 婚假 · ${doc.content.length} 字`,
    );
  });

  it("falls back to an untitled summary when the server sends no title", async () => {
    stubReply("/api/kb/doc/chunk-9", 200, {
      chunkId: "chunk-9",
      content: "正文",
    });

    const result = await kbGetDocTool.execute(
      { chunk_id: "chunk-9" },
      makeContext(),
    );

    expect(result.success).toBe(true);
    expect(result.shortResult).toBe("未命名文档 · 2 字");
  });

  it("reports a deleted or invisible chunk", async () => {
    stubReply("/api/kb/doc/gone", 404, { error: "not_found" });

    const result = await kbGetDocTool.execute(
      { chunk_id: "gone" },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("这个片段不存在或已删除");
  });

  it("reports an unauthenticated account", async () => {
    stubReply("/api/kb/doc/chunk-1", 401, { error: "unauthorized" });

    const result = await kbGetDocTool.execute(
      { chunk_id: "chunk-1" },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("需要企业登录且是企业成员才能检索知识库");
  });

  it("formats the collapsed row as the chunk id", () => {
    expect(
      kbGetDocTool.formatCompactParams!({ chunk_id: "chunk-1" }, makeContext()),
    ).toBe("chunk-1");
  });
});

describe("kb_suggest", () => {
  it("lists the corpus' own wording", async () => {
    const fetchMock = stubReply("/api/kb/suggest", 200, {
      term: "差旅",
      terms: ["差旅报销", "出差", "交通补贴"],
    });

    const result = await kbSuggestTool.execute({ term: "差旅" }, makeContext());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SERVER_URL}/api/kb/suggest`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ term: "差旅" });

    expect(result.success).toBe(true);
    expect(result.content).toBe("「差旅」的相近词：差旅报销 · 出差 · 交通补贴");
    expect(result.shortResult).toBe("相近词 3 个");
  });

  it("treats no variants as a success", async () => {
    stubReply("/api/kb/suggest", 200, { term: "婚假", terms: [] });

    const result = await kbSuggestTool.execute({ term: "婚假" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.content).toBe("没有找到「婚假」的相近词");
  });

  it("reports an unauthenticated account", async () => {
    stubReply("/api/kb/suggest", 401, { error: "unauthorized" });

    const result = await kbSuggestTool.execute({ term: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe("需要企业登录且是企业成员才能检索知识库");
  });

  it("formats the collapsed row with the term", () => {
    expect(
      kbSuggestTool.formatCompactParams!({ term: "差旅" }, makeContext()),
    ).toBe("「差旅」");
  });
});
