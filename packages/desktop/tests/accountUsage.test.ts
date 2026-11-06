import { describe, it, expect } from "vitest";
import { usageFromQuotaHeaders } from "../src/main/accountUsage";

/**
 * 额度响应头 → 账户卡片读数（spec: docs/specs/desktop/desktop-account.md
 * 「用量刷新时机」+「额度响应头 `x-codechat-quota-*`」）。
 *
 * 头名带完整前缀、值全是字符串：这里测的是**语义映射**，头的筛选在 SDK 侧
 * （`agent-sdk/tests/utils/quotaHeaders.test.ts`）。
 */
const H = {
  plan: {
    "x-codechat-quota-status": "allowed",
    "x-codechat-quota-claim": "weekly",
    "x-codechat-quota-weekly-used": "12",
    "x-codechat-quota-weekly-limit": "100",
    "x-codechat-quota-monthly-used": "120",
    "x-codechat-quota-monthly-limit": "1000",
    "x-codechat-quota-plan-expire": "2027-03-01",
  },
} as const;

describe("usageFromQuotaHeaders", () => {
  it("套餐可用（ok_plan）：两根条 + 到期日，api-* 没发就不带余额维度", () => {
    expect(usageFromQuotaHeaders({ ...H.plan }, {})).toEqual({
      billing: {
        mode: "plan",
        plan: {
          monthUsed: 120,
          monthLimit: 1000,
          weekUsed: 12,
          weekLimit: 100,
          expireDate: "2027-03-01",
        },
      },
    });
  });

  it("降级到 API 计费（ok_api）：mode=api + reason，plan 照旧", () => {
    const headers = {
      ...H.plan,
      "x-codechat-quota-status": "allowed_warning",
      "x-codechat-quota-reason": "week",
      "x-codechat-quota-api-status": "ok",
      "x-codechat-quota-api-used": "3.5",
      "x-codechat-quota-api-limit": "50",
    };
    expect(usageFromQuotaHeaders(headers, {})).toEqual({
      billing: {
        mode: "api",
        reason: "week",
        plan: {
          monthUsed: 120,
          monthLimit: 1000,
          weekUsed: 12,
          weekLimit: 100,
          expireDate: "2027-03-01",
        },
      },
      apiQuota: { limit: 50, used: 3.5 },
    });
  });

  it("套餐已到期（no_plan）：只带到期日，没有两根条", () => {
    const headers = {
      "x-codechat-quota-status": "allowed_warning",
      "x-codechat-quota-reason": "no_plan",
      "x-codechat-quota-plan-expire": "2025-01-01",
    };
    expect(usageFromQuotaHeaders(headers, {})).toEqual({
      billing: {
        mode: "api",
        reason: "no_plan",
        plan: { expireDate: "2025-01-01" },
      },
    });
  });

  it("被阻断（blocked）：按 code 出结论行，plan 四数丢弃（webview 不画条）", () => {
    const headers = {
      ...H.plan,
      "x-codechat-quota-status": "rejected",
      "x-codechat-quota-code": "USER_QUOTA_ZERO",
      "x-codechat-quota-api-status": "exhausted",
      "x-codechat-quota-api-used": "50",
      "x-codechat-quota-api-limit": "50",
    };
    expect(usageFromQuotaHeaders(headers, {})).toEqual({
      billing: { mode: "blocked", code: "USER_QUOTA_ZERO" },
      apiQuota: { limit: 50, used: 50 },
    });
  });

  it("status=rejected 而没有 code：仍然算 blocked（兜底文案由 webview 出）", () => {
    expect(
      usageFromQuotaHeaders({ "x-codechat-quota-status": "rejected" }, {})
        .billing,
    ).toEqual({ mode: "blocked", code: "" });
  });

  it("规格外的 reason / code 原样透传（不因「不认识」丢掉阻断事实）", () => {
    expect(
      usageFromQuotaHeaders(
        {
          "x-codechat-quota-status": "rejected",
          "x-codechat-quota-code": "NEW_CODE",
        },
        {},
      ).billing,
    ).toEqual({ mode: "blocked", code: "NEW_CODE" });
    expect(
      usageFromQuotaHeaders({ "x-codechat-quota-reason": "future_reason" }, {})
        .billing,
    ).toEqual({ mode: "api", reason: "future_reason", plan: null });
  });

  it("只有 api-* 三个头：只更新余额维度，billing 不下发（只下发余额形态）", () => {
    expect(
      usageFromQuotaHeaders(
        {
          "x-codechat-quota-api-status": "ok",
          "x-codechat-quota-api-used": "1.25",
          "x-codechat-quota-api-limit": "10",
        },
        {},
      ),
    ).toEqual({ apiQuota: { limit: 10, used: 1.25 } });
  });

  it("一个额度头都没有 → null（不更新、不请求，spec 场景 6）", () => {
    expect(
      usageFromQuotaHeaders({ "content-type": "application/json" }, {}),
    ).toBeNull();
    expect(usageFromQuotaHeaders({}, {})).toBeNull();
  });

  describe("limit 三态解码（spec 场景 7）", () => {
    it("unlimited → null（不限制，不画条）", () => {
      const headers = {
        ...H.plan,
        "x-codechat-quota-monthly-limit": "unlimited",
        "x-codechat-quota-weekly-limit": "unlimited",
      };
      expect(usageFromQuotaHeaders(headers, {}).billing).toEqual({
        mode: "plan",
        plan: {
          monthUsed: 120,
          monthLimit: null,
          weekUsed: 12,
          weekLimit: null,
          expireDate: "2027-03-01",
        },
      });
    });

    it("unavailable → 0（该维度不可用）", () => {
      const headers = {
        ...H.plan,
        "x-codechat-quota-monthly-limit": "unavailable",
      };
      expect(
        (
          usageFromQuotaHeaders(headers, {}).billing.plan as {
            monthLimit: unknown;
          }
        ).monthLimit,
      ).toBe(0);
    });

    it("api-limit 只有两态：unlimited → null、0 → 已用完（充值制）", () => {
      expect(
        usageFromQuotaHeaders(
          {
            "x-codechat-quota-api-limit": "unlimited",
            "x-codechat-quota-api-used": "2",
          },
          {},
        ).apiQuota,
      ).toEqual({ limit: null, used: 2 });
      expect(
        usageFromQuotaHeaders(
          {
            "x-codechat-quota-api-limit": "0",
            "x-codechat-quota-api-used": "0",
          },
          {},
        ).apiQuota,
      ).toEqual({ limit: 0, used: 0 });
    });
  });

  it("数值不可解析（非数字 / 负数 / 空串）当没给：不写 0，缺条的项不画条", () => {
    // 周用量被污染 ⇒ 四个数不齐 ⇒ 这条读数整体不可画；没有 reason / code 时
    // 连 billing 都不下发（调用方保留旧值），绝不把健康账号渲染成「已用尽」。
    expect(
      usageFromQuotaHeaders(
        { ...H.plan, "x-codechat-quota-weekly-used": "abc" },
        {},
      ).billing,
    ).toBeUndefined();
    expect(
      usageFromQuotaHeaders({ "x-codechat-quota-api-limit": "-1" }, {})
        .apiQuota,
    ).toBeUndefined();
    expect(
      usageFromQuotaHeaders({ "x-codechat-quota-api-limit": "" }, {}).apiQuota,
    ).toBeUndefined();
  });

  it("api-* 缺省时保留上次余额（别把正看余额维度的用户挤掉，spec 场景 8）", () => {
    const prev = { apiQuota: { limit: 20, used: 5 } };
    expect(usageFromQuotaHeaders({ ...H.plan }, prev).apiQuota).toBeUndefined();
    // 「保留」由调用方做（`{ ...prev, ...patch }`），这里只保证不下发清空值；
    // 但 api-limit 给了而 api-used 缺时，用上次的 used 补上。
    expect(
      usageFromQuotaHeaders({ "x-codechat-quota-api-limit": "20" }, prev)
        .apiQuota,
    ).toEqual({ limit: 20, used: 5 });
  });
});
