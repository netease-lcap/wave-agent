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
 *
 * 唯一的例外是 `rateLimitWindowsFromQuotaHeaders()`：`$.session.usage().rateLimits`
 * 是 SDK 自己的公共面（`types/mods.ts`），必须在进程内把窗口读出来，不能等宿主映射。
 * 它只读用户可见窗口需要的那几个字段，其余字段依旧原样留在 `QuotaHeaders` 里。
 */

import type { ModRateLimitWindow } from "../types/mods.js";

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

/**
 * 上游的窗口名，取自 `x-codechat-quota-claim` 的取值域（`weekly` / `monthly`）。
 *
 * **别把它们对成 Claude Code 的 `five_hour` / `seven_day`**：CC 那两个是 5 小时
 * 滚动窗与 7 天窗，我们是自然周（周一 00:00 北京时间重置）+ 滚动月
 * （spec: docs/specs/desktop/desktop-account.md「额度响应头」）。名字必须写上游
 * 真实的这两个，社区 mod 按 kind 分支时才有意义；写 `five_hour` 是在撒谎。
 *
 * 顺序固定 weekly → monthly：周窗更紧，mod 取 `rateLimits[0]` 当「代表窗口」时
 * 拿到的是更可能先触顶的那个。
 */
const QUOTA_WINDOW_KINDS = ["weekly", "monthly"] as const;

/** 头里的一个字段：去空白后非空才算给了（空串 = 服务端没给这个维度）。 */
function readQuotaField(
  headers: QuotaHeaders,
  field: string,
): string | undefined {
  const raw = headers[field];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 非负数字；`unlimited` / `unavailable` / 乱码 → undefined（= 这个数没有）。 */
function readQuotaNumber(
  headers: QuotaHeaders,
  field: string,
): number | undefined {
  const raw = readQuotaField(headers, field);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * 一个窗口的已用百分比。
 *
 * 优先用上游直接给的 `*-utilization`：它是 `0`–`1` 的小数（4 位），×100 就是百分比。
 * 没有它才自己算，分子 = 该窗口已用（`*-used`，单位是积分，不是 token）、
 * 分母 = 该窗口限额（`*-limit`）—— `limit` 为 `unlimited` / `unavailable` /
 * 非正数时没有可算的比例，这个窗口直接不报。
 *
 * 结果按字段契约夹在 0–100（`ModRateLimitWindow.percentUsed` 声明就是 0–100）：
 * 超额时上游会给出 >1 的 utilization，夹住而不是原样透传，免得消费方算
 * `100 - percentUsed` 得到负数余量。
 */
function percentUsedOf(
  headers: QuotaHeaders,
  kind: (typeof QUOTA_WINDOW_KINDS)[number],
): number | undefined {
  const utilization = readQuotaNumber(headers, `${kind}-utilization`);
  let percent: number | undefined;
  if (utilization !== undefined) {
    percent = utilization * 100;
  } else {
    const used = readQuotaNumber(headers, `${kind}-used`);
    const limit = readQuotaNumber(headers, `${kind}-limit`);
    if (used === undefined || limit === undefined || limit <= 0)
      return undefined;
    percent = (used / limit) * 100;
  }
  const rounded = Math.round(percent * 100) / 100;
  return Math.min(100, Math.max(0, rounded));
}

/**
 * 额度头 → `$.session.usage().rateLimits` 的窗口数组。
 *
 * 三个易错点，改这里之前先读：
 * - `*-reset` 是 **unix 秒**，而 `ModRateLimitWindow.resetsAt` 声明是**毫秒**，
 *   这里 ×1000；漏乘的后果不是差一点，而是 mod 的倒计时差 1000 倍（落在 1970 年）。
 * - `percentUsed` 优先用上游的 `*-utilization`（已经算好的比例），只有它缺了才用
 *   `used / limit` 现算。
 * - 私有化部署 / 自定义网关 / 中间层剥掉自定义头时**一个头都没有** → 空数组，
 *   不抛错、不打日志：这是「这个账号没有配额窗口可报」的真实读法，不是缺陷。
 *   同理 `api-*` 不产生窗口 —— 它是充值余额（没有重置时刻，`limit` 为 0 就是
 *   已用完），不在「额度窗口」的语义里。
 */
export function rateLimitWindowsFromQuotaHeaders(
  headers: QuotaHeaders | undefined,
): ModRateLimitWindow[] {
  if (!headers) return [];
  // `pickQuotaHeaders` 留下来的是**带前缀**的原始键（宿主拿到的就是那份），这里
  // 先剥掉前缀，下面的字段名才和 spec 的表头一一对上。
  const fields: QuotaHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(QUOTA_HEADER_PREFIX)) {
      fields[key.slice(QUOTA_HEADER_PREFIX.length)] = value;
    }
  }
  const windows: ModRateLimitWindow[] = [];
  for (const kind of QUOTA_WINDOW_KINDS) {
    const percentUsed = percentUsedOf(fields, kind);
    if (percentUsed === undefined) continue;
    const resetSeconds = readQuotaNumber(fields, `${kind}-reset`);
    windows.push({
      kind,
      percentUsed,
      // 上游没给重置时刻（或给了 0）就只是缺这个可选字段，不影响这条窗口本身。
      ...(resetSeconds !== undefined && resetSeconds > 0
        ? { resetsAt: Math.round(resetSeconds * 1000) }
        : {}),
    });
  }
  return windows;
}
