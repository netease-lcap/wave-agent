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
import { kbSuggestTool } from "../../../src/tools/knowledgeBase/kbSuggestTool.js";
import {
  renderKbSuggestResultData,
  type KbSuggestResultData,
} from "../../../src/tools/resultData/kbSuggest.js";
import type { ToolContext } from "../../../src/tools/types.js";

/**
 * `kb_suggest` 的 `data → 文本` golden 断言（issue #3055 阶段 1）。
 *
 * 期望的 `content` 一律手写，不从 `result.content` 抄；每条用例都再断言一次
 * `renderKbSuggestResultData(data)` 逐字还回它。
 *
 * 覆盖的分支（与 kbSuggestTool.ts 产出 content 的地方一一对应）：给出相近词、
 * 没有相近词、未登录、接口没部署、请求失败；另加「缺 term 直接拒」那条不产
 * content 的分支。
 */

const SERVER_URL = "https://server.test";

function makeContext(): ToolContext {
  return {
    workdir: "/test/workdir",
    sessionId: "test-session",
    permissionMode: "default",
  } as unknown as ToolContext;
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
  expect(renderKbSuggestResultData(result.data as KbSuggestResultData)).toBe(
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

describe("kb_suggest 的 data → 文本 golden", () => {
  it("给出相近词：正文是「term」+ 用 ` · ` 拼起来的词表", async () => {
    stubReply(200, {
      term: "差旅",
      terms: ["差旅报销", "出差", "交通补贴"],
    });

    // 入参两边的空白在进 data 之前就被 trim 掉，正文与 data 用的是同一份。
    const result = await kbSuggestTool.execute(
      { term: " 差旅 " },
      makeContext(),
    );

    expect(result.content).toBe("「差旅」的相近词：差旅报销 · 出差 · 交通补贴");
    expect(result.data).toEqual({
      status: "ok",
      term: "差旅",
      terms: ["差旅报销", "出差", "交通补贴"],
    });
    expect(result.shortResult).toBe("相近词 3 个");
    expectRendersBack(result);
  });

  it("没有相近词：正文是一句结论，data 里是空数组", async () => {
    stubReply(200, { term: "婚假", terms: [] });

    const result = await kbSuggestTool.execute({ term: "婚假" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.content).toBe("没有找到「婚假」的相近词");
    expect(result.data).toEqual({ status: "ok", term: "婚假", terms: [] });
    expect(result.shortResult).toBe("没有相近词");
    expectRendersBack(result);
  });

  it("未登录：正文是那句固定的授权提示", async () => {
    stubReply(401, { error: "unauthorized" });

    const result = await kbSuggestTool.execute({ term: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe("需要企业登录且是企业成员才能检索知识库");
    expect(result.data).toEqual({ status: "unauthorized" });
    expectRendersBack(result);
  });

  it("路由层 404：相近词接口没部署", async () => {
    stubReply(404, { error: "not_found" });

    const result = await kbSuggestTool.execute({ term: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "知识库相近词接口不可用，请确认服务端已部署知识库",
    );
    expect(result.data).toEqual({ status: "unavailable" });
    expectRendersBack(result);
  });

  it("请求失败：正文带上服务端那句原因", async () => {
    stubReply(500, { error: "boom" });

    const result = await kbSuggestTool.execute({ term: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "知识库相近词查询失败：the server returned HTTP 500 Internal Server Error",
    );
    expect(result.data).toEqual({
      status: "error",
      error: "the server returned HTTP 500 Internal Server Error",
    });
    expectRendersBack(result);
  });

  it("malformed 200：没有 terms 数组时按失败渲染", async () => {
    stubReply(200, { term: "婚假" });

    const result = await kbSuggestTool.execute({ term: "婚假" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "知识库相近词查询失败：malformed response: no terms array",
    );
    expectRendersBack(result);
  });

  it("缺 term：没有正文，也没有 data（那句话在 error 里）", async () => {
    const fetchMock = stubReply(200, { terms: [] });

    const result = await kbSuggestTool.execute({}, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toContain('missing required parameter "term"');
    expect(result.data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
