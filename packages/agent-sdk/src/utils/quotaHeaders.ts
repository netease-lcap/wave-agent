/**
 * 额度响应头的筛选：codechat 的 proxy 在**每次模型调用**的响应上带一组
 * `x-codechat-quota-*`（spec: docs/specs/desktop/desktop-account.md「额度响应头」、
 * vusion/codechat#51）。数字全部来自闸口那一次 `getBillingVerdict`，是热路径上的
 * 免费输出；SDK 只负责把它们从响应里**原样挑出来**，语义映射（头 → 账户卡片
 * 契约）落在消费方（桌面端宿主），因为 CLI / 远程页并不需要这些读数。
 *
 * 为什么只挑前缀、不解析字段：字段集合由服务端定（可能先于客户端发版新增），
 * SDK 不认识任何一个字段名，就不该在这里做白名单——多一个头不该要求 SDK 再发版。
 *
 * 为什么两条路径都要：成功响应与错误响应**同样**带头（402 阻断、上游 429/5xx
 * 都会刷新读数，spec 场景 2），所以 `catch` 分支也要从 `APIError.headers` 里取。
 */

/** 服务端约定的前缀；大小写不敏感（Node 的 `Headers` 已经全小写）。 */
const QUOTA_HEADER_PREFIX = "x-codechat-quota-";

export type QuotaHeaders = Record<string, string>;

/** `Headers` 形状的结构判定（避免依赖 DOM 的 `instanceof Headers`）。 */
function isHeadersLike(
  value: unknown,
): value is { forEach: (cb: (value: string, key: string) => void) => void } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { forEach?: unknown }).forEach === "function"
  );
}

/**
 * 从响应头（`Headers` 或已经摊平的 `Record`）里挑出额度头。
 * 一个都没有 → `undefined`（= 这次没有新信息，调用方据此**不更新、不请求**，
 * 覆盖私有化部署 / 自定义网关 / 中间层剥掉自定义头的情形）。
 */
export function pickQuotaHeaders(source: unknown): QuotaHeaders | undefined {
  const out: QuotaHeaders = {};
  let found = false;
  const take = (name: string, value: unknown) => {
    if (typeof value !== "string") return;
    const key = name.toLowerCase();
    if (!key.startsWith(QUOTA_HEADER_PREFIX)) return;
    out[key] = value;
    found = true;
  };

  if (isHeadersLike(source)) {
    source.forEach((value, key) => take(key, value));
  } else if (typeof source === "object" && source !== null) {
    for (const [key, value] of Object.entries(
      source as Record<string, unknown>,
    )) {
      take(key, value);
    }
  }
  return found ? out : undefined;
}

/**
 * 错误对象上的响应头：openai SDK 的 `APIError` 把非 2xx 的响应头挂在
 * `.headers`（`Headers`），402 与 429 的额度读数就在那里。
 */
export function quotaHeadersFromError(
  error: unknown,
): QuotaHeaders | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  return pickQuotaHeaders((error as { headers?: unknown }).headers);
}
