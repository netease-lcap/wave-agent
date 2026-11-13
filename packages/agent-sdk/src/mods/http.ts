/**
 * `$.http.fetch`（spec「发 HTTP 请求」）。
 *
 * 沙箱里没有 `fetch`，这是 mod 访问网络的唯一方式。三条纪律：
 *
 * - **白名单**只放行 `https:` 与本机回环的 `http:`（与 `Link.href` 共用
 *   `./url.js` 的同一份判断）。重定向目标也要再过一次 —— 否则一次 https
 *   跳转就能把请求落到明文的远端。
 * - **不静默截断**：响应体超过上限时 `text` 留前一段并置 `isTruncated`，
 *   但 `Content-Length` 已经声明超限的直接报错 —— 那份声明本身说明这不是
 *   「差一点」，而是一个几 GB 的东西。
 * - **超时是整次调用**（含重定向与读完 body），不是每一跳各算一次。
 */

import { MOD_LIMITS, type ModFetchResult } from "../types/mods.js";
import { isAllowedUrl } from "./url.js";

export interface ModHttpOptions {
  method?: string;
  headers?: Record<string, string>;
  /** 字符串请求体（一次性，不支持流）。 */
  body?: string;
  /** 上限是 `MOD_LIMITS.httpTimeoutMs`，更大的值夹到上限。 */
  timeoutMs?: number;
}

interface ParsedOptions {
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export async function modFetch(
  url: unknown,
  options?: unknown,
): Promise<ModFetchResult> {
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("$.http.fetch 需要一个 URL 字符串");
  }
  if (!isAllowedUrl(url, MOD_LIMITS.hrefChars)) {
    throw new Error(
      "$.http.fetch 只允许 https: 与本机回环的 http:（localhost / 127.0.0.1 / [::1]）",
    );
  }
  const parsed = parseOptions(options);
  const deadline = Date.now() + parsed.timeoutMs;
  let current = url;

  try {
    for (let redirects = 0; ; redirects++) {
      const response = await requestOnce(current, parsed, deadline);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (redirects >= MOD_LIMITS.httpMaxRedirects) {
          await response.body?.cancel().catch(() => {});
          throw new Error(
            `$.http.fetch 的重定向超过 ${MOD_LIMITS.httpMaxRedirects} 次`,
          );
        }
        await response.body?.cancel().catch(() => {});
        current = new URL(location, current).toString();
        if (!isAllowedUrl(current, MOD_LIMITS.hrefChars)) {
          throw new Error(
            `$.http.fetch 的重定向落到了不允许的地址：${current}（只允许 https: 与本机回环）`,
          );
        }
        continue;
      }
      return await readBody(response);
    }
  } catch (error) {
    // 读 body 阶段也会超时（signal 跟着整次调用），那时抛出来的是一手
    // DOMException；同样换成说人话的那句。
    if (error instanceof Error && error.name === "TimeoutError") {
      throw timeoutError(parsed.timeoutMs);
    }
    throw error;
  }
}

async function requestOnce(
  url: string,
  options: ParsedOptions,
  deadline: number,
): Promise<Response> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw timeoutError(options.timeoutMs);
  try {
    return await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      // 自己跟重定向：`follow` 数不出跳了几次，也拦不住最后一跳的白名单。
      redirect: "manual",
      signal: AbortSignal.timeout(remaining),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw timeoutError(options.timeoutMs);
    }
    throw error;
  }
}

async function readBody(response: Response): Promise<ModFetchResult> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MOD_LIMITS.httpBodyChars) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      `$.http.fetch 的响应声明 ${declared} 字节，超过 ${MOD_LIMITS.httpBodyChars} 字节上限`,
    );
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of response.headers) headers[key] = value;

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let isTruncated = false;
  const reader = response.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;
    const room = MOD_LIMITS.httpBodyChars - bytes;
    if (value.length >= room) {
      chunks.push(value.subarray(0, room));
      bytes += room;
      isTruncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    bytes += value.length;
  }

  return {
    ok: response.ok,
    status: response.status,
    headers,
    text: new TextDecoder().decode(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    ),
    isTruncated,
  };
}

function parseOptions(options: unknown): ParsedOptions {
  if (options !== undefined && (typeof options !== "object" || !options)) {
    throw new Error("$.http.fetch 的第二个参数必须是对象");
  }
  const raw = (options ?? {}) as Record<string, unknown>;

  const method =
    raw.method === undefined ? "GET" : String(raw.method).toUpperCase();
  if (!/^[A-Z]+$/.test(method)) {
    throw new Error(`$.http.fetch 的 method 不合法：${String(raw.method)}`);
  }

  const headers: Record<string, string> = {};
  if (raw.headers !== undefined) {
    if (typeof raw.headers !== "object" || !raw.headers) {
      throw new Error("$.http.fetch 的 headers 必须是对象");
    }
    for (const [key, value] of Object.entries(raw.headers)) {
      if (typeof value !== "string") {
        throw new Error(`$.http.fetch 的 header ${key} 必须是字符串`);
      }
      headers[key] = value;
    }
  }

  let body: string | undefined;
  if (raw.body !== undefined) {
    if (typeof raw.body !== "string") {
      throw new Error("$.http.fetch 的 body 必须是字符串");
    }
    if (raw.body.length > MOD_LIMITS.httpBodyChars) {
      throw new Error(
        `$.http.fetch 的请求体 ${raw.body.length} 字符，超过 ${MOD_LIMITS.httpBodyChars} 上限`,
      );
    }
    body = raw.body;
  }

  const asked =
    raw.timeoutMs === undefined
      ? MOD_LIMITS.httpTimeoutMs
      : Number(raw.timeoutMs);
  if (!Number.isFinite(asked) || asked <= 0) {
    throw new Error("$.http.fetch 的 timeoutMs 必须是正数");
  }
  // 上限也是 30 秒：一次调用卡一分钟就已经不是「一次请求」了。
  const timeoutMs = Math.min(Math.floor(asked), MOD_LIMITS.httpTimeoutMs);

  return { method, headers, body, timeoutMs };
}

function timeoutError(timeoutMs: number): Error {
  return new Error(`$.http.fetch 超过 ${timeoutMs} 毫秒`);
}
