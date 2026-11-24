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
import { kbGetDocTool } from "../../../src/tools/knowledgeBase/kbGetDocTool.js";
import {
  renderKbGetDocResultData,
  type KbGetDocResultData,
} from "../../../src/tools/resultData/kbGetDoc.js";
import type { ToolContext } from "../../../src/tools/types.js";

/**
 * `kb_get_doc` 的 `data → 文本` golden 断言（issue #3055 阶段 1）。
 *
 * 期望的 `content` 一律手写，不从 `result.content` 抄。两个方向分开断：
 * - 失败分支（未登录 / 片段不存在 / 请求失败）：`renderKbGetDocResultData(data)`
 *   必须逐字还回 `content`。
 * - `status: "ok"`：正文是文档自己的全文，按「大字段不进 data」留在 `content` 里，
 *   所以渲染器**刻意**返回 `undefined` —— 这里断的就是这个 `undefined`，同时手写
 *   全文，证明正文一个字都没少（细节见 resultData/kbGetDoc.ts 的文件头）。
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
  expect(renderKbGetDocResultData(result.data as KbGetDocResultData)).toBe(
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

describe("kb_get_doc 的 data → 文本 golden", () => {
  it("读到一段：头部三行 + 空行 + 正文，正文全文就在 data.content 里", async () => {
    stubReply(200, {
      chunkId: "chunk-1",
      docId: "doc-1",
      title: "员工手册",
      sectionPath: "假期制度 > 婚假",
      page: 3,
      // 首尾空白在进正文之前就被 trim 掉（`chars` 也按 trim 后的长度算）。
      content: "  婚假提前三天申请。\n",
      imageCaptions: ["流程图：婚假审批路径"],
      blockType: "text",
      degraded: [],
    });

    const result = await kbGetDocTool.execute(
      { chunk_id: "chunk-1" },
      makeContext(),
    );

    expect(result.content).toBe(
      [
        "员工手册 · 假期制度 > 婚假（第 3 页）",
        "chunk_id=chunk-1  doc_id=doc-1",
        "图片说明：流程图：婚假审批路径",
        "",
        "婚假提前三天申请。",
      ].join("\n"),
    );
    expect(result.data).toEqual({
      status: "ok",
      chunkId: "chunk-1",
      docId: "doc-1",
      title: "员工手册",
      sectionPath: "假期制度 > 婚假",
      page: 3,
      degraded: [],
      imageCaptions: ["流程图：婚假审批路径"],
      chars: 9,
      // 文档全文（trim 之后的正文）：阶段 2 起它是 ok 分支正文的唯一来源。
      content: "婚假提前三天申请。",
    });
    expectRendersBack(result);
    expect(result.shortResult).toBe("员工手册 · 假期制度 > 婚假 · 9 字");
  });

  it("服务端没回 chunkId 时用入参兜底；解析降级是正文里的一行", async () => {
    stubReply(200, { content: "正文", degraded: ["emf_or_chart"] });

    const result = await kbGetDocTool.execute(
      { chunk_id: "chunk-9" },
      makeContext(),
    );

    expect(result.content).toBe(
      [
        "未命名文档",
        "chunk_id=chunk-9",
        "解析降级：emf_or_chart",
        "",
        "正文",
      ].join("\n"),
    );
    expect(result.data).toEqual({
      status: "ok",
      chunkId: "chunk-9",
      docId: undefined,
      title: undefined,
      sectionPath: undefined,
      page: undefined,
      degraded: ["emf_or_chart"],
      imageCaptions: undefined,
      chars: 2,
      content: "正文",
    });
    expectRendersBack(result);
  });

  it("片段不存在（404）：正文是一句提示，data 能逐字重建它", async () => {
    stubReply(404, { error: "not_found" });

    const result = await kbGetDocTool.execute(
      { chunk_id: "gone" },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("这个片段不存在或已删除");
    expect(result.data).toEqual({ status: "not_found" });
    expectRendersBack(result);
  });

  it("未登录：正文是那句固定的授权提示", async () => {
    stubReply(401, { error: "unauthorized" });

    const result = await kbGetDocTool.execute(
      { chunk_id: "chunk-1" },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("需要企业登录且是企业成员才能检索知识库");
    expect(result.data).toEqual({ status: "unauthorized" });
    expectRendersBack(result);
  });

  it("请求失败：正文带上服务端那句原因", async () => {
    stubReply(500, { error: "boom" });

    const result = await kbGetDocTool.execute(
      { chunk_id: "chunk-1" },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "知识库取全文失败：the server returned HTTP 500 Internal Server Error",
    );
    expect(result.data).toEqual({
      status: "error",
      error: "the server returned HTTP 500 Internal Server Error",
    });
    expectRendersBack(result);
  });

  it("malformed 200：没有 content 字符串时按失败渲染", async () => {
    stubReply(200, { chunkId: "chunk-1" });

    const result = await kbGetDocTool.execute(
      { chunk_id: "chunk-1" },
      makeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "知识库取全文失败：malformed response: no content",
    );
    expectRendersBack(result);
  });

  it("缺 chunk_id：没有正文，也没有 data（那句话在 error 里）", async () => {
    const fetchMock = stubReply(200, { content: "正文" });

    const result = await kbGetDocTool.execute({}, makeContext());

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toContain('missing required parameter "chunk_id"');
    expect(result.data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
