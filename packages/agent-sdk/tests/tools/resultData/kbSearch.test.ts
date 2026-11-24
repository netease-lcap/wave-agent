import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../../src/services/authService.js", () => ({
  authService: {
    getServerUrl: vi.fn(),
    getSSOToken: vi.fn(),
  },
  createAuthAwareFetch: vi.fn((innerFetch: typeof fetch) => innerFetch),
}));

vi.mock("../../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { authService } from "../../../src/services/authService.js";
import { kbSearchTool } from "../../../src/tools/knowledgeBase/kbSearchTool.js";
import {
  renderKbSearchResultData,
  type KbSearchResultData,
} from "../../../src/tools/resultData/kbSearch.js";
import type { ToolContext } from "../../../src/tools/types.js";

/**
 * `kb_search` 的 `data → 文本` golden 断言（issue #3055 阶段 1）。
 *
 * 每个用例都真跑 `kbSearchTool.execute()`，只把网络（`fetch`）与登录态换成桩，然后
 * 断言两件事：`content` 等于**手写**的期望字面量，且 `renderKbSearchResultData(data)`
 * 逐字还回同一个 `content`。期望值不从 `result.content` 抄 —— 抄一遍只能证明渲染器
 * 和自己一致。
 *
 * 覆盖的分支（与 kbSearchTool.ts 产出 content 的地方一一对应）：命中列表、空结果、
 * 未登录、接口没部署、请求失败；另加「缺 query 直接拒」这条不产 content 的分支。
 */

const SERVER_URL = "https://server.test";

function makeContext(): ToolContext {
  return {
    workdir: "/test/workdir",
    sessionId: "test-session",
    permissionMode: "default",
  } as unknown as ToolContext;
}

/** 一条命中的默认值；`overrides` 用来摆出某一个具体场景。 */
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

/** 把 `fetch` 换成「这个状态码 + 这个 JSON」。 */
function stubReply(status: number, body: unknown): Mock {
  const impl = vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Internal Server Error",
      json: vi.fn().mockResolvedValue(body),
    } as Partial<Response>),
  );
  vi.stubGlobal("fetch", impl);
  return impl;
}

/** `data` 必须能逐字还原工具的 `content` —— 阶段 2 丢掉 `content` 的前提。 */
function expectRendersBack(result: { content: string; data?: unknown }): void {
  expect(renderKbSearchResultData(result.data as KbSearchResultData)).toBe(
    result.content,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(authService.getServerUrl).mockReturnValue(SERVER_URL);
  vi.mocked(authService.getSSOToken).mockReturnValue("token123");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kb_search 的 data → 文本 golden", () => {
  it("三条命中：地点行 + chunk_id + 片段，段落之间空一行", async () => {
    // 服务端原样回的那三个对象：`data.citations` 必须也是它们本身（宿主引用卡读
    // 原始字段，服务端多加的键要原样透传）。
    const serverHits = [
      hit(),
      hit({
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
    stubReply(200, { query: "婚假", count: 3, hits: serverHits });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.content).toBe(
      [
        "[1] 员工手册 · 假期制度 > 婚假（第 3 页）  chunk_id=chunk-1",
        "婚假申请流程：提前三个工作日提交。",
        "",
        "[2] 员工手册 · 假期制度 > 陪产假（第 4 页）  chunk_id=chunk-2",
        "陪产假 共 10 天。",
        "",
        "[3] 差旅制度  chunk_id=chunk-3  解析降级：emf_or_chart",
        "市内交通费实报实销。",
      ].join("\n"),
    );
    expect(result.data).toEqual({
      status: "ok",
      hits: [
        {
          chunkId: "chunk-1",
          docId: "doc-1",
          title: "员工手册",
          sectionPath: "假期制度 > 婚假",
          page: 3,
          score: 12.5,
          degraded: [],
          snippet: "婚假申请流程：提前三个工作日提交。",
        },
        {
          chunkId: "chunk-2",
          docId: "doc-1",
          title: "员工手册",
          sectionPath: "假期制度 > 陪产假",
          page: 4,
          score: 12.5,
          degraded: [],
          snippet: "陪产假\n\n共 10 天。",
        },
        {
          chunkId: "chunk-3",
          docId: "doc-2",
          title: "差旅制度",
          sectionPath: "",
          page: undefined,
          score: 12.5,
          degraded: ["emf_or_chart"],
          snippet: "市内交通费实报实销。",
        },
      ],
      citations: serverHits,
    });
    expectRendersBack(result);
  });

  it("sectionPath 以文档名开头时不重复打印文档名", async () => {
    stubReply(200, {
      hits: [hit({ sectionPath: "员工手册 > 假期制度 > 婚假" })],
    });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.content).toBe(
      "[1] 员工手册 > 假期制度 > 婚假（第 3 页）  chunk_id=chunk-1\n婚假申请流程：提前三个工作日提交。",
    );
    expectRendersBack(result);
  });

  it("一条都没命中：正文是一句结论，data 里是空数组", async () => {
    stubReply(200, { query: "婚假", count: 0, hits: [] });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.content).toBe("没有检索到相关内容");
    // 一条都没命中：`citations` 是空数组，不是缺键 —— 宿主据此知道「查过了」。
    expect(result.data).toEqual({ status: "ok", hits: [], citations: [] });
    expect(result.shortResult).toBe("未命中");
    expectRendersBack(result);
  });

  it("未登录：正文是那句固定的授权提示", async () => {
    stubReply(401, { error: "unauthorized" });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe("需要企业登录且是企业成员才能检索知识库");
    expect(result.data).toEqual({ status: "unauthorized" });
    expectRendersBack(result);
  });

  it("路由层 404：检索接口没部署，正文不是「库里没有」", async () => {
    stubReply(404, { error: "not_found" });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "知识库检索接口不可用，请确认服务端已部署知识库",
    );
    expect(result.data).toEqual({ status: "unavailable" });
    expectRendersBack(result);
  });

  it("请求失败：正文带上服务端的状态，error 只放那句原因", async () => {
    stubReply(503, { error: "boom" });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "知识库检索失败：the server returned HTTP 503 Internal Server Error",
    );
    expect(result.data).toEqual({
      status: "error",
      error: "the server returned HTTP 503 Internal Server Error",
    });
    expectRendersBack(result);
  });

  it("malformed 200：没有 hits 数组时按失败渲染", async () => {
    stubReply(200, { count: 1 });

    const result = await kbSearchTool.execute({ query: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "知识库检索失败：malformed response: no hits array",
    );
    expectRendersBack(result);
  });

  it("缺 query：没有正文，也没有 data（那句话在 error 里）", async () => {
    const fetchMock = stubReply(200, { hits: [] });

    const result = await kbSearchTool.execute({}, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toContain('missing required parameter "query"');
    expect(result.data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
