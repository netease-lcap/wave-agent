import { describe, it, expect } from "vitest";
import {
  pickQuotaHeaders,
  quotaHeadersFromError,
} from "../../src/utils/quotaHeaders.js";

/**
 * 额度头筛选（spec: docs/specs/desktop/desktop-account.md「额度响应头
 * x-codechat-quota-*」）：SDK 只按前缀挑出来、不做字段白名单，语义映射在桌面端
 * 宿主。这里只钉「挑哪些」与「什么时候算没有」。
 */
describe("pickQuotaHeaders", () => {
  it("挑出 Headers 里的额度头，键统一小写", () => {
    const headers = new Headers({
      "X-Codechat-Quota-Status": "allowed",
      "X-Codechat-Quota-Weekly-Used": "12",
      "content-type": "application/json",
    });
    expect(pickQuotaHeaders(headers)).toEqual({
      "x-codechat-quota-status": "allowed",
      "x-codechat-quota-weekly-used": "12",
    });
  });

  it("也接受已摊平的 Record（键大小写混写时归一）", () => {
    expect(
      pickQuotaHeaders({
        "x-codechat-quota-monthly-limit": "unlimited",
        "X-Codechat-Quota-Reason": "week",
        requestId: "abc",
      }),
    ).toEqual({
      "x-codechat-quota-monthly-limit": "unlimited",
      "x-codechat-quota-reason": "week",
    });
  });

  it("一个额度头都没有 → undefined（不更新、不请求，spec 场景 6）", () => {
    expect(
      pickQuotaHeaders(new Headers({ "content-type": "text/event-stream" })),
    ).toBeUndefined();
    expect(pickQuotaHeaders({})).toBeUndefined();
    expect(pickQuotaHeaders(undefined)).toBeUndefined();
    expect(pickQuotaHeaders(null)).toBeUndefined();
    expect(
      pickQuotaHeaders("x-codechat-quota-status: allowed"),
    ).toBeUndefined();
  });

  it("不因为前缀相近就误收（必须带完整前缀）", () => {
    expect(
      pickQuotaHeaders({ "x-codechat-quota": "allowed", "x-other": "1" }),
    ).toBeUndefined();
  });

  it("头值是空串也照收——「给了但为空」由消费方判为不可解析", () => {
    expect(pickQuotaHeaders({ "x-codechat-quota-weekly-used": "" })).toEqual({
      "x-codechat-quota-weekly-used": "",
    });
  });
});

describe("quotaHeadersFromError", () => {
  it("从 APIError.headers 取头（402 / 429 的错误响应同样带头，spec 场景 2）", () => {
    const error = Object.assign(new Error("blocked"), {
      headers: new Headers({ "x-codechat-quota-code": "USER_QUOTA_ZERO" }),
    });
    expect(quotaHeadersFromError(error)).toEqual({
      "x-codechat-quota-code": "USER_QUOTA_ZERO",
    });
  });

  it("错误上没有头 / 不是对象 → undefined", () => {
    expect(quotaHeadersFromError(new Error("boom"))).toBeUndefined();
    expect(quotaHeadersFromError(undefined)).toBeUndefined();
    expect(quotaHeadersFromError("boom")).toBeUndefined();
  });
});
