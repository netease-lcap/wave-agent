/**
 * 额度响应头 → 账户卡片读数（spec: docs/specs/desktop/desktop-account.md
 * 「额度响应头 `x-codechat-quota-*`」）。
 *
 * codechat 的 proxy 在**每次模型调用**的响应上带一组 `x-codechat-quota-*`，数字就是
 * 闸口那一次 `getBillingVerdict` 的结果（零额外查询）。SDK 只按前缀把它们挑出来
 * （`agent-sdk/src/utils/quotaHeaders.ts`），**映射在这里做一次**——webview 认的是
 * 既有 `AccountBillingInfo` / `AccountApiQuotaInfo` 契约，不必知道头的存在。
 *
 * 口径（都是 spec 里的硬要求）：
 * - **一个头都没有 → 返回 null**：这次没有新信息，宿主不更新、也不额外查账户接口
 *   （私有化部署 / 自定义网关 / 中间层剥掉自定义头都落在这里）。
 * - **只更新头里真给了的字段**：缺的字段保留上次值。尤其 `api-*` 三个头只在判定
 *   走 API 时才发（`ok_plan` 路径不查 `api_quotas`，没有数字可发），若按「没有就清空」
 *   处理，正停在余额维度的用户会被下一次套餐计费调用的响应把余额行挤掉。
 * - **值不可解析就当没给**（不写成 0）：把健康的账号渲染成「已用尽」比不更新更糟。
 * - **头是「本次调用前」的快照**（流式在首字节前发出、扣费在流结束后）：这里不推算、
 *   不补偿，下一次调用会自己补上差异。
 */

import type {
  AccountApiQuotaInfo,
  AccountBillingCode,
  AccountBillingDegradeReason,
  AccountBillingInfo,
  AccountBillingPlanUsage,
} from "wave-webview-fixtures";

const PREFIX = "x-codechat-quota-";

/** 账户卡片当前展示的用量读数（与 desktopHost.accountCache 的对应字段同形）。 */
export interface AccountUsageSnapshot {
  billing?: AccountBillingInfo | null;
  apiQuota?: AccountApiQuotaInfo | null;
}

function readHeader(
  headers: Record<string, string>,
  field: string,
): string | undefined {
  const value = headers[PREFIX + field];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 非负数字；不可解析（非数字 / 负数 / `NaN`）→ undefined（= 这次没给）。 */
function readNumber(
  headers: Record<string, string>,
  field: string,
): number | undefined {
  const raw = readHeader(headers, field);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * 套餐侧限额的三态编码：`unlimited` → `null`（不限制）、`unavailable` → `0`
 * （该维度不可用）、数字原样。API 侧只有两态（充值制，`0` 就是已用完），
 * 但同一个解码在这里也适用：服务端不会给 API 发 `unavailable`。
 */
function readLimit(
  headers: Record<string, string>,
  field: string,
): number | null | undefined {
  const raw = readHeader(headers, field);
  if (raw === undefined) return undefined;
  if (raw === "unlimited") return null;
  if (raw === "unavailable") return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 两根条的四个数齐 + 到期日才构成可画条的套餐用量（缺一个就不画条）。 */
function readPlanUsage(
  headers: Record<string, string>,
): AccountBillingPlanUsage | undefined {
  const monthUsed = readNumber(headers, "monthly-used");
  const monthLimit = readLimit(headers, "monthly-limit");
  const weekUsed = readNumber(headers, "weekly-used");
  const weekLimit = readLimit(headers, "weekly-limit");
  const expireDate = readHeader(headers, "plan-expire");
  if (
    monthUsed === undefined ||
    monthLimit === undefined ||
    weekUsed === undefined ||
    weekLimit === undefined ||
    expireDate === undefined
  ) {
    return undefined;
  }
  // 两个窗口的重置时刻（unix 秒）是**可选**的：缺了只是条上不弹「多久后重置」的气泡，
  // 不影响两条的渲染 —— 所以不参与上面那道「齐了才画」的判断。
  const weekResetAt = readNumber(headers, "weekly-reset");
  const monthResetAt = readNumber(headers, "monthly-reset");
  return {
    monthUsed,
    monthLimit,
    weekUsed,
    weekLimit,
    expireDate,
    ...(weekResetAt !== undefined ? { weekResetAt } : {}),
    ...(monthResetAt !== undefined ? { monthResetAt } : {}),
  };
}

/**
 * 头集合 → `billing` / `apiQuota` 补丁。`prev` 只用来保留头里没给的字段
 * （`api-*` 缺省时的旧读数、`blocked` 缺省时的旧套餐事实）。一个额度头都没有 → `null`。
 */
export function usageFromQuotaHeaders(
  headers: Record<string, string>,
  prev: AccountUsageSnapshot,
): AccountUsageSnapshot | null {
  const hasAny = Object.keys(headers).some(
    (key) =>
      key.toLowerCase().startsWith(PREFIX) && typeof headers[key] === "string",
  );
  if (!hasAny) return null;

  const out: AccountUsageSnapshot = {};
  const planUsage = readPlanUsage(headers);
  // 无生效套餐（或只剩已到期订单）时服务端不发两根条，只发到期日。
  const expireDate = readHeader(headers, "plan-expire");
  const plan: AccountBillingPlanUsage | { expireDate: string } | null =
    planUsage ?? (expireDate !== undefined ? { expireDate } : null);

  const code = readHeader(headers, "code");
  const reason = readHeader(headers, "reason");
  const rejected = readHeader(headers, "status") === "rejected";

  if (code !== undefined || rejected) {
    // 未识别的 `code` 原样透传：webview 对规格外取值有兜底文案（spec 场景 23），
    // 这里不能因为「客户端不认识」就丢掉「已被阻断」这件事。
    //
    // 套餐事实照带（2026-11-27，缺陷单 3525819196034816）：这一态服务端也会发同一组
    // `plan-*` 字段（四数 = 套餐触顶，只有到期日 = 只剩已到期订单）。webview 的套餐维度
    // 据此说套餐的话，不再借用 402 的积分文案。头里一个套餐字段都没有（从未购买 / 订单
    // 全部作废）⇒ 沿用上一次已知的 plan（与 `api-*` 缺省沿用旧读数同一算法），已知也没有
    // 才不带这个键（契约里 `plan` 可选，老服务端形态）。
    const knownPlan = plan ?? prev.billing?.plan ?? null;
    out.billing = {
      mode: "blocked",
      code: (code ?? "") as AccountBillingCode,
      ...(knownPlan !== null ? { plan: knownPlan } : {}),
    };
  } else if (reason !== undefined) {
    out.billing = {
      mode: "api",
      reason: reason as AccountBillingDegradeReason,
      plan,
    };
  } else if (planUsage) {
    out.billing = { mode: "plan", plan: planUsage };
  }
  // 无 reason / 无 code / 无两根条（只有 api-*）：`billing` 不下发，webview 走
  // 「只下发余额维度」形态；两侧都没有时由 webview 判双缺（私有化）。

  // `api-*` 只在判定走 API 时才发（`ok_plan` 路径不查 `api_quotas`）；缺省就保留
  // 上次已知的余额维度，不清空（spec 场景 8）。`api-limit` 是该维度的定义字段：
  // 没有它就没有「限额」可渲染，此时连 `api-used` 一起忽略，不把默认值编成
  // `null`（那会被读成「不限额」）。
  const apiLimit = readLimit(headers, "api-limit");
  if (apiLimit !== undefined) {
    const apiUsed = readNumber(headers, "api-used");
    // `scope` 不在头里（`x-codechat-quota-api-*` 只给数），但它决定余额维度读「部门
    // 剩余积分」还是「个人剩余积分」：整体重建 `apiQuota` 会让部门企业在一次模型调用
    // 后把标签退回个人（数字还是部门共享的，文案却说是自己的）。故沿用上次已知值，
    // 已知也没有就不带这个键（老服务端形态，读侧按 `"user"` 兜底）。
    const scope = prev.apiQuota?.scope;
    out.apiQuota = {
      limit: apiLimit,
      used: apiUsed !== undefined ? apiUsed : (prev.apiQuota?.used ?? 0),
      ...(scope !== undefined ? { scope } : {}),
    };
  }

  return out;
}
